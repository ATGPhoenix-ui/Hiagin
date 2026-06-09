import { useState } from "react";
import { Loader2, KeyRound, Eye, EyeOff, Activity } from "lucide-react";
import { updatePassword } from "../sync/engine";

// Shown when the user arrives via a password-reset link (PASSWORD_RECOVERY
// auth event). They're signed in with a temporary recovery session; this
// screen sets the new password, then hands them into the app.
export function SetNewPassword({ onDone }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (password !== confirm) { setError("Passwords don't match."); return; }
    setPending(true); setError("");
    try {
      await updatePassword(password);
      onDone();
    } catch (e) {
      setError(e?.message || "Couldn't update password. Try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 flex flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center bg-zinc-900 text-white p-3 rounded-2xl shadow-lg">
            <Activity className="w-8 h-8" />
          </div>
          <div>
            <h1 className="text-3xl font-extrabold text-zinc-900">Hiagin</h1>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-zinc-200 p-6 space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 bg-zinc-100 rounded-full inline-flex items-center justify-center shrink-0">
              <KeyRound className="w-5 h-5 text-zinc-700" />
            </div>
            <div>
              <h2 className="font-bold text-zinc-900">Set a new password</h2>
              <p className="text-xs text-zinc-500 mt-0.5">You're signed in via your reset link. Pick a new password to finish.</p>
            </div>
          </div>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-700">New password</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  autoFocus
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(""); }}
                  placeholder="At least 8 characters"
                  disabled={pending}
                  className="w-full h-11 px-3 pr-10 rounded-md border border-zinc-300 focus:ring-2 focus:ring-zinc-900 focus:outline-none text-base"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-zinc-400 hover:text-zinc-700"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-700">Confirm new password</label>
              <input
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => { setConfirm(e.target.value); setError(""); }}
                onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
                placeholder="Same password again"
                disabled={pending}
                className="w-full h-11 px-3 rounded-md border border-zinc-300 focus:ring-2 focus:ring-zinc-900 focus:outline-none text-base"
              />
            </div>

            {error && <p className="text-sm text-rose-600">{error}</p>}

            <button
              onClick={submit}
              disabled={pending || !password || !confirm}
              className="w-full h-11 rounded-xl bg-zinc-900 text-white hover:bg-zinc-800 font-semibold inline-flex items-center justify-center transition disabled:opacity-50 active:scale-[0.98]"
            >
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save new password
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
