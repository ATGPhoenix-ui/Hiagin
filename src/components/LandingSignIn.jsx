import { useState } from "react";
import { Loader2, Mail, Activity, Eye, EyeOff } from "lucide-react";
import {
  signInWithEmail,
  signInWithPassword,
  signUpWithPassword,
  sendPasswordReset,
} from "../sync/engine";

export function LandingSignIn() {
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const reset = () => { setError(""); setPassword(""); };

  const handlePasswordSignIn = async () => {
    if (!email.trim() || !email.includes("@")) { setError("Enter a valid email."); return; }
    if (!password) { setError("Enter your password."); return; }
    setPending(true); setError("");
    try {
      await signInWithPassword(email.trim(), password);
    } catch (e) {
      const msg = e?.message || "Sign-in failed.";
      if (/invalid/i.test(msg) || /credentials/i.test(msg)) {
        setError("Email or password is incorrect.");
      } else {
        setError(msg);
      }
    } finally { setPending(false); }
  };

  const handlePasswordSignUp = async () => {
    if (!email.trim() || !email.includes("@")) { setError("Enter a valid email."); return; }
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    setPending(true); setError("");
    try {
      const result = await signUpWithPassword(email.trim(), password);
      if (!result?.session) {
        setMode("signup-sent");
      }
    } catch (e) {
      const msg = e?.message || "Sign-up failed.";
      if (/already registered/i.test(msg) || /already exists/i.test(msg)) {
        setError("That email already has an account. Try signing in instead.");
      } else {
        setError(msg);
      }
    } finally { setPending(false); }
  };

  const handleMagicLink = async () => {
    if (!email.trim() || !email.includes("@")) { setError("Enter a valid email."); return; }
    setPending(true); setError("");
    try {
      await signInWithEmail(email.trim());
      setMode("magic-sent");
    } catch (e) {
      const msg = e?.message || "Couldn't send link.";
      if (/rate/i.test(msg) || /limit/i.test(msg)) {
        setError("Email limit reached. Try password sign-in, or wait an hour.");
      } else {
        setError(msg);
      }
    } finally { setPending(false); }
  };

  const handleResetPassword = async () => {
    if (!email.trim() || !email.includes("@")) { setError("Enter your email first."); return; }
    setPending(true); setError("");
    try {
      await sendPasswordReset(email.trim());
      setMode("reset-sent");
    } catch (e) {
      setError(e?.message || "Couldn't send reset email.");
    } finally { setPending(false); }
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
            <p className="text-sm text-zinc-500 mt-1">Stay in touch with the people who matter.</p>
          </div>
        </div>

        {mode === "magic-sent" || mode === "reset-sent" || mode === "signup-sent" ? (
          <div className="bg-white rounded-2xl shadow-sm border border-zinc-200 p-6 text-center space-y-3">
            <div className="w-12 h-12 bg-emerald-100 rounded-full inline-flex items-center justify-center mx-auto">
              <Mail className="w-6 h-6 text-emerald-700" />
            </div>
            <div>
              <h2 className="font-bold text-zinc-900">Check your email</h2>
              <p className="text-sm text-zinc-600 mt-1">
                {mode === "magic-sent" && <>Sign-in link sent to <span className="font-semibold">{email}</span>.</>}
                {mode === "reset-sent" && <>Password reset link sent to <span className="font-semibold">{email}</span>.</>}
                {mode === "signup-sent" && <>Confirmation link sent to <span className="font-semibold">{email}</span>. Tap it to finish creating your account.</>}
              </p>
            </div>
            <button
              onClick={() => { setMode("signin"); reset(); }}
              className="text-xs text-zinc-500 hover:text-zinc-900 underline pt-2"
            >
              Back
            </button>
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm border border-zinc-200 p-6 space-y-4">
            <div className="flex bg-zinc-100 rounded-lg p-1 gap-1">
              <button
                onClick={() => { setMode("signin"); reset(); }}
                className={`flex-1 h-9 rounded-md text-sm font-semibold transition ${
                  mode === "signin" || mode === "magic"
                    ? "bg-white text-zinc-900 shadow-sm"
                    : "text-zinc-500 hover:text-zinc-900"
                }`}
              >Sign in</button>
              <button
                onClick={() => { setMode("signup"); reset(); }}
                className={`flex-1 h-9 rounded-md text-sm font-semibold transition ${
                  mode === "signup"
                    ? "bg-white text-zinc-900 shadow-sm"
                    : "text-zinc-500 hover:text-zinc-900"
                }`}
              >Create account</button>
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-700">Email</label>
                <input
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setError(""); }}
                  placeholder="you@example.com"
                  disabled={pending}
                  className="w-full h-11 px-3 rounded-md border border-zinc-300 focus:ring-2 focus:ring-zinc-900 focus:outline-none text-base"
                />
              </div>

              {mode !== "magic" && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-zinc-700">Password</label>
                    {mode === "signin" && (
                      <button
                        type="button"
                        onClick={handleResetPassword}
                        disabled={pending}
                        className="text-[11px] text-zinc-500 hover:text-zinc-900 underline"
                      >Forgot?</button>
                    )}
                  </div>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      autoComplete={mode === "signup" ? "new-password" : "current-password"}
                      value={password}
                      onChange={(e) => { setPassword(e.target.value); setError(""); }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          mode === "signup" ? handlePasswordSignUp() : handlePasswordSignIn();
                        }
                      }}
                      placeholder={mode === "signup" ? "At least 8 characters" : "Your password"}
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
              )}

              {error && <p className="text-sm text-rose-600">{error}</p>}

              {mode === "signin" && (
                <>
                  <button
                    onClick={handlePasswordSignIn}
                    disabled={pending || !email.trim() || !password}
                    className="w-full h-11 rounded-xl bg-zinc-900 text-white hover:bg-zinc-800 font-semibold inline-flex items-center justify-center transition disabled:opacity-50 active:scale-[0.98]"
                  >
                    {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Sign in
                  </button>
                  <div className="flex items-center gap-3 pt-1">
                    <div className="flex-1 h-px bg-zinc-200" />
                    <span className="text-[11px] text-zinc-400 uppercase tracking-wider">or</span>
                    <div className="flex-1 h-px bg-zinc-200" />
                  </div>
                  <button
                    onClick={() => { setMode("magic"); reset(); }}
                    className="w-full h-11 rounded-xl border border-zinc-300 hover:bg-zinc-50 text-zinc-700 font-semibold inline-flex items-center justify-center transition"
                  >
                    <Mail className="w-4 h-4 mr-2" /> Email me a sign-in link
                  </button>
                </>
              )}

              {mode === "signup" && (
                <button
                  onClick={handlePasswordSignUp}
                  disabled={pending || !email.trim() || !password}
                  className="w-full h-11 rounded-xl bg-zinc-900 text-white hover:bg-zinc-800 font-semibold inline-flex items-center justify-center transition disabled:opacity-50 active:scale-[0.98]"
                >
                  {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Create account
                </button>
              )}

              {mode === "magic" && (
                <>
                  <button
                    onClick={handleMagicLink}
                    disabled={pending || !email.trim()}
                    className="w-full h-11 rounded-xl bg-zinc-900 text-white hover:bg-zinc-800 font-semibold inline-flex items-center justify-center transition disabled:opacity-50 active:scale-[0.98]"
                  >
                    {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Send sign-in link
                  </button>
                  <button
                    onClick={() => { setMode("signin"); reset(); }}
                    className="w-full h-9 text-zinc-500 hover:text-zinc-900 text-sm font-medium"
                  >Use password instead</button>
                </>
              )}
            </div>
          </div>
        )}

        <p className="text-center text-xs text-zinc-400">
          Your data is private and only visible to you.
        </p>
      </div>
    </div>
  );
}
