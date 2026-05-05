"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { useRouter } from "next/navigation";

export default function TeamLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      setError("Invalid email or password");
      setLoading(false);
      return;
    }

    // Hard reload — AuthContext will use /api/auth/me to verify team membership
    window.location.href = "/admin";
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight">Team Login</h1>
          <p className="mt-2 text-text-secondary text-sm">
            EcomTalent internal dashboard
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="bg-danger/10 border border-danger/20 rounded-lg px-4 py-3 text-sm text-danger">
              {error}
            </div>
          )}

          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-text-secondary mb-1"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 min-h-10 bg-bg-card border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent focus-visible:outline-2 focus-visible:outline-[var(--color-gold)] focus-visible:outline-offset-2 transition-colors"
              placeholder="you@ecomtalent.com"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-text-secondary mb-1"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 min-h-10 bg-bg-card border border-border rounded-lg text-text-primary focus:outline-none focus:border-accent focus-visible:outline-2 focus-visible:outline-[var(--color-gold)] focus-visible:outline-offset-2 transition-colors"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full px-6 py-3 text-base font-semibold rounded-lg bg-accent hover:bg-accent-dark transition-colors disabled:opacity-50"
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <p className="text-center text-sm text-text-tertiary">
          <a
            href="/login"
            className="hover:text-text-secondary transition-colors underline"
          >
            Student login
          </a>
        </p>
      </div>
    </div>
  );
}
