import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Search, Activity, Users, Pencil, Trash2, X, CalendarCheck2, Loader2, Phone, MessageSquare, Mail, Coffee, Send, MoreHorizontal, ArrowLeft, Undo2, ArrowUpDown, ChevronDown, Bell, BellOff } from "lucide-react";

// Storage shim: in Claude artifacts, window.storage is provided. In a standalone
// deployment (PWA, web), fall back to localStorage with the same async API.
if (typeof window !== "undefined" && !window.storage) {
  window.storage = {
    async get(key) {
      const value = window.localStorage.getItem(key);
      if (value === null) throw new Error("not found");
      return { key, value, shared: false };
    },
    async set(key, value) {
      window.localStorage.setItem(key, value);
      return { key, value, shared: false };
    },
    async delete(key) {
      window.localStorage.removeItem(key);
      return { key, deleted: true, shared: false };
    },
    async list(prefix = "") {
      const keys = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k && k.startsWith(prefix)) keys.push(k);
      }
      return { keys, prefix };
    },
  };
}

// ----- Constants & types -----

const STORAGE_KEY = "cadence:contacts:v1";
const IMPORT_KEY = "cadence:imported:v1";
const INTERACTIONS_KEY = "cadence:interactions:v1";
const COLLAPSED_KEY = "cadence:collapsed:v1";
const NOTIFY_KEY = "cadence:notify:v1";
const LAST_NOTIFIED_KEY = "cadence:last-notified:v1";

// Trigger a system notification for overdue contacts, but at most once per day.
// Returns true if a notification was fired.
async function maybeNotifyOverdue(contacts) {
  if (typeof window === "undefined" || typeof Notification === "undefined") return false;
  if (Notification.permission !== "granted") return false;

  // Has the user opted in?
  let optIn = false;
  try {
    const r = await window.storage.get(NOTIFY_KEY);
    optIn = r?.value === "1";
  } catch { /* no */ }
  if (!optIn) return false;

  const today = todayISO();
  // Don't re-notify on the same day
  try {
    const r = await window.storage.get(LAST_NOTIFIED_KEY);
    if (r?.value === today) return false;
  } catch { /* not yet */ }

  // Find people who are orange or red (the focus-mode threshold)
  const overdue = contacts
    .map((c) => ({ c, ...computeHeat(c.lastContactedDate, c.cadenceDays) }))
    .filter((x) => x.heat === "orange" || x.heat === "red")
    .sort((a, b) => urgencyScore(b.c) - urgencyScore(a.c));

  if (overdue.length === 0) return false;

  const top = overdue.slice(0, 3).map((x) => x.c.name).join(", ");
  const more = overdue.length > 3 ? ` and ${overdue.length - 3} more` : "";
  const title = overdue.length === 1
    ? `Reach out to ${overdue[0].c.name}`
    : `${overdue.length} people are overdue`;
  const body = overdue.length === 1
    ? `It's been a while.`
    : `${top}${more}`;

  try {
    new Notification(title, {
      body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: "hiagin-overdue",
      renotify: true,
    });
    await window.storage.set(LAST_NOTIFIED_KEY, today);
    // Set the app badge if supported (PWA on supported platforms)
    if (navigator.setAppBadge) {
      navigator.setAppBadge(overdue.length).catch(() => {});
    }
    return true;
  } catch {
    return false;
  }
}

async function clearAppBadge() {
  if (typeof navigator !== "undefined" && navigator.clearAppBadge) {
    navigator.clearAppBadge().catch(() => {});
  }
}

const INTERACTION_TYPES = [
  { value: "call", label: "Call", icon: Phone },
  { value: "text", label: "Text", icon: MessageSquare },
  { value: "in_person", label: "In person", icon: Coffee },
  { value: "email", label: "Email", icon: Mail },
  { value: "dm", label: "DM", icon: Send },
  { value: "other", label: "Other", icon: MoreHorizontal },
];

const INTERACTION_BY_VALUE = Object.fromEntries(INTERACTION_TYPES.map((t) => [t.value, t]));

const SORT_OPTIONS = [
  { value: "urgency", label: "Most urgent" },
  { value: "name", label: "Name (A-Z)" },
  { value: "last", label: "Last contacted" },
  { value: "cadence", label: "Cadence (shortest)" },
];

// Starter list — added when user taps "Import starter list" once.
const STARTER_CONTACTS = [
  { name: "Jaime",           cadenceDays: 1,  priority: 1, tags: ["intimate"] },
  { name: "Pali",            cadenceDays: 1,  priority: 1, tags: ["intimate"] },
  { name: "Beatrice",        cadenceDays: 2,  priority: 1, tags: ["friends"] },
  { name: "Matija",          cadenceDays: 2,  priority: 1, tags: ["friends"] },
  { name: "Vinny",           cadenceDays: 21, priority: 3, tags: ["casual-friends"] },
  { name: "Kader",           cadenceDays: 21, priority: 3, tags: ["casual-friends"] },
  { name: "Chris D",         cadenceDays: 21, priority: 3, tags: ["casual-friends"] },
  { name: "Nicole",          cadenceDays: 30, priority: 2, tags: ["family-adjacent"] },
  { name: "Cari",            cadenceDays: 30, priority: 2, tags: ["family-adjacent"] },
  { name: "Brian Tully",     cadenceDays: 30, priority: 2, tags: ["family-adjacent"] },
  { name: "Brian's son",     cadenceDays: 30, priority: 2, tags: ["family-adjacent"] },
  { name: "Richard Guerra",  cadenceDays: 30, priority: 2, tags: ["family-adjacent"] },
  { name: "Perla",           cadenceDays: 30, priority: 2, tags: ["family-adjacent"] },
  { name: "Tim Denning",     cadenceDays: 90, priority: 3, tags: ["friend-adjacent-dormant", "needs-rewarming"] },
  { name: "Robert Morris",   cadenceDays: 60, priority: 2, tags: ["friend-adjacent-aspirational"] },
  { name: "Mary Gregoire",   cadenceDays: 60, priority: 2, tags: ["friend-adjacent-aspirational"] },
  { name: "Samuel Headrick", cadenceDays: 60, priority: 2, tags: ["friend-adjacent-aspirational"] },
  { name: "David Marusek",   cadenceDays: 60, priority: 2, tags: ["friend-adjacent-aspirational"] },
  { name: "Alex Mathers",    cadenceDays: 60, priority: 2, tags: ["friend-adjacent-aspirational"] },
  { name: "Zak Bos",         cadenceDays: 7,  priority: 2, tags: ["mentor"] },
];

