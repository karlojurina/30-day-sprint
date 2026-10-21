import { notFound } from "next/navigation";

/**
 * Every admin address with no page of its own, the old addresses of the pages
 * admin rebuild 2 removed among them (/admin/today, /admin/etfb,
 * /admin/stats, /admin/settings, /admin/discord): a 404 that the group's
 * not-found.tsx draws inside the admin's frame, with a link to the Dashboard
 * (the render review's fix round). A page of its own always wins over this
 * one: Next matches a route with fixed or single segments before a
 * catch-all.
 */
export default function MissingAdminPage(): never {
  notFound();
}
