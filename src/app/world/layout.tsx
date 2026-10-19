import type { Metadata } from "next";
import { Bricolage_Grotesque } from "next/font/google";
import { StudentGuard } from "@/components/auth/StudentGuard";
import { StudentProvider } from "@/contexts/StudentContext";
import { MembershipBlockOverlay } from "@/components/onboarding/MembershipBlockOverlay";
import { WorldStage } from "@/components/world/WorldStage";
import { WorldAccessGate } from "@/components/world/WorldAccessGate";
import { WorldPreload } from "@/components/world-v6/WorldPreload";
import { WORLD_IS_LIVE } from "@/lib/world/access";

/**
 * The world's shell. Deliberately the same three wrappers as
 * app/dashboard/layout.tsx — same auth guard, same provider, same hard
 * membership gate — because /world must not become a way around any of them.
 *
 * WorldAccessGate sits OUTSIDE WorldStage on purpose: someone who is not on
 * the preview allowlist must be redirected before the map mounts, so they
 * never begin loading it.
 *
 * WorldStage sits inside the provider and outside the children, so the canvas
 * survives navigation into an area and into a lesson. App Router does not
 * remount layouts, so the world is parsed once per visit rather than once per
 * back-press.
 *
 * The font is scoped to the world: the map and the screens over it read
 * Bricolage Grotesque through --font-v2-display (JetBrains Mono comes from the
 * root layout's variable). Same call as app/dev/world-v6/page.tsx.
 *
 * WorldPreload sits outside the guard on purpose (speed, 2026-10-20): the 3D
 * map's code starts downloading while the login and the student's data are
 * on their way. Only once the world is open to everyone: before that the
 * gate decides first, as above.
 */

const display = Bricolage_Grotesque({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-v2-display",
  axes: ["opsz"],
});

/** The tab's title on the map and every page over it (Lovro's review, 2026-10-15: "everything is going to be Ecom University"). */
export const metadata: Metadata = {
  title: "Ecom University",
};

export default function WorldLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <WorldPreload when={WORLD_IS_LIVE} />
      <StudentGuard>
        <StudentProvider>
          <WorldAccessGate>
            <div className={display.variable}>
              <WorldStage>{children}</WorldStage>
            </div>
          </WorldAccessGate>
          <MembershipBlockOverlay />
        </StudentProvider>
      </StudentGuard>
    </>
  );
}