const HEAT_ORDER = ["red", "orange", "yellow", "green"];
const HEAT_LABELS = { red: "Critical", orange: "Overdue", yellow: "Warning", green: "On Track" };

const HEAT_STYLES = {
  green:  { stripe: "bg-emerald-500", text: "text-emerald-600",  badgeBg: "bg-emerald-50",  badgeText: "text-emerald-700",  bar: "bg-emerald-500", barBg: "bg-emerald-100",  pillBg: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  yellow: { stripe: "bg-amber-400",   text: "text-amber-600",    badgeBg: "bg-amber-50",    badgeText: "text-amber-700",    bar: "bg-amber-400",   barBg: "bg-amber-100",    pillBg: "bg-amber-50 text-amber-700 border-amber-200" },
  orange: { stripe: "bg-orange-500",  text: "text-orange-600",   badgeBg: "bg-orange-50",   badgeText: "text-orange-700",   bar: "bg-orange-500",  barBg: "bg-orange-100",   pillBg: "bg-orange-50 text-orange-700 border-orange-200" },
  red:    { stripe: "bg-rose-600",    text: "text-rose-600",     badgeBg: "bg-rose-50",     badgeText: "text-rose-700",     bar: "bg-rose-600",    barBg: "bg-rose-100",     pillBg: "bg-rose-50 text-rose-700 border-rose-200" },
};

const PRIORITIES = [
  { value: 1, label: "Core",      sub: "Closest people" },
  { value: 2, label: "Important", sub: "In my life" },
  { value: 3, label: "Casual",    sub: "Keep in touch" },
];

const CADENCE_PRESETS = [
  { label: "Daily", days: 1 },
  { label: "Weekly", days: 7 },
  { label: "Biweekly", days: 14 },
  { label: "Monthly", days: 30 },
  { label: "Quarterly", days: 90 },
  { label: "Yearly", days: 365 },
];

// ----- Cadence logic -----

// Parse "YYYY-MM-DD" as a *local* date (avoids UTC interpretation that
// shifts the day by one in negative timezones).
function parseLocalISODate(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function daysBetween(fromIso, to = new Date()) {
  const f = parseLocalISODate(fromIso);
  const fMid = new Date(f.getFullYear(), f.getMonth(), f.getDate()).getTime();
  const tMid = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
  return Math.floor((tMid - fMid) / 86_400_000);
}

function computeHeat(lastIso, cadenceDays) {
  if (!lastIso) return { daysSince: null, heat: "red" };
  const days = daysBetween(lastIso);
  const ratio = days / cadenceDays;
  const heat = ratio < 1 ? "green" : ratio < 1.5 ? "yellow" : ratio < 2 ? "orange" : "red";
  return { daysSince: days, heat };
}

function urgencyScore(c) {
  const { daysSince } = computeHeat(c.lastContactedDate, c.cadenceDays);
  if (daysSince === null) return Number.POSITIVE_INFINITY;
  const weight = 4 - (c.priority || 2);
  return (daysSince / c.cadenceDays) * weight;
}

function newId() {
  return (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID()
    : `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysAgoISO(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function makeSeed() {
  return [
    { name: "Mom", cadenceDays: 7, lastContactedDate: daysAgoISO(2), tags: ["family"], priority: 1 },
    { name: "Best friend from college", cadenceDays: 30, lastContactedDate: daysAgoISO(45), tags: ["close-friends"], priority: 1 },
    { name: "Old coworker", cadenceDays: 90, lastContactedDate: daysAgoISO(120), tags: ["work", "network"], priority: 3 },
    { name: "Cousin Sam", cadenceDays: 60, lastContactedDate: daysAgoISO(15), tags: ["family"], priority: 2 },
    { name: "Mentor", cadenceDays: 45, lastContactedDate: null, tags: ["work", "mentor"], priority: 2 },
  ].map((c) => ({
    id: newId(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...c,
  }));
}

// ----- Sub-components -----

function TagChipInput({ value, onChange, suggestions, placeholder, disabled }) {
  const [input, setInput] = useState("");
  const [showSuggest, setShowSuggest] = useState(false);
  const inputRef = useRef(null);

  const addTag = (raw) => {
    const t = raw.trim();
    if (!t || value.includes(t)) { setInput(""); return; }
    onChange([...value, t]);
    setInput("");
  };
  const removeTag = (tag) => onChange(value.filter((t) => t !== tag));

  const onKeyDown = (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(input);
    } else if (e.key === "Backspace" && input === "" && value.length > 0) {
      removeTag(value[value.length - 1]);
    }
  };

  const filtered = (suggestions || [])
    .filter((s) => !value.includes(s) && s.toLowerCase().includes(input.toLowerCase()))
    .slice(0, 6);

  return (
    <div className="space-y-2">
      <div
        className="min-h-[44px] flex flex-wrap gap-1.5 items-center px-3 py-2 rounded-md border border-zinc-300 bg-white focus-within:ring-2 focus-within:ring-zinc-900"
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((tag) => (
          <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-zinc-100 text-zinc-700 text-xs font-medium px-2 py-0.5">
            {tag}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); removeTag(tag); }}
              disabled={disabled}
              className="hover:bg-zinc-200 rounded-full p-0.5"
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={input}
          disabled={disabled}
          onChange={(e) => { setInput(e.target.value); setShowSuggest(true); }}
          onFocus={() => setShowSuggest(true)}
          onBlur={() => setTimeout(() => {
            // Commit any pending text so users don't lose tags by forgetting to press Enter.
            // The 150ms delay lets suggestion clicks fire first via their onMouseDown.
            if (input.trim()) addTag(input);
            setShowSuggest(false);
          }, 150)}
          onKeyDown={onKeyDown}
          placeholder={value.length === 0 ? placeholder : ""}
          className="flex-1 min-w-[120px] bg-transparent outline-none text-sm"
        />
      </div>
      {showSuggest && filtered.length > 0 && (
        <div className="border border-zinc-200 rounded-md bg-white shadow-md p-1 max-h-40 overflow-y-auto">
          {filtered.map((s) => (
            <button
              key={s}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => addTag(s)}
              className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-zinc-100"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ContactCard({ contact, onEdit, onMark, onDelete, onLog, onOpenDetail }) {
  const { daysSince, heat } = computeHeat(contact.lastContactedDate, contact.cadenceDays);
  const styles = HEAT_STYLES[heat];
  const progress = daysSince === null ? 100 : Math.min(100, (daysSince / contact.cadenceDays) * 100);

  // Stop propagation on action buttons so taps on them don't open the detail view
  const stop = (fn) => (e) => { e.stopPropagation(); fn(); };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      whileHover={{ y: -4 }}
      onClick={() => onOpenDetail?.(contact)}
      className="group bg-white rounded-2xl p-5 shadow-sm border border-zinc-200 hover:shadow-lg transition-all duration-300 relative overflow-hidden flex flex-col h-full cursor-pointer"
    >
      <div className={`absolute top-0 left-0 right-0 h-1 ${styles.stripe}`} />

      <div className="flex justify-between items-start mb-3">
        <div className="space-y-1 pr-8 min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-lg leading-tight text-zinc-900 truncate">{contact.name}</h3>
            {contact.priority === 1 && (
              <span className="text-[9px] font-bold tracking-wider uppercase px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-700 shrink-0">Core</span>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {contact.tags?.map((tag) => (
              <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-700 font-medium">
                {tag}
              </span>
            ))}
            {(!contact.tags || contact.tags.length === 0) && (
              <span className="text-xs text-zinc-400 italic">{PRIORITIES.find((p) => p.value === contact.priority)?.label || "Important"}</span>
            )}
          </div>
        </div>

        <div className="absolute top-4 right-4 flex space-x-1 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={stop(() => onEdit(contact))} className="h-8 w-8 inline-flex items-center justify-center text-zinc-400 hover:text-zinc-900 rounded-lg hover:bg-zinc-100" aria-label={`Edit ${contact.name}`}>
            <Pencil className="h-4 w-4" />
          </button>
          <button onClick={stop(() => onDelete(contact))} className="h-8 w-8 inline-flex items-center justify-center text-zinc-400 hover:text-rose-600 rounded-lg hover:bg-zinc-100" aria-label={`Delete ${contact.name}`}>
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mt-auto pt-4 space-y-4">
        <div className="flex justify-between items-end">
          <div>
            {daysSince === 0 ? (
              <div className={`text-xl font-bold ${styles.text}`}>Contacted today</div>
            ) : (
              <div className="text-2xl font-bold flex items-baseline gap-1">
                <span className={styles.text}>{daysSince === null ? "∞" : daysSince}</span>
                <span className="text-sm font-medium text-zinc-500 mb-0.5">days</span>
              </div>
            )}
            <div className="text-xs text-zinc-500 font-medium mt-0.5">Target: every {contact.cadenceDays} days</div>
          </div>
          <span className={`inline-flex items-center px-3 py-1 rounded-full text-[10px] uppercase tracking-wider font-semibold border ${styles.pillBg}`}>
            {heat}
          </span>
        </div>

        <div className="space-y-1.5">
          <div className={`h-2 w-full rounded-full overflow-hidden ${styles.barBg}`}>
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.8, ease: "easeOut" }}
              className={`h-full rounded-full ${styles.bar}`}
            />
          </div>
          <div className="text-[10px] text-zinc-500 text-right font-medium">
            {contact.lastContactedDate ? `Last: ${parseLocalISODate(contact.lastContactedDate).toLocaleDateString()}` : "Never contacted"}
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={stop(() => onMark(contact))}
            className={
              heat === "green"
                ? "flex-1 h-11 rounded-xl border border-zinc-300 bg-white hover:bg-zinc-50 text-zinc-900 font-bold inline-flex items-center justify-center transition active:scale-[0.98]"
                : `flex-1 h-11 rounded-xl ${styles.bar} text-white font-bold shadow-md hover:brightness-110 inline-flex items-center justify-center transition active:scale-[0.98]`
            }
            title="Quick mark — log a contact for today"
          >
            <CalendarCheck2 className="w-4 h-4 mr-2" />
            Contacted
          </button>
          <button
            onClick={stop(() => onLog?.(contact))}
            className="px-3 h-11 rounded-xl border border-zinc-300 bg-white hover:bg-zinc-50 text-zinc-700 font-semibold inline-flex items-center justify-center transition active:scale-[0.98]"
            title="Log with type and notes"
            aria-label="Log interaction with details"
          >
            Log…
          </button>
        </div>
      </div>
    </motion.div>
  );
}

function ContactForm({ open, onClose, contact, onSave, allTags }) {
  const isEditing = !!contact;
  const [name, setName] = useState("");
  const [cadenceDays, setCadenceDays] = useState("7");
  const [lastContactedDate, setLastContactedDate] = useState(todayISO());
  const [tags, setTags] = useState([]);
  const [priority, setPriority] = useState(2);
  const [errors, setErrors] = useState({});
  const [pending, setPending] = useState(false);
  const mouseDownOnBackdrop = useRef(false);

  useEffect(() => {
    if (!open) return;
    if (contact) {
      setName(contact.name);
      setCadenceDays(String(contact.cadenceDays));
      setLastContactedDate(contact.lastContactedDate || "");
      setTags(contact.tags || []);
      setPriority(contact.priority || 2);
    } else {
      setName(""); setCadenceDays("7"); setLastContactedDate(todayISO()); setTags([]); setPriority(2);
    }
    setErrors({});
  }, [open, contact]);

  const submit = async () => {
    const errs = {};
    if (!name.trim()) errs.name = "Name is required";
    const days = Number(cadenceDays);
    if (!days || isNaN(days) || days < 1) errs.cadenceDays = "Must be at least 1 day";
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setPending(true);
    try {
      await onSave({
        ...(contact || {}),
        id: contact?.id || newId(),
        name: name.trim(),
        cadenceDays: days,
        lastContactedDate: lastContactedDate.trim() || null,
        tags,
        priority,
        createdAt: contact?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      onClose();
    } finally {
      setPending(false);
    }
  };

  if (!open) return null;
  const cadenceNum = Number(cadenceDays);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onMouseDown={(e) => { mouseDownOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (e.target === e.currentTarget && mouseDownOnBackdrop.current) onClose(); }}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 space-y-5">
          <div>
            <h2 className="text-xl font-bold text-zinc-900">{isEditing ? "Edit Contact" : "Add Contact"}</h2>
            <p className="text-sm text-zinc-500 mt-1">
              {isEditing ? "Update cadence and details." : "Add someone to track your communication rhythm."}
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-900">Name</label>
            <input
              autoFocus
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Jane Doe"
              disabled={pending}
              className="w-full h-11 px-3 rounded-md border border-zinc-300 focus:ring-2 focus:ring-zinc-900 focus:outline-none"
            />
            {errors.name && <p className="text-sm text-rose-600">{errors.name}</p>}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-900">Priority</label>
            <div className="grid grid-cols-3 gap-2">
              {PRIORITIES.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setPriority(p.value)}
                  disabled={pending}
                  className={`rounded-lg border px-3 py-2 text-left transition ${
                    priority === p.value
                      ? "border-zinc-900 bg-zinc-50 ring-1 ring-zinc-900"
                      : "border-zinc-200 hover:border-zinc-400"
                  }`}
                >
                  <div className="text-sm font-semibold text-zinc-900">{p.label}</div>
                  <div className="text-[10px] text-zinc-500">{p.sub}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-900">Cadence</label>
            <div className="flex flex-wrap gap-2">
              {CADENCE_PRESETS.map((p) => (
                <button
                  key={p.days}
                  type="button"
                  onClick={() => setCadenceDays(String(p.days))}
                  disabled={pending}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium border transition ${
                    cadenceNum === p.days
                      ? "bg-zinc-900 text-white border-zinc-900"
                      : "bg-zinc-50 text-zinc-700 border-zinc-200 hover:border-zinc-400"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 pt-1">
              <span className="text-xs text-zinc-500">Or custom (days):</span>
              <input
                type="number"
                min="1"
                value={cadenceDays}
                onChange={(e) => setCadenceDays(e.target.value)}
                disabled={pending}
                className="w-24 h-8 px-2 rounded-md border border-zinc-300 focus:ring-2 focus:ring-zinc-900 focus:outline-none text-sm"
              />
            </div>
            {errors.cadenceDays && <p className="text-sm text-rose-600">{errors.cadenceDays}</p>}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-900">Last contacted</label>
            <input
              type="date"
              value={lastContactedDate}
              onChange={(e) => setLastContactedDate(e.target.value)}
              disabled={pending}
              className="w-full h-11 px-3 rounded-md border border-zinc-300 focus:ring-2 focus:ring-zinc-900 focus:outline-none"
            />
            <p className="text-xs text-zinc-500">Leave blank if you've never contacted them — they'll go to the top.</p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-900">Tags</label>
            <TagChipInput
              value={tags}
              onChange={setTags}
              suggestions={allTags}
              disabled={pending}
              placeholder="family, work, close-friends..."
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="px-4 h-11 rounded-xl text-zinc-700 hover:bg-zinc-100 font-semibold transition"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={pending}
              className="px-5 h-11 rounded-xl bg-zinc-900 text-white hover:bg-zinc-800 font-semibold inline-flex items-center transition disabled:opacity-50"
            >
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEditing ? "Save" : "Add Contact"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConfirmDialog({ open, name, onCancel, onConfirm }) {
  const mouseDownOnBackdrop = useRef(false);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onMouseDown={(e) => { mouseDownOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (e.target === e.currentTarget && mouseDownOnBackdrop.current) onCancel(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div>
          <h2 className="text-lg font-bold text-zinc-900">Delete {name}?</h2>
          <p className="text-sm text-zinc-500 mt-1">This will permanently remove this contact. This can't be undone.</p>
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-4 h-10 rounded-xl text-zinc-700 hover:bg-zinc-100 font-semibold transition">Cancel</button>
          <button onClick={onConfirm} className="px-5 h-10 rounded-xl bg-rose-600 text-white hover:bg-rose-700 font-semibold transition">Delete</button>
        </div>
      </div>
    </div>
  );
}

function LogInteractionDialog({ open, contact, onClose, onSubmit }) {
  const [type, setType] = useState("call");
  const [otherLabel, setOtherLabel] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(todayISO());
  const [pending, setPending] = useState(false);
  const mouseDownOnBackdrop = useRef(false);

  useEffect(() => {
    if (open) { setType("call"); setOtherLabel(""); setNote(""); setDate(todayISO()); }
  }, [open, contact?.id]);

  if (!open || !contact) return null;

  const submit = async () => {
    setPending(true);
    try {
      const finalType = type === "other" && otherLabel.trim() ? `other:${otherLabel.trim()}` : type;
      await onSubmit(contact, { type: finalType, note, date });
      onClose();
    } finally {
      setPending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onMouseDown={(e) => { mouseDownOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (e.target === e.currentTarget && mouseDownOnBackdrop.current) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-6 space-y-5">
          <div>
            <h2 className="text-xl font-bold text-zinc-900">Log interaction</h2>
            <p className="text-sm text-zinc-500 mt-1">with {contact.name}</p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-900">Type</label>
            <div className="grid grid-cols-3 gap-2">
              {INTERACTION_TYPES.map((t) => {
                const Icon = t.icon;
                const active = type === t.value;
                return (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setType(t.value)}
                    disabled={pending}
                    className={`rounded-lg border px-3 py-2.5 inline-flex flex-col items-center gap-1 transition ${
                      active ? "border-zinc-900 bg-zinc-50 ring-1 ring-zinc-900" : "border-zinc-200 hover:border-zinc-400"
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                    <span className="text-xs font-semibold">{t.label}</span>
                  </button>
                );
              })}
            </div>
            {type === "other" && (
              <input
                type="text"
                value={otherLabel}
                onChange={(e) => setOtherLabel(e.target.value)}
                placeholder='Label this (e.g. "Letter", "Voice memo", "Postcard")'
                disabled={pending}
                className="w-full h-10 px-3 rounded-md border border-zinc-300 focus:ring-2 focus:ring-zinc-900 focus:outline-none text-sm"
              />
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-900">When</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              disabled={pending}
              className="w-full h-11 px-3 rounded-md border border-zinc-300 focus:ring-2 focus:ring-zinc-900 focus:outline-none"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-900">Note <span className="text-zinc-400 font-normal">(optional)</span></label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What did you talk about? Anything to remember next time?"
              rows={3}
              disabled={pending}
              className="w-full px-3 py-2 rounded-md border border-zinc-300 focus:ring-2 focus:ring-zinc-900 focus:outline-none resize-none"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} disabled={pending} className="px-4 h-11 rounded-xl text-zinc-700 hover:bg-zinc-100 font-semibold transition">
              Cancel
            </button>
            <button type="button" onClick={submit} disabled={pending} className="px-5 h-11 rounded-xl bg-zinc-900 text-white hover:bg-zinc-800 font-semibold inline-flex items-center transition disabled:opacity-50">
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ContactDetailView({ contact, interactions, onClose, onEdit, onLog, onMark }) {
  const mouseDownOnBackdrop = useRef(false);
  if (!contact) return null;

  const { daysSince, heat } = computeHeat(contact.lastContactedDate, contact.cadenceDays);
  const styles = HEAT_STYLES[heat];
  const myInteractions = interactions
    .filter((i) => i.contactId === contact.id)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  return (
    <div
      className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm flex justify-end"
      onMouseDown={(e) => { mouseDownOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (e.target === e.currentTarget && mouseDownOnBackdrop.current) onClose(); }}
    >
      <motion.div
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "tween", duration: 0.25 }}
        className="bg-white w-full sm:max-w-lg h-full overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`h-1 ${styles.stripe}`} />
        <div className="sticky top-0 bg-white/95 backdrop-blur z-10 px-5 py-4 border-b border-zinc-200 flex items-center justify-between">
          <button onClick={onClose} className="inline-flex items-center text-sm font-medium text-zinc-600 hover:text-zinc-900">
            <ArrowLeft className="w-4 h-4 mr-1" /> Back
          </button>
          <button onClick={() => onEdit(contact)} className="inline-flex items-center text-sm font-medium text-zinc-600 hover:text-zinc-900">
            <Pencil className="w-4 h-4 mr-1" /> Edit
          </button>
        </div>

        <div className="p-5 space-y-6">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <h2 className="text-2xl font-bold text-zinc-900">{contact.name}</h2>
              {contact.priority === 1 && (
                <span className="text-[9px] font-bold tracking-wider uppercase px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-700">Core</span>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {contact.tags?.map((tag) => (
                <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-700 font-medium">{tag}</span>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className={`rounded-xl border p-4 ${styles.pillBg}`}>
              <div className="text-[10px] uppercase tracking-wider opacity-80 font-bold">Status</div>
              <div className="text-2xl font-bold mt-1">
                {daysSince === 0 ? "Today" : daysSince === null ? "Never" : `${daysSince}d`}
              </div>
              <div className="text-[10px] opacity-80 font-medium mt-0.5">Target: every {contact.cadenceDays}d</div>
            </div>
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Logged</div>
              <div className="text-2xl font-bold mt-1 text-zinc-900">{myInteractions.length}</div>
              <div className="text-[10px] text-zinc-500 font-medium mt-0.5">interactions</div>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => onMark(contact)}
              className={`flex-1 h-11 rounded-xl ${heat === "green" ? "border border-zinc-300 bg-white hover:bg-zinc-50 text-zinc-900" : `${styles.bar} text-white shadow-md hover:brightness-110`} font-bold inline-flex items-center justify-center transition active:scale-[0.98]`}
            >
              <CalendarCheck2 className="w-4 h-4 mr-2" />
              Contacted Today
            </button>
            <button
              onClick={() => onLog(contact)}
              className="px-4 h-11 rounded-xl border border-zinc-300 bg-white hover:bg-zinc-50 text-zinc-700 font-semibold inline-flex items-center transition active:scale-[0.98]"
            >
              Log…
            </button>
          </div>

          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500 mb-3">History</h3>
            {myInteractions.length === 0 ? (
              <div className="text-sm text-zinc-500 italic bg-zinc-50 rounded-xl p-4 text-center">
                No history yet. Tap "Contacted" or "Log…" to record an interaction.
              </div>
            ) : (
              <div className="space-y-2">
                {myInteractions.map((i) => {
                  const isCustomOther = typeof i.type === "string" && i.type.startsWith("other:");
                  const baseType = isCustomOther ? "other" : i.type;
                  const customLabel = isCustomOther ? i.type.slice("other:".length) : null;
                  const meta = INTERACTION_BY_VALUE[baseType] || INTERACTION_BY_VALUE.other;
                  const Icon = meta.icon;
                  const displayLabel = customLabel || meta.label;
                  return (
                    <div key={i.id} className="flex gap-3 p-3 rounded-xl border border-zinc-200 bg-white">
                      <div className="w-9 h-9 rounded-full bg-zinc-100 flex items-center justify-center shrink-0">
                        <Icon className="w-4 h-4 text-zinc-700" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-sm font-semibold text-zinc-900">{displayLabel}</span>
                          <span className="text-[11px] text-zinc-500 font-medium">{parseLocalISODate(i.date).toLocaleDateString()}</span>
                        </div>
                        {i.note && (
                          <p className="text-sm text-zinc-700 mt-1 whitespace-pre-wrap break-words">{i.note}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ----- App -----

export default function App() {
  const [contacts, setContacts] = useState(null);
  const [interactions, setInteractions] = useState([]);
  const [importDone, setImportDone] = useState(true); // assume done until we check storage
  const [focusMode, setFocusMode] = useState(true); // hide green/yellow by default
  const [sortBy, setSortBy] = useState("urgency");
  const [search, setSearch] = useState("");
  const [selectedTags, setSelectedTags] = useState([]);
  const [heatFilter, setHeatFilter] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [detailContact, setDetailContact] = useState(null);
  const [logForContact, setLogForContact] = useState(null);
  const [undo, setUndo] = useState(null); // { contactId, prevDate, interactionId, name, expiresAt }
  const [collapsedCategories, setCollapsedCategories] = useState(new Set());
  const [notifyEnabled, setNotifyEnabled] = useState(false);
  const searchRef = useRef(null);

  // Initial load (or seed)
  useEffect(() => {
    let mounted = true;
    (async () => {
      let loaded = [];
      try {
        const r = await window.storage.get(STORAGE_KEY);
        if (r?.value) loaded = JSON.parse(r.value);
      } catch { /* missing key — seed */ }

      if (!Array.isArray(loaded) || loaded.length === 0) {
        loaded = makeSeed();
        try { await window.storage.set(STORAGE_KEY, JSON.stringify(loaded)); } catch {}
      }

      // Check if starter list import has been done
      let imported = false;
      try {
        const r = await window.storage.get(IMPORT_KEY);
        imported = !!r?.value;
      } catch { /* not imported */ }

      // Load interactions
      let loadedInteractions = [];
      try {
        const r = await window.storage.get(INTERACTIONS_KEY);
        if (r?.value) loadedInteractions = JSON.parse(r.value);
      } catch { /* none yet */ }

      // Load collapsed categories
      let loadedCollapsed = [];
      try {
        const r = await window.storage.get(COLLAPSED_KEY);
        if (r?.value) loadedCollapsed = JSON.parse(r.value);
      } catch { /* none */ }

      // Load notification preference
      let notifyOn = false;
      try {
        const r = await window.storage.get(NOTIFY_KEY);
        notifyOn = r?.value === "1";
      } catch { /* off */ }

      if (mounted) {
        setContacts(loaded);
        setImportDone(imported);
        setInteractions(Array.isArray(loadedInteractions) ? loadedInteractions : []);
        setCollapsedCategories(new Set(Array.isArray(loadedCollapsed) ? loadedCollapsed : []));
        setNotifyEnabled(notifyOn && typeof Notification !== "undefined" && Notification.permission === "granted");
        // Fire daily notification on app open
        if (notifyOn) maybeNotifyOverdue(loaded);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const enableNotifications = async () => {
    if (typeof Notification === "undefined") {
      alert("Notifications aren't supported here. Try installing Hiagin to your home screen first.");
      return;
    }
    let perm = Notification.permission;
    if (perm === "default") {
      perm = await Notification.requestPermission();
    }
    if (perm !== "granted") {
      alert("Notifications were blocked. You can re-enable them in your browser/system settings.");
      return;
    }
    await window.storage.set(NOTIFY_KEY, "1");
    setNotifyEnabled(true);
    // Fire one immediately so they see it works
    if (contacts) await maybeNotifyOverdue(contacts);
  };

  const disableNotifications = async () => {
    await window.storage.set(NOTIFY_KEY, "0");
    setNotifyEnabled(false);
    clearAppBadge();
  };

  const toggleCategory = useCallback(async (cat) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      window.storage.set(COLLAPSED_KEY, JSON.stringify(Array.from(next))).catch(() => {});
      return next;
    });
  }, []);

  const persist = useCallback(async (next) => {
    setContacts(next);
    try { await window.storage.set(STORAGE_KEY, JSON.stringify(next)); } catch (e) { console.error(e); }
  }, []);

  const persistInteractions = useCallback(async (next) => {
    setInteractions(next);
    try { await window.storage.set(INTERACTIONS_KEY, JSON.stringify(next)); } catch (e) { console.error(e); }
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      const isTyping = t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable;
      if (e.key === "Escape") {
        if (search || selectedTags.length || heatFilter) {
          setSearch(""); setSelectedTags([]); setHeatFilter(null);
        }
        return;
      }
      if (isTyping) return;
      if (e.key === "/") { e.preventDefault(); searchRef.current?.focus(); }
      else if (e.key === "n" || e.key === "N") { e.preventDefault(); setEditing(null); setFormOpen(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [search, selectedTags, heatFilter]);

  const allTags = useMemo(() => {
    const s = new Set();
    contacts?.forEach((c) => c.tags?.forEach((t) => s.add(t)));
    return Array.from(s).sort();
  }, [contacts]);

  const stats = useMemo(() => {
    const counts = { green: 0, yellow: 0, orange: 0, red: 0 };
    contacts?.forEach((c) => { counts[computeHeat(c.lastContactedDate, c.cadenceDays).heat]++; });
    return { total: contacts?.length || 0, ...counts };
  }, [contacts]);

  const filtered = useMemo(() => {
    if (!contacts) return [];
    const q = search.toLowerCase();
    const result = contacts.filter((c) => {
      const matchSearch = !q || c.name.toLowerCase().includes(q) || c.tags?.some((t) => t.toLowerCase().includes(q));
      const matchTags = selectedTags.length === 0 || selectedTags.every((t) => c.tags?.includes(t));
      const heat = computeHeat(c.lastContactedDate, c.cadenceDays).heat;
      const matchHeat = !heatFilter || heat === heatFilter;
      // Focus mode hides green/yellow unless a heat filter or search overrides
      const matchFocus = !focusMode || heatFilter || q || (heat !== "green" && heat !== "yellow");
      return matchSearch && matchTags && matchHeat && matchFocus;
    });
    const sorters = {
      urgency: (a, b) => urgencyScore(b) - urgencyScore(a),
      name: (a, b) => a.name.localeCompare(b.name),
      last: (a, b) => {
        // Never-contacted first, then oldest contact first
        if (!a.lastContactedDate && b.lastContactedDate) return -1;
        if (a.lastContactedDate && !b.lastContactedDate) return 1;
        if (!a.lastContactedDate && !b.lastContactedDate) return 0;
        return a.lastContactedDate.localeCompare(b.lastContactedDate);
      },
      cadence: (a, b) => a.cadenceDays - b.cadenceDays,
    };
    result.sort(sorters[sortBy] || sorters.urgency);
    return result;
  }, [contacts, search, selectedTags, heatFilter, focusMode, sortBy]);

  // Group results by first tag (category). Untagged → "Other".
  // Only when sorting by urgency — other sorts show a flat list.
  const grouped = useMemo(() => {
    if (sortBy !== "urgency") {
      return filtered.length > 0 ? [["all", filtered]] : [];
    }
    const groups = new Map();
    filtered.forEach((c) => {
      const cat = (c.tags && c.tags[0]) || "other";
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat).push(c);
    });
    // Order groups by their highest-urgency member (most urgent category first)
    return Array.from(groups.entries()).sort(([, a], [, b]) => urgencyScore(b[0]) - urgencyScore(a[0]));
  }, [filtered, sortBy]);

  const hiddenCount = useMemo(() => {
    if (!contacts || !focusMode || heatFilter || search) return 0;
    return contacts.filter((c) => {
      const heat = computeHeat(c.lastContactedDate, c.cadenceDays).heat;
      const matchTags = selectedTags.length === 0 || selectedTags.every((t) => c.tags?.includes(t));
      return matchTags && (heat === "green" || heat === "yellow");
    }).length;
  }, [contacts, focusMode, heatFilter, search, selectedTags]);

  const toggleTag = (tag) =>
    setSelectedTags((cur) => (cur.includes(tag) ? cur.filter((t) => t !== tag) : [...cur, tag]));

  const handleSave = async (saved) => {
    const exists = contacts.some((c) => c.id === saved.id);
    const next = exists ? contacts.map((c) => (c.id === saved.id ? saved : c)) : [...contacts, saved];
    await persist(next);
  };

  // Quick mark — adds interaction with type=other, no note. Stages undo.
  const handleMark = async (c) => {
    await logInteractionInternal(c, { type: "other", note: "", date: todayISO() });
  };

  // Internal: log an interaction and update lastContactedDate. Used by both
  // quick-mark and the full Log Interaction dialog.
  const logInteractionInternal = async (c, { type, note, date }) => {
    const interactionDate = date || todayISO();
    const prevDate = c.lastContactedDate;
    const interaction = {
      id: newId(),
      contactId: c.id,
      type,
      note: note?.trim() || "",
      date: interactionDate,
      createdAt: new Date().toISOString(),
    };
    // Only push date forward (don't regress on a backdated entry)
    const newLastDate = !prevDate || interactionDate > prevDate ? interactionDate : prevDate;

    const nextContacts = contacts.map((x) =>
      x.id === c.id ? { ...x, lastContactedDate: newLastDate, updatedAt: new Date().toISOString() } : x
    );
    const nextInteractions = [...interactions, interaction];

    await persist(nextContacts);
    await persistInteractions(nextInteractions);

    setUndo({
      contactId: c.id,
      prevDate,
      interactionId: interaction.id,
      name: c.name,
      expiresAt: Date.now() + 6000,
    });
  };

  const handleUndo = async () => {
    if (!undo) return;
    const nextContacts = contacts.map((x) =>
      x.id === undo.contactId ? { ...x, lastContactedDate: undo.prevDate, updatedAt: new Date().toISOString() } : x
    );
    const nextInteractions = interactions.filter((i) => i.id !== undo.interactionId);
    await persist(nextContacts);
    await persistInteractions(nextInteractions);
    setUndo(null);
  };

  // Auto-clear the undo toast
  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), undo.expiresAt - Date.now());
    return () => clearTimeout(t);
  }, [undo]);

  const handleDelete = async () => {
    if (!confirmDelete) return;
    // Cascade: drop interactions for the deleted contact too
    await persist(contacts.filter((c) => c.id !== confirmDelete.id));
    await persistInteractions(interactions.filter((i) => i.contactId !== confirmDelete.id));
    setConfirmDelete(null);
  };

  const handleLogInteraction = async (c, payload) => {
    await logInteractionInternal(c, payload);
  };

  const handleImport = async () => {
    const now = new Date().toISOString();
    const additions = STARTER_CONTACTS.map((c) => ({
      id: newId(),
      name: c.name,
      cadenceDays: c.cadenceDays,
      priority: c.priority,
      tags: c.tags,
      lastContactedDate: null,
      createdAt: now,
      updatedAt: now,
    }));
    await persist([...contacts, ...additions]);
    try { await window.storage.set(IMPORT_KEY, "1"); } catch {}
    setImportDone(true);
  };

  const hasFilters = !!search || selectedTags.length > 0 || !!heatFilter;
  const loading = contacts === null;

  return (
    <div className="min-h-screen bg-zinc-50 pb-20 font-sans text-zinc-900" style={{ fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif" }}>
      <header className="sticky top-0 z-30 bg-zinc-50/80 backdrop-blur-xl border-b border-zinc-200">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="bg-zinc-900 text-white p-2 rounded-xl shadow-lg">
                <Activity className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-2xl font-extrabold text-zinc-900">Hiagin</h1>
                <p className="text-xs font-medium text-zinc-500">Stay in touch, right on time.</p>
              </div>
            </div>
            <div className="flex items-center gap-2 sm:w-auto w-full">
              <button
                onClick={notifyEnabled ? disableNotifications : enableNotifications}
                className={`h-11 w-11 rounded-full inline-flex items-center justify-center shadow-md transition active:scale-[0.98] shrink-0 ${
                  notifyEnabled
                    ? "bg-zinc-900 text-white hover:bg-zinc-800"
                    : "bg-white text-zinc-700 border border-zinc-300 hover:bg-zinc-50"
                }`}
                title={notifyEnabled ? "Notifications on — tap to turn off" : "Turn on daily reminders"}
                aria-label="Toggle notifications"
              >
                {notifyEnabled ? <Bell className="w-5 h-5" /> : <BellOff className="w-5 h-5" />}
              </button>
              <button
                onClick={() => { setEditing(null); setFormOpen(true); }}
                className="flex-1 px-4 h-11 rounded-full bg-zinc-900 text-white hover:bg-zinc-800 font-semibold inline-flex items-center justify-center shadow-lg transition active:scale-[0.98]"
              >
                <Plus className="w-5 h-5 mr-2" />
                Add Contact
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="space-y-4 mb-6">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400 w-5 h-5" />
            <input
              ref={searchRef}
              placeholder="Search contacts or tags..."
              className="w-full pl-12 h-14 rounded-2xl text-base shadow-sm border border-zinc-200 bg-white focus:ring-2 focus:ring-zinc-900 focus:outline-none"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            <button
              onClick={() => setHeatFilter(null)}
              className={`rounded-xl border bg-white px-4 py-3 text-left transition shadow-sm ${
                !heatFilter ? "border-zinc-900 ring-1 ring-zinc-900" : "border-zinc-200 hover:border-zinc-400"
              }`}
            >
              <div className="text-xs font-semibold text-zinc-500">Total</div>
              <div className="text-2xl font-bold">{stats.total}</div>
            </button>
            {HEAT_ORDER.map((h) => {
              const active = heatFilter === h;
              const styles = HEAT_STYLES[h];
              return (
                <button
                  key={h}
                  onClick={() => setHeatFilter(active ? null : h)}
                  className={`rounded-xl border px-4 py-3 text-left transition shadow-sm ${styles.pillBg} ${active ? "ring-2 ring-current" : "hover:brightness-95"}`}
                >
                  <div className="text-xs font-semibold opacity-80">{HEAT_LABELS[h]}</div>
                  <div className="text-2xl font-bold">{stats[h]}</div>
                </button>
              );
            })}
          </div>

          <AnimatePresence>
            {!importDone && contacts !== null && (
              <motion.button
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0 }}
                onClick={handleImport}
                className="w-full px-4 py-3 rounded-xl bg-zinc-900 text-white font-semibold hover:bg-zinc-800 inline-flex items-center justify-center gap-2 transition active:scale-[0.98] shadow-md"
              >
                <Plus className="w-4 h-4" />
                Import starter list (+20 contacts)
              </motion.button>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {selectedTags.length > 0 && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-zinc-500">Tags:</span>
                {selectedTags.map((tag) => (
                  <div key={tag} className="inline-flex items-center gap-1.5 bg-zinc-900 text-white px-3 py-1 rounded-full text-sm font-semibold shadow-sm">
                    {tag}
                    <button onClick={() => toggleTag(tag)} className="hover:bg-white/20 rounded-full p-0.5">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                <button onClick={() => setSelectedTags([])} className="text-xs text-zinc-500 hover:text-zinc-900 underline">
                  Clear
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="bg-white h-64 rounded-2xl animate-pulse border border-zinc-200" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          focusMode && contacts && contacts.length > 0 && !heatFilter && !search && selectedTags.length === 0 ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-3xl p-12 text-center flex flex-col items-center justify-center shadow-sm">
              <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mb-4">
                <CalendarCheck2 className="w-10 h-10 text-emerald-600" />
              </div>
              <h3 className="text-xl font-bold text-emerald-900">All caught up</h3>
              <p className="text-emerald-700 mt-2 mb-6 max-w-md mx-auto">
                Nobody's overdue. {contacts.length} {contacts.length === 1 ? "contact is" : "contacts are"} on track.
              </p>
              <button onClick={() => setFocusMode(false)} className="px-4 h-11 rounded-xl border border-emerald-300 hover:bg-emerald-100 font-semibold text-emerald-900 transition">
                Show everyone
              </button>
            </div>
          ) : (
          <div className="bg-white border border-dashed border-zinc-300 rounded-3xl p-12 text-center flex flex-col items-center justify-center shadow-sm">
            <div className="w-20 h-20 bg-zinc-100 rounded-full flex items-center justify-center mb-4">
              <Users className="w-10 h-10 text-zinc-400" />
            </div>
            <h3 className="text-xl font-bold text-zinc-900">{hasFilters ? "No matches" : "No contacts yet"}</h3>
            <p className="text-zinc-500 mt-2 mb-6 max-w-md mx-auto">
              {hasFilters ? "We couldn't find any contacts matching your filters." : "Add the people you want to keep in touch with."}
            </p>
            {hasFilters ? (
              <button onClick={() => { setSearch(""); setSelectedTags([]); setHeatFilter(null); }} className="px-4 h-11 rounded-xl border border-zinc-300 hover:bg-zinc-50 font-semibold transition">
                Clear filters
              </button>
            ) : (
              <button onClick={() => { setEditing(null); setFormOpen(true); }} className="px-5 h-12 rounded-full bg-zinc-900 text-white hover:bg-zinc-800 font-semibold inline-flex items-center transition">
                <Plus className="w-5 h-5 mr-2" />
                Add your first contact
              </button>
            )}
          </div>
          )
        ) : (
          <div className="space-y-8">
            <div className="flex items-center justify-between gap-3 flex-wrap -mb-4">
              <div className="text-xs text-zinc-500">
                {focusMode && hiddenCount > 0 && filtered.length > 0 && (
                  <>
                    Showing {filtered.length} who need attention. {hiddenCount} on track —{" "}
                    <button onClick={() => setFocusMode(false)} className="underline hover:text-zinc-900">
                      show all
                    </button>
                  </>
                )}
                {focusMode && filtered.length === 0 && hiddenCount === 0 && <>No contacts.</>}
                {!focusMode && (
                  <>
                    Showing all {filtered.length}.{" "}
                    <button onClick={() => setFocusMode(true)} className="underline hover:text-zinc-900">
                      Focus on those who need attention
                    </button>
                  </>
                )}
              </div>
              <div className="inline-flex items-center gap-1.5 text-xs">
                <ArrowUpDown className="w-3.5 h-3.5 text-zinc-500" />
                <span className="text-zinc-500 font-medium">Sort:</span>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="bg-transparent border-0 text-zinc-900 font-semibold focus:outline-none focus:ring-0 cursor-pointer pr-1"
                >
                  {SORT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            </div>
            {grouped.map(([category, group]) => {
              const isCollapsed = collapsedCategories.has(category);
              return (
                <section key={category}>
                  {category !== "all" && (
                    <button
                      onClick={() => toggleCategory(category)}
                      className="w-full flex items-center gap-1.5 mb-3 px-1 group"
                      aria-expanded={!isCollapsed}
                    >
                      <ChevronDown
                        className={`w-3.5 h-3.5 text-zinc-400 group-hover:text-zinc-700 transition-transform ${isCollapsed ? "-rotate-90" : ""}`}
                      />
                      <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-500 group-hover:text-zinc-900 transition-colors">
                        {category} <span className="text-zinc-400 font-medium">· {group.length}</span>
                      </h2>
                    </button>
                  )}
                  {!isCollapsed && (
                    <motion.div layout className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  <AnimatePresence>
                    {group.map((c) => (
                      <ContactCard
                        key={c.id}
                        contact={c}
                        onEdit={(c) => { setEditing(c); setFormOpen(true); }}
                        onMark={handleMark}
                        onDelete={(c) => setConfirmDelete(c)}
                        onLog={(c) => setLogForContact(c)}
                        onOpenDetail={(c) => setDetailContact(c)}
                      />
                    ))}
                  </AnimatePresence>
                </motion.div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </main>

      <ContactForm
        key={editing?.id || "new"}
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditing(null); }}
        contact={editing}
        onSave={handleSave}
        allTags={allTags}
      />

      <ConfirmDialog
        open={!!confirmDelete}
        name={confirmDelete?.name || ""}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={handleDelete}
      />

      <AnimatePresence>
        {detailContact && (
          <ContactDetailView
            contact={contacts?.find((c) => c.id === detailContact.id) || detailContact}
            interactions={interactions}
            onClose={() => setDetailContact(null)}
            onEdit={(c) => { setEditing(c); setFormOpen(true); }}
            onMark={handleMark}
            onLog={(c) => setLogForContact(c)}
          />
        )}
      </AnimatePresence>

      <LogInteractionDialog
        open={!!logForContact}
        contact={logForContact}
        onClose={() => setLogForContact(null)}
        onSubmit={handleLogInteraction}
      />

      {/* Undo toast */}
      <AnimatePresence>
        {undo && (
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 30 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-zinc-900 text-white px-5 py-3 rounded-full shadow-2xl flex items-center gap-3"
          >
            <span className="text-sm font-medium">Logged contact with {undo.name}</span>
            <button
              onClick={handleUndo}
              className="inline-flex items-center text-sm font-bold underline underline-offset-2 hover:text-zinc-300"
            >
              <Undo2 className="w-4 h-4 mr-1" />
              Undo
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
