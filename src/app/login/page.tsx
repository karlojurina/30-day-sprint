import { Suspense } from "react";
import { Bricolage_Grotesque } from "next/font/google";
import tokens from "@/components/world-v6/tokens.module.css";
import { LoginError } from "./LoginError";
import s from "./login.module.css";

/**
 * The login (Lovro, 2026-10-19: "make the login prettier"): the map's
 * opening still with the words where the map's welcome stands, the logo
 * where the map's header has it, the world's tokens and type.
 *
 * A server page, so the still, the words and the button are in the HTML and
 * paint before the scripts load. Only the error reads the address
 * (LoginError), so only it waits inside Suspense.
 *
 * The world's display face, scoped to this page as app/world/layout.tsx
 * scopes it to the map (JetBrains Mono comes from the root layout).
 */

const display = Bricolage_Grotesque({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-v2-display",
  axes: ["opsz"],
});

export default function LoginPage() {
  return (
    <main className={`${tokens.tokens} ${display.variable} ${s.root}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className={s.still}
        src="/world-v6/posters/k0.webp"
        width={1920}
        height={1080}
        alt=""
        fetchPriority="high"
        draggable={false}
      />
      <div aria-hidden="true" className={s.shade} />

      <header className={s.header}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className={s.logo}
          src="/brand/ecomu-ad-creative-white.svg"
          width={3142}
          height={233}
          alt="Ecom University, Ad Creative"
          draggable={false}
        />
      </header>

      <div className={s.content}>
        <h1 className={s.title}>Your map through the course.</h1>
        <p className={s.line}>
          Sign in with your Whop account to pick up where you left off.
        </p>

        <Suspense fallback={null}>
          <LoginError />
        </Suspense>

        <a href="/api/auth/whop/authorize" className={s.signIn}>
          Sign in with Whop
          <svg
            className={s.arrow}
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M2.5 8h10.5M9.5 4.5 13 8l-3.5 3.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </a>
        <a href="/admin/login" className={s.team}>
          Team login →
        </a>
      </div>
    </main>
  );
}
