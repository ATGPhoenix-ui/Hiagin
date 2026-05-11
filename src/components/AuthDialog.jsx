import { useState, useRef, useEffect } from "react";
import { Loader2, Mail, X } from "lucide-react";
import { isConnectedMode } from "../sync/supabase";
import { signInWithEmail } from "../sync/engine";

export function AuthDialog({ open, onClose }) {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const mouseDownOnBackdrop = useRef(false);

  useEffect(() => {
    if (open) { setEmail(""); setSent(false); setError(""); }
  }, [open]);

  if (!open) return null;

  const submit = async () => {
    if (!email.trim() || !email.includes("@")) {
      setError("Enter a valid email address.");
      return;
    }
    setPending(true);
    setError("");
    try {
      await signInWithEmail(email.trim());
      setSent(true);
    } catch (e) {
      setError(e?.message || "Failed to send sign-in link.");
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
      <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
        <div className="p-6 space-y-5">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-xl font-bold text-zinc-900">Sign in</h2>
              <p className="text-sm text-zinc-500 mt-1">Sync Hiagin across your devices.</p>
            </div>
            <button onClick={onClose} className="text-zinc-400 hover:text-zinc-700 p-1 -mr-1 -mt-1" aria-label="Close">
              <X className="w-5 h-5" />
            </button>
          </div>

          {!isConnectedMode ? (
            <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-sm text-amber-800">
              Sync is not yet configured for this deployment. Your data stays local on this device.
            </div>
          ) : sent ? (
            <div className="space-y-3 py-2 text-center">
              <div className="w-12 h-12 bg-emerald-100 rounded-full inline-flex items-center justify-center">
                <Mail className="w-6 h-6 text-emerald-700" />
              </div>
              <div>
                <h3 className="font-bold text-zinc-900">Check your email</h3>
                <p className="text-sm text-zinc-600 mt-1">
                  We sent a sign-in link to <span className="font-semibold">{email}</span>. Tap it to sign in.
                </p>
              </div>
              <button onClick={onClose} className="px-4 h-10 rounded-xl text-zinc-700 hover:bg-zinc-100 font-semibold transition">
                Got it
              </button>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-900">Email</label>
                <input
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  autoFocus
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setError(""); }}
                  onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
                  placeholder="you@example.com"
                  disabled={pending}
                  className="w-full h-11 px-3 rounded-md border border-zinc-300 focus:ring-2 focus:ring-zinc-900 focus:outline-none"
                />
                {error && <p className="text-sm text-rose-600">{error}</p>}
                <p className="text-xs text-zinc-500">
                  We'll email you a one-tap sign-in link. No password required.
                </p>
              </div>
              <button
                onClick={submit}
                disabled={pending || !email.trim()}
                className="w-full h-11 rounded-xl bg-zinc-900 text-white hover:bg-zinc-800 font-semibold inline-flex items-center justify-center transition disabled:opacity-50"
              >
                {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Send sign-in link
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
