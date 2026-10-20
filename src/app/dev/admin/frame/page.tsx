import { FrameView, type FrameGround, type FrameRole } from "./FrameView";

/**
 * /dev/admin/frame: the admin's top bar for a made-up team member, above a
 * page (admin rebuild PRD, Work Item 1).
 *
 *   ?role=founder | csm | admin   whose bar (default founder); each role sees
 *                                 the entries its flags allow
 *   ?ground=light | dark          the page under the bar (default light): one
 *                                 of the pages that keep the light look, or a
 *                                 page in the dark look, both built from
 *                                 ui.tsx pieces
 *
 * Under 1100px wide the bar shows one Menu button; click it to see the list.
 */

const ROLES: FrameRole[] = ["founder", "csm", "admin"];
const GROUNDS: FrameGround[] = ["light", "dark"];

function pick<T extends string>(
  value: string | string[] | undefined,
  allowed: T[],
  fallback: T,
): T {
  return allowed.find((a) => a === value) ?? fallback;
}

export default async function AdminFramePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  return (
    <FrameView
      role={pick(params.role, ROLES, "founder")}
      ground={pick(params.ground, GROUNDS, "light")}
    />
  );
}
