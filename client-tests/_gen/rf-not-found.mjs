"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { ListHeader, ListPage } from "./rf-list-parts.mjs";
import { Button, Card, T } from "./rf-ui.mjs";
/**
 * The admin's not-found page (admin rebuild 2, the render review's fix
 * round): an admin address with no page, drawn in the admin's frame (the top
 * bar above it, the dark look) with a way back to the Dashboard. The old
 * addresses of the pages D2 removed land here: /admin/today, /admin/etfb,
 * /admin/stats, /admin/settings and /admin/discord. They used to get the
 * app's bare black 404, outside the frame.
 *
 * Drawn by src/app/admin/(authenticated)/not-found.tsx for the catch-all
 * [...missing], and by the dev page /dev/admin/missing.
 */
export function AdminNotFound() {
    return (_jsxs(ListPage, { children: [_jsx(ListHeader, { title: "Page not found", description: "There is no admin page at this address." }), _jsx(Card, { padding: 20, children: _jsxs("div", { "data-not-found": "", style: { display: "flex", flexDirection: "column", gap: 14, alignItems: "flex-start" }, children: [_jsx("p", { style: { ...T.body, lineHeight: 1.5 }, children: "If you followed an old link: Today, Brand Owners, Stats, Settings and Discord test were taken out of the admin." }), _jsx(Button, { variant: "raised", size: "md", href: "/admin", children: "Go to the Dashboard" })] }) })] }));
}
