import { useState } from "react";
import { api } from "../lib/api.js";

interface LoginProps {
  onAuth: () => void;
  needsSetup: boolean;
}

export function Login({ onAuth, needsSetup }: LoginProps) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const isSetup = needsSetup;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (isSetup && password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }

    setLoading(true);
    try {
      if (isSetup) {
        await api.setupAuth(password);
      } else {
        await api.login(password);
      }
      onAuth();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#09090b]">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-violet-600 mb-4">
            <span className="text-3xl font-serif text-white">&mu;</span>
          </div>
          <h1 className="text-2xl font-bold text-zinc-100 tracking-tight">Melista</h1>
          <p className="text-sm text-zinc-500 mt-1">
            {isSetup ? "Set a password to secure your dashboard" : "Sign in to your dashboard"}
          </p>
        </div>

        {/* Form */}
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div>
            <label className="text-[11px] text-zinc-500 font-semibold uppercase tracking-wider block mb-1.5">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isSetup ? "Create a password" : "Enter your password"}
              autoFocus
              className="w-full bg-zinc-900/80 border border-zinc-800/80 rounded-lg px-4 py-3 text-sm text-zinc-300 focus:outline-none focus:border-violet-500 transition-colors"
            />
          </div>

          {isSetup && (
            <div>
              <label className="text-[11px] text-zinc-500 font-semibold uppercase tracking-wider block mb-1.5">
                Confirm Password
              </label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Confirm your password"
                className="w-full bg-zinc-900/80 border border-zinc-800/80 rounded-lg px-4 py-3 text-sm text-zinc-300 focus:outline-none focus:border-violet-500 transition-colors"
              />
            </div>
          )}

          {error && (
            <p className="text-[12px] text-red-400 font-medium">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-lg text-sm font-semibold transition-colors disabled:opacity-30 text-white bg-violet-600 hover:bg-violet-500"
          >
            {loading ? "..." : isSetup ? "Create Password" : "Sign In"}
          </button>
        </form>

        <p className="text-center text-[10px] text-zinc-700 mt-6">
          Autonomous AI Agent &middot; v0.1.0
        </p>
      </div>
    </div>
  );
}
