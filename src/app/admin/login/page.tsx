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
            Team
          </h1>
          <p
            style={{
              fontSize: 14,
              color: "var(--color-text-secondary)",
              marginTop: 4,
              letterSpacing: "-0.005em",
            }}
          >
            EcomTalent internal dashboard
          </p>
        </header>

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
            id="email"
            label="Email"
            type="email"
            value={email}
            onChange={setEmail}
            placeholder="you@ecomtalent.com"
          />
          <FormField
            id="password"
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
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
              transition: "all 150ms cubic-bezier(0.25,0.1,0.25,1)",
              marginTop: 4,
            }}
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p
          style={{
            textAlign: "center",
            marginTop: 20,
            fontSize: 13,
            color: "var(--color-text-tertiary)",
          }}
        >
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
          height: 40,
          padding: "0 12px",
          background: "var(--color-bg-elevated)",
          border: "1px solid var(--color-border)",
          borderRadius: 10,
          fontSize: 14,
          color: "var(--color-text-primary)",
          letterSpacing: "-0.006em",
          outline: "none",
          transition: "border-color 150ms cubic-bezier(0.25,0.1,0.25,1)",
        }}
        onFocus={(e) =>
          (e.currentTarget.style.borderColor = "var(--color-accent)")
        }
        onBlur={(e) =>
          (e.currentTarget.style.borderColor = "var(--color-border)")
        }
      />
    </div>
  );
}
