import { StudentGuard } from "@/components/auth/StudentGuard";
import { StudentProvider } from "@/contexts/StudentContext";
import { MembershipBlockOverlay } from "@/components/onboarding/MembershipBlockOverlay";
import { WorldStage } from "@/components/world/WorldStage";
import { WorldAccessGate } from "@/components/world/WorldAccessGate";

/**
 * The world's shell. Deliberately the same three wrappers as
 * app/dashboard/layout.tsx — same auth guard, same provider, same hard
 * membership gate — because /world must not become a way around any of them.
 *
 * WorldAccessGate sits OUTSIDE WorldStage on purpose: someone who is not on
 * the preview allowlist must be redirected before the canvas mounts, so they
 * never begin downloading 4 MB of glb on a phone.
 *
 * WorldStage sits inside the provider and outside the children, so the canvas
 * survives navigation into an area and into a lesson. App Router does not
 * remount layouts, so the world is parsed once per visit rather than once per
 * back-press.
 */
export default function WorldLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <StudentGuard>
      <StudentProvider>
        <WorldAccessGate>
          <WorldStage>{children}</WorldStage>
        </WorldAccessGate>
        <MembershipBlockOverlay />
      </StudentProvider>
    </StudentGuard>
  );
}
