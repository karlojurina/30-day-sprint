import { StudentGuard } from "@/components/auth/StudentGuard";
import { StudentProvider } from "@/contexts/StudentContext";
import { MembershipBlockOverlay } from "@/components/onboarding/MembershipBlockOverlay";
import { WorldStage } from "@/components/world/WorldStage";

/**
 * The world's shell. Deliberately the same three wrappers as
 * app/dashboard/layout.tsx — same auth guard, same provider, same hard
 * membership gate — because /world must not become a way around any of them.
 *
 * WorldStage sits INSIDE the provider and OUTSIDE the children, so the canvas
 * survives navigation into an area and into a lesson. App Router does not
 * remount layouts, so the 4 MB world is downloaded and parsed exactly once per
 * visit rather than once per back-press.
 */
export default function WorldLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <StudentGuard>
      <StudentProvider>
        <WorldStage>{children}</WorldStage>
        <MembershipBlockOverlay />
      </StudentProvider>
    </StudentGuard>
  );
}
