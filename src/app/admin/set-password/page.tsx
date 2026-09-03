"use client";

/**
 * /admin/set-password
 *
 * Landing page for the magic link Supabase fires when a founder
 * invites a new team member from /admin/team. Click the email →
 * Supabase confirms the address and signs the user in → we land
 * them here so they can set a real password.
 *
 * Flow:
 *   1. Page mounts, reads supabase.auth.getSession()
 *   2. If no session: tell them the link expired or send to /admin/login
 *   3. If session: show password + confirm fields
 *   4. On submit: supabase.auth.updateUser({ password }) → /admin
 *
 * v75.4 - new with the team-management invite flow.
 */

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";

export default function SetPasswordPage() {
  const supabase = createClient();
  const [email, setEmail] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionState, setSessionState] = useState<
    "loading" | "ok" | "missing"
  >("loading");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session?.user) {
        setEmail(data.session.user.email ?? null);
        setSessionState("ok");
      } else {
        setSessionState("missing");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({
      password,
    });
    if (updateError) {
      setError(updateError.message);
      setLoading(false);
      return;
    }
    window.location.href = "/admin";
  }

  return (
    <div
      className="admin-shell flex flex-col items-center justify-center min-h-screen px-4"
      style={{ background: "var(--color-bg-primary)" }}
    >
      <div className="w-full" style={{ maxWidth: 380 }}>
        <header style={{ marginBottom: 32, textAlign: "center" }}>
          <h1
            style={{
              fontSize: 26,
              fontWeight: 600,
              letterSpacing: "-0.022em",
              color: "var(--color-text-primary)",
              lineHeight: 1.15,
            }}
          >
            Set your password
          </h1>
          <p
            style={{
              fontSize: 14,
              color: "var(--color-text-secondary)",
              marginTop: 4,
              letterSpacing: "-0.005em",
            }}
          >
            Welcome to EcomTalent
            {email ? (
              <>
                {", "}
                <span style={{ color: "var(--color-text-primary)" }}>
                  {email}
                </span>
              </>
            ) : null}
            .
          </p>
        </header>

        {sessionState === "loading" && (
          <div
            className="surface-resting"
            style={{
              background: "var(--color-bg-card)",
              borderRadius: 16,
              padding: 24,
              textAlign: "center",
              color: "var(--color-text-tertiary)",
              fontSize: 13,
            }}
          >
            Checking your invite…
          </div>
        )}

        {sessionState === "missing" && (
          <div
            className="surface-resting"
            style={{
              background: "var(--color-bg-card)",
              borderRadius: 16,
              padding: 24,
              display: "flex",
              flexDirection: "column",
              gap: 12,
              textAlign: "center",
            }}
          >
            <p
              style={{
                fontSize: 14,
                color: "var(--color-text-primary)",
                letterSpacing: "-0.005em",
                lineHeight: 1.5,
              }}
            >
              This invite link has expired or already been used.
            </p>
            <p
              style={{
                fontSize: 13,
                color: "var(--color-text-tertiary)",
                lineHeight: 1.5,
              }}
            >
              Ask a founder to send a fresh invite from{" "}
              <span style={{ color: "var(--color-text-secondary)" }}>
                Team
              </span>
              , or sign in below if you already have a password.
            </p>
            <a
              href="/admin/login"
              style={{
                marginTop: 4,
                display: "inline-block",
                color: "var(--color-accent-dark)",
                textDecoration: "none",
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              Go to sign in →
            </a>
          </div>
        )}

        {sessionState === "ok" && (
          <form
            onSubmit={handleSubmit}
            className="surface-resting"
            style={{
              background: "var(--color-bg-card)",
              borderRadius: 16,
              padding: 24,
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            {error && (
              <div
                style={{
                  background: "rgba(200,74,74,0.08)",
                  borderRadius: 8,
                  padding: "10px 12px",
                  fontSize: 13,
                  color: "var(--color-danger)",
                }}
              >
                {error}
              </div>
            )}

            <FormField
              id="password"
              label="New password"
              type="password"
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
              minLength={8}
              hint="At least 8 characters."
            />
            <FormField
              id="confirm"
              label="Confirm password"
              type="password"
              value={confirm}
              onChange={setConfirm}
              autoComplete="new-password"
              minLength={8}
            />

            <button
              type="submit"
              disabled={loading}
              style={{
                height: 40,
                borderRadius: 10,
                border: "none",
                background: loading
                  ? "var(--color-accent-dark)"
                  : "var(--color-accent)",
                color: "#FFFFFF",
                fontSize: 14,
                fontWeight: 600,
                letterSpacing: "-0.011em",
                cursor: loading ? "default" : "pointer",
                opacity: loading ? 0.7 : 1,
                transition: "all 150ms var(--ease-default)",
                marginTop: 4,
              }}
            >
              {loading ? "Saving…" : "Set password & continue"}
            </button>
          </form>
        )}

        <p
          style={{
            textAlign: "center",
            marginTop: 20,
            fontSize: 13,
            color: "var(--color-text-tertiary)",
          }}
        >
          <a
            href="/admin/login"
            style={{
              color: "var(--color-accent-dark)",
              textDecoration: "none",
            }}
          >
            Already set a password? Sign in →
          </a>
        </p>
      </div>
    </div>
  );
}

function FormField({
  id,
  label,
  type,
  value,
  onChange,
  placeholder,
  autoComplete,
  minLength,
  hint,
}: {
  id: string;
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: string;
  minLength?: number;
  hint?: string;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        style={{
          display: "block",
          fontSize: 13,
          fontWeight: 500,
          color: "var(--color-text-secondary)",
          marginBottom: 6,
          letterSpacing: "-0.005em",
        }}
      >
        {label}
      </label>
      <input
        id={id}
        type={type}
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        minLength={minLength}
        style={{
          width: "100%",
          height: 40,
          padding: "0 12px",
          background: "var(--color-bg-elevated)",
          border: "1px solid var(--color-border)",
          borderRadius: 10,
          fontSize: 14,
          color: "var(--color-text-primary)",
          letterSpacing: "-0.006em",
          outline: "none",
          transition: "border-color 150ms var(--ease-default)",
        }}
        onFocus={(e) =>
          (e.currentTarget.style.borderColor = "var(--color-accent)")
        }
        onBlur={(e) =>
          (e.currentTarget.style.borderColor = "var(--color-border)")
        }
      />
      {hint && (
        <p
          style={{
            marginTop: 6,
            fontSize: 11,
            color: "var(--color-text-tertiary)",
            letterSpacing: "-0.003em",
          }}
        >
          {hint}
        </p>
      )}
    </div>
  );
}
