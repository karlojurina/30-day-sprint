import {
  COMING_SOON_MESSAGE,
  COMING_SOON_WHOP_LINE,
} from "@/lib/student-app-gate";

/**
 * The only page a student sees while the student app is closed (T-078,
 * lib/student-app-gate.ts): the login (app/login/layout.tsx), every page under
 * StudentGuard, and their own Field Journal.
 *
 * No hooks, no motion and no data, so a server page and a client guard can
 * both render it, and nothing under it starts loading. No sign-in button and
 * no link: Lovro's words, the name above them, and one smaller line.
 */
export function ComingSoon() {
  return (
    <main className="relative min-h-screen flex flex-col items-center justify-center px-5">
      <div
        aria-hidden
        className="fixed inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 60% 50% at 50% 40%, var(--color-accent-glow) 0%, transparent 65%)",
          opacity: 0.4,
        }}
      />
      <div className="relative w-full max-w-[440px] text-center">
        <p className="mono-label-accent mb-4">Ecom University</p>
        <h1 className="display-heading text-[30px] sm:text-[40px] leading-[1.1]">
          {COMING_SOON_MESSAGE}
        </h1>
        <p className="mt-5 text-[15px] leading-relaxed text-[var(--color-text-secondary)]">
          {COMING_SOON_WHOP_LINE}
        </p>
      </div>
    </main>
  );
}
