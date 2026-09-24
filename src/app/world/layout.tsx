import { StudentGuard } from "@/components/auth/StudentGuard";
import { StudentProvider } from "@/contexts/StudentContext";
import { MembershipBlockOverlay } from "@/components/onboarding/MembershipBlockOverlay";

/**
 * The world's shell. Deliberately the same three wrappers as
 * app/dashboard/layout.tsx — same auth guard, same provider, same hard
 * membership gate — because /world must not become a way around any of them.
 *
 * The canvas is NOT mounted here yet. The plan puts it in the layout so it
 * survives navigation into area and lesson routes (App Router does not remount
 * layouts), which avoids reloading 4 MB on every back-press. That move lands
 * with the area screen in W7; until then the canvas lives on the page so the
 * route can be verified on its own.
 */
export default function WorldLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <StudentGuard>
      <StudentProvider>
        {children}
        <MembershipBlockOverlay />
      </StudentProvider>
    </StudentGuard>
  );
}
