import { AdminNotFound } from "@/components/admin/not-found/AdminNotFound";

/**
 * What an admin address with no page shows, inside the admin's frame
 * (layout.tsx: the team guard, the top bar, the dark look): the catch-all
 * [...missing]/page.tsx calls notFound(), and this, the nearest not-found of
 * the (authenticated) group, answers it with a 404 (admin rebuild 2, the
 * render review's fix round).
 */
export default function AdminMissing() {
  return <AdminNotFound />;
}
