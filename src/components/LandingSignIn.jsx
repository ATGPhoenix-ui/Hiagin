import { useState } from "react";
import { Loader2, Mail, Activity } from "lucide-react";
import { signInWithEmail } from "../sync/engine";

export function LandingSignIn() {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

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
      setError(e?.message || "Couldn't send sign-in link. Try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 flex flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm space-y-8">
        {/* Brand */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center bg-zinc-900 text-white p-3 rounded-2xl shadow-lg">
            <Activity className="w-8 h-8" />
          </div>
          <div>
            <h1 className="text-3xl font-extrabold text-zinc-900">Hiagin</h1>
            <p className="text-sm text-zinc-500 mt-1">Stay in touch with the people who matter.</p>
          </div>
        </div>

        {sent ? (
          <div className="bg-white rounded-2xl shadow-sm border border-zinc-200 p-6 text-center space-y-3">
            <div className="w-12 h-12 bg-emerald-100 rounded-full inline-flex items-center justify-center mx-auto">
              <Mail className="w-6 h-6 text-emerald-700" />
            </div>
            <div>
              <h2 className="font-bold text-zinc-900">Check your email</h2>
              <p className="text-sm text-zinc-600 mt-1">
                Sign-in link sent to <span className="font-semibold">{email}</span>. Tap it to open Hiagin.
              </p>
            </div>
            <button
              onClick={() => { setSent(false); setEmail(""); }}
              className="text-xs text-zinc-500 hover:text-zinc-900 underline pt-2"
            >
              Use a different email
            </button>
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm border border-zinc-200 p-6 space-y-4">
            <div className="space-y-1">
              <h2 className="font-bold text-zinc-900">Sign in to continue</h2>
              <p className="text-xs text-zinc-500">We'll email you a one-tap sign-in link. No password needed.</p>
            </div>
            <div className="space-y-2">
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
                className="w-full h-12 px-3 rounded-md border border-zinc-300 focus:ring-2 focus:ring-zinc-900 focus:outline-none text-base"
              />
              {error && <p className="text-sm text-rose-600">{error}</p>}
            </div>
            <button
              onClick={submit}
              disabled={pending || !email.trim()}
              className="w-full h-12 rounded-xl bg-zinc-900 text-white hover:bg-zinc-800 font-semibold inline-flex items-center justify-center transition disabled:opacity-50 active:scale-[0.98]"
            >
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Send sign-in link
            </button>
          </div>
        )}

        <p className="text-center text-xs text-zinc-400">
          Your data is private and only visible to you.
        </p>
      </div>
    </div>
  );
}
