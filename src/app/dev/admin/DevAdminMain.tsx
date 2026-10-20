"use client";

import { usePathname } from "next/navigation";
import tokens from "@/components/admin/admin-tokens.module.css";

/**
 * The <main> of the dev admin pages. Each page under /dev/admin stands in for
 * a page rebuilt in the dark look (30% off, and each lane's page of admin
 * rebuild 2), so it gets the token class, as the real layout gives it to
 * those pages. The one exception is /dev/admin/frame: it shows the bar above
 * a light page as well, so it lays out its own grounds.
 */
export function DevAdminMain({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const ownGrounds =
    pathname === "/dev/admin/frame" || pathname.startsWith("/dev/admin/frame/");
  return (
    <main className={ownGrounds ? "flex-1" : `flex-1 ${tokens.tokens}`}>
      {children}
    </main>
  );
}
