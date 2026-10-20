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
 *   4. On submit: supabase.auth.updateUser({ password }) → /admin/today,
 *      where signing in lands too (admin rebuild PRD, call C2)
 *
 * v75.4 - new with the team-management invite flow.
 *
 * In the brand kit's dark look since the admin rebuild (PRD, call C1), the
 * same frame as /admin/login: .admin-shell outside, the token class on the
 * full-screen wrapper inside it, the white lockup and one ink button.
 */

import { useEffect, useState } from "react";
import { Button } from "@/components/admin/ui";
import tokens from "@/components/admin/admin-tokens.module.css";
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
    window.location.href = "/admin/today";
  }

  return (
    <div className="admin-shell min-h-screen">
      <div
        className={`${tokens.tokens} flex flex-col items-center justify-center min-h-screen px-4`}
        style={{ paddingBlock: 48 }}
      >
        <div className="w-full" style={{ maxWidth: 380 }}>
          <header style={{ marginBottom: 32, textAlign: "center" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/ecomu-ad-creative-white.svg"
              width={3142}
              height={233}
              alt="Ecom University"
              draggable={false}
              style={{
                display: "block",
                margin: "0 auto",
                width: "auto",
                height: "auto",
                maxHeight: 20,
                maxWidth: "100%",
              }}
            />
            <h1
              style={{
                marginTop: 32,
                fontSize: 28,
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
                fontSize: 15,
                color: "var(--color-text-secondary)",
                marginTop: 6,
              }}
            >
              Welcome to Ecom University
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
                borderRadius: "var(--radius-card)",
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
                borderRadius: "var(--radius-card)",
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
                borderRadius: "var(--radius-card)",
                padding: 24,
                display: "flex",
                flexDirection: "column",
                gap: 16,
              }}
            >
              {error && (
                <p
                  role="alert"
                  style={{
                    margin: 0,
                    padding: "2px 0 2px 12px",
                    borderLeft: "2px solid var(--color-danger)",
                    fontSize: 13,
                    lineHeight: 1.45,
                    color: "var(--color-danger)",
                  }}
                >
                  {error}
                </p>
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

              <div style={{ display: "flex", flexDirection: "column", marginTop: 4 }}>
                <Button variant="ink" size="md" type="submit" busy={loading}>
                  {loading ? "Saving…" : "Set password and continue"}
                </Button>
              </div>
            </form>
          )}

          {/* The expired card has its own link to sign in: one is enough. */}
          {sessionState !== "missing" && (
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
          )}
        </div>
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
          height: 44,
          padding: "0 12px",
          background: "var(--color-bg-elevated)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-control)",
          fontSize: 15,
          color: "var(--color-text-primary)",
          transition: "border-color 150ms var(--ease-default)",
        }}
        onFocus={(e) =>
          (e.currentTarget.style.borderColor = "var(--color-accent-dark)")
        }
        onBlur={(e) =>
          (e.currentTarget.style.borderColor = "var(--color-border)")
        }
      />
      {hint && (
        <p
          style={{
            marginTop: 6,
            fontSize: 12,
            color: "var(--color-text-tertiary)",
          }}
        >
          {hint}
        </p>
      )}
    </div>
  );
}
