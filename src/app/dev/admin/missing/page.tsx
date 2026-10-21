"use client";

import { AdminTopNav } from "@/components/admin/AdminTopNav";
import { AdminNotFound } from "@/components/admin/not-found/AdminNotFound";

/**
 * /dev/admin/missing: the admin's not-found page (an admin address with no
 * page, the removed pages' old ones among them) under the real top bar, for a
 * made-up csm, with no login (admin rebuild 2, the render review's fix round).
 * The real one is src/app/admin/(authenticated)/not-found.tsx.
 */

const DEV_MEMBER = { full_name: "Robin Hale", role: "csm" } as const;

export default function DevMissingPage() {
  return (
    <>
      {/* An address with no page: the bar marks no entry. */}
      <AdminTopNav member={DEV_MEMBER} pathname="/admin/an-old-address" onSignOut={() => {}} />
      <AdminNotFound />
    </>
  );
}
