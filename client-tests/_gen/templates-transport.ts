
import { createClient } from "./a2-browser-stub.ts";
import { callRoute } from "./call-route.ts";
import { loadTemplatesData } from "./templates-data.ts";
import type { TemplateStat, TemplatesTransport } from "./templates-data.ts";
import type { Template } from "./types-erased.ts";

/**
 * The Templates page's real calls (admin rebuild 2, WI-8), with the signed-in
 * team member's session. The read goes straight to the tables the team may
 * read (templates, regions, lessons, admin_config, as the page always read
 * them); every write goes through its route, which checks the role: the
 * templates routes and PUT /api/admin/config (founder and admin).
 */
export const templatesTransport: TemplatesTransport = {
  load: () => loadTemplatesData(createClient()),

  async loadStats() {
    const r = await callRoute<{ stats?: Record<string, TemplateStat> }>("GET", "/api/admin/templates/stats");
    return r.ok ? { ...r, data: r.data?.stats ?? {} } : r;
  },

  async saveTemplate(id, fields) {
    const r = await callRoute<{ template: Template }>("PUT", `/api/admin/templates/${encodeURIComponent(id)}`, fields);
    return r.ok ? { ...r, data: r.data.template } : r;
  },

  async setActive(id, isActive) {
    const r = await callRoute<{ template: Template }>("PUT", `/api/admin/templates/${encodeURIComponent(id)}`, {
      is_active: isActive,
    });
    return r.ok ? { ...r, data: r.data.template } : r;
  },

  async createTemplate(fields) {
    const r = await callRoute<{ template: Template }>("POST", "/api/admin/templates", {
      title: fields.title,
      intent: fields.intent,
      trigger_description: "",
      body: fields.body,
      bucket: fields.bucket,
      trigger_config: fields.trigger_config,
    });
    return r.ok ? { ...r, data: r.data.template } : r;
  },

  async deleteTemplate(id) {
    const r = await callRoute<unknown>("DELETE", `/api/admin/templates/${encodeURIComponent(id)}`);
    return r.ok ? { ...r, data: null } : r;
  },

  async saveSetting(key, value) {
    const r = await callRoute<{ row: { key: string; value: string } }>("PUT", "/api/admin/config", { key, value });
    return r.ok ? { ...r, data: { key: r.data.row.key, value: r.data.row.value } } : r;
  },
};
