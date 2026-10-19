"use client";

import { useState } from "react";
import { Button } from "@/components/admin/ui";
import tokens from "@/components/admin/admin-tokens.module.css";
import { createClient } from "@/lib/supabase-browser";
import { useRouter } from "next/navigation";

/**
 * The team's sign-in, in the brand kit's dark look (admin rebuild PRD,
 * call C1): the white Ecom University lockup and one ink button.
 *
 * .admin-shell on the outer element turns off the student side's paper
 * grain; the token class sits on the full-screen wrapper inside it, never on
 * the same element (admin-tokens.module.css says why).
 */
export default function TeamLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();
  void router;

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

    window.location.href = "/admin";
  }

  return (
    <div className="admin-shell min-h-screen">
      <div
        className={`${tokens.tokens} flex flex-col items-center justify-center min-h-screen px-4`}
        style={{ paddingBlock: 48 }}
      >
        <div className="w-full" style={{ maxWidth: 380 }}>
          <header style={{ marginBottom: 32, textAlign: "center" }}>
            <Lockup />
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
              Team
            </h1>
            <p
              style={{
                fontSize: 15,
                color: "var(--color-text-secondary)",
                marginTop: 6,
              }}
            >
              Ecom University internal dashboard
            </p>
          </header>

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
            {error && <FormError message={error} />}

            <FormField
              id="email"
              label="Email"
              type="email"
              value={email}
              onChange={setEmail}
            />
            <FormField
              id="password"
              label="Password"
              type="password"
              value={password}
              onChange={setPassword}
            />

            <div style={{ display: "flex", flexDirection: "column", marginTop: 4 }}>
              <Button variant="ink" size="md" type="submit" busy={loading}>
                {loading ? "Signing in…" : "Sign in"}
              </Button>
            </div>
          </form>

          <p style={{ textAlign: "center", marginTop: 20, fontSize: 13 }}>
            <a
              href="/login"
              style={{
                color: "var(--color-accent-dark)",
                textDecoration: "none",
              }}
            >
              Student login →
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}

function Lockup() {
  return (
    // eslint-disable-next-line @next/next/no-img-element
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
  );
}

function FormError({ message }: { message: string }) {
  return (
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
      {message}
    </p>
  );
}

function FormField({
  id,
  label,
  type,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
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
        style={{
          width: "100%",
          height: 44,
          padding: "0 12px",
          background: "var(--color-bg-elevated)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-control)",
          fontSize: 15,
          color: "var(--color-text-primary)",
          outline: "none",
          transition: "border-color 150ms var(--ease-default)",
        }}
        onFocus={(e) =>
          (e.currentTarget.style.borderColor = "var(--color-accent-dark)")
        }
        onBlur={(e) =>
          (e.currentTarget.style.borderColor = "var(--color-border)")
        }
      />
    </div>
  );
}
