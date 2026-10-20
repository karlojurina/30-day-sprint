/**
 * The Templates page's data and rules (admin rebuild 2, WI-8: PRD D6 and
 * D12). What the page reads, and every rule its pieces show: the Message
 * settings panel's warnings and switches, the preview's links, which
 * templates can be deleted, and what Save sends.
 *
 * No React and no browser client here, so client-tests/templates-page.test.mjs
 * runs the loader on the stand-in database and the rules as they are. The
 * real calls are src/lib/admin/templates-transport.ts; the dev page
 * /dev/admin/templates hands the same view made-up data
 * (src/app/dev/admin/templates-fixtures.ts).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Answer } from "./types-erased.ts";
import { getCurriculumResetAt } from "./curriculum-reset.ts";
import { REGION_LABEL } from "./csm-triggers.ts";
import { onOffView, readLiveCourse } from "./template-on-off.ts";
import type { LiveRead } from "./template-on-off.ts";
import {
  CONFIG_SWITCH_KEYS,
  EDITABLE_CONFIG_KEYS,
  isEditableConfigKey,
} from "./config-keys.ts";
import type { EditableConfigKey } from "./config-keys.ts";
import type { Template, TemplateBucket, TriggerConfig } from "./types-erased.ts";

/* ─── What the page reads ─── */

/** Per-template numbers from GET /api/admin/templates/stats (src/lib/outreach-insights.ts). */
export interface TemplateStat {
  created: number;
  open: number;
  sent: number;
  dismissed: number;
  replied: number;
  no_reply: number;
  success: number;
  success_eligible: number;
  success_label: string;
  /** Sends from before the course switch, left out of success. 0 before it. */
  graded_on_old_course: number;
}

/** One choice in the trigger editor's area and lesson dropdowns. */
export interface TriggerOption {
  id: string;
  label: string;
}

/** What the trigger editor offers, read from the live catalog. */
export interface TriggerCatalog {
  /** Areas in order_num order. */
  regions: TriggerOption[];
  /** Lessons with an action item, in course order. */
  actionLessons: TriggerOption[];
  /** True once the course switch has run. */
  courseIsNew: boolean;
}

/** The editor's read of the catalog: the catalog, or why it could not be read. */
export interface TriggerCatalogRead {
  catalog: TriggerCatalog | null;
  error: string | null;
}

/** The 6 message settings as admin_config holds them; null for a key that has no row. */
export type SettingValues = Record<EditableConfigKey, string | null>;

/** The panel's read of the settings: the values, or why they could not be read. */
export type SettingsRead = { ok: true; values: SettingValues } | { ok: false; error: string };

export interface TemplatesData {
  templates: Template[];
  /** The live course, for the on/off switch (src/lib/template-on-off.ts). */
  live: LiveRead;
  /** The live catalog, for the trigger editor. */
  trigger: TriggerCatalogRead;
  /** The 2 message links and the 4 Discord switches. */
  settings: SettingsRead;
}

/** A new custom template, as the page's dialog sends it to POST /api/admin/templates. */
export interface NewTemplateFields {
  title: string;
  intent: string;
  body: string;
  bucket: TemplateBucket;
  trigger_config: TriggerConfig;
}

/**
 * What the Templates page calls. The real calls are
 * src/lib/admin/templates-transport.ts; the dev page's are made-up
 * (src/app/dev/admin/templates-fixtures.ts). No call throws: each answers
 * `{ ok: true, data }` or `{ ok: false, error }` (admin-transport.ts).
 */
export interface TemplatesTransport {
  /** The templates, the live course, the trigger catalog and the message settings (loadTemplatesData). */
  load(): Promise<Answer<TemplatesData>>;
  /** GET /api/admin/templates/stats. The editor works without it. */
  loadStats(): Promise<Answer<Record<string, TemplateStat>>>;
  /** PUT /api/admin/templates/:id with the fields that changed (changedFields). */
  saveTemplate(id: string, fields: Record<string, unknown>): Promise<Answer<Template>>;
  /** PUT /api/admin/templates/:id with { is_active } and nothing else. */
  setActive(id: string, isActive: boolean): Promise<Answer<Template>>;
  /** POST /api/admin/templates. */
  createTemplate(fields: NewTemplateFields): Promise<Answer<Template>>;
  /** DELETE /api/admin/templates/:id, a custom template only. */
  deleteTemplate(id: string): Promise<Answer<null>>;
  /** PUT /api/admin/config, one of the 6 keys. */
  saveSetting(key: EditableConfigKey, value: string): Promise<Answer<{ key: string; value: string }>>;
}

/**
 * The page's read, with the team member's client: the templates, the live
 * course, the trigger editor's catalog and the message settings, all at
 * once. Only the templates are needed to show the page: a failed read of
 * them fails the load (the page shows the error and Retry); a failed read of
 * any other part is kept with its reason, and the part that needs it says so.
 */
export async function loadTemplatesData(supabase: SupabaseClient): Promise<Answer<TemplatesData>> {
  const [templatesRes, live, trigger, settings] = await Promise.all([
    supabase
      .from("templates")
      .select("*")
      .order("week", { nullsFirst: false })
      .order("scenario_id"),
    readLiveCourse(supabase).then(
      (course): LiveRead => ({ course, error: null }),
      (e: unknown): LiveRead => ({ course: null, error: e instanceof Error ? e.message : String(e) }),
    ),
    readTriggerCatalog(supabase),
    readMessageSettings(supabase),
  ]);
  if (templatesRes.error) {
    return { ok: false, status: 500, error: `The templates could not be read: ${templatesRes.error.message}` };
  }
  return {
    ok: true,
    status: 200,
    data: { templates: sortTemplates((templatesRes.data ?? []) as Template[]), live, trigger, settings },
  };
}

/**
 * The areas, the lessons with an action item and the switch's moment, for
 * the trigger editor (moved here from TriggerBuilder.tsx, which read them
 * itself for every open row). Never throws.
 */
export async function readTriggerCatalog(supabase: SupabaseClient): Promise<TriggerCatalogRead> {
  try {
    const [resetAt, regionsRes, lessonsRes] = await Promise.all([
      getCurriculumResetAt(supabase),
      supabase.from("regions").select("id, name, order_num").order("order_num"),
      supabase
        .from("lessons")
        .select("id, title, region_id, day, sort_order")
        .eq("requires_action", true),
    ]);
    if (regionsRes.error) throw new Error(`areas: ${regionsRes.error.message}`);
    if (lessonsRes.error) throw new Error(`lessons: ${lessonsRes.error.message}`);
    const regions = (regionsRes.data ?? []) as Array<{ id: string; name: string; order_num: number }>;
    const order = new Map(regions.map((r) => [r.id, r.order_num]));
    const lessons = [
      ...((lessonsRes.data ?? []) as Array<{
        id: string;
        title: string;
        region_id: string;
        day: number | null;
        sort_order: number;
      }>),
    ].sort(
      (a, b) =>
        (order.get(a.region_id) ?? 0) - (order.get(b.region_id) ?? 0) ||
        (a.day ?? 0) - (b.day ?? 0) ||
        a.sort_order - b.sort_order,
    );
    return {
      catalog: {
        regions: regions.map((r) => ({
          id: r.id,
          label: REGION_LABEL[r.id] ?? `Area ${r.order_num} (${r.name})`,
        })),
        actionLessons: lessons.map((l) => ({ id: l.id, label: `${l.title} (${l.id})` })),
        courseIsNew: resetAt != null,
      },
      error: null,
    };
  } catch (e) {
    return { catalog: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/** The 6 keys PUT /api/admin/config writes, as they stand. Never throws. */
export async function readMessageSettings(supabase: SupabaseClient): Promise<SettingsRead> {
  try {
    const { data, error } = await supabase
      .from("admin_config")
      .select("key, value")
      .in("key", [...EDITABLE_CONFIG_KEYS]);
    if (error) return { ok: false, error: error.message };
    const values = Object.fromEntries(EDITABLE_CONFIG_KEYS.map((k) => [k, null])) as SettingValues;
    for (const row of (data ?? []) as Array<{ key: string; value: string | null }>) {
      if (isEditableConfigKey(row.key)) values[row.key] = row.value ?? "";
    }
    return { ok: true, values };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/* ─── The list ─── */

/** The day groups in a student's order, then the team's own templates. */
const WEEK_ORDER = ["D01", "D03", "D05", "D07", "D10", "D14", "D21", "M2", "CUSTOM"];

export const GROUP_LABEL: Record<string, string> = {
  D01: "Day 1",
  D03: "Day 3",
  D05: "Day 5",
  D07: "Day 7",
  D10: "Day 10",
  D14: "Day 14",
  D21: "Day 21",
  M2: "Month 2",
  CUSTOM: "Custom templates",
};

export function weekRank(w: string | null): number {
  if (!w) return 99;
  const i = WEEK_ORDER.indexOf(w);
  return i === -1 ? 99 : i;
}

/** The templates in the page's order: by day, then by scenario. */
export function sortTemplates(rows: Template[]): Template[] {
  return [...rows].sort(
    (a, b) => weekRank(a.week) - weekRank(b.week) || a.scenario_id.localeCompare(b.scenario_id),
  );
}

/** The groups the page shows, in order. A custom template goes under Custom templates whatever its week. */
export function groupTemplates(rows: Template[]): Array<{ key: string; label: string; templates: Template[] }> {
  const groups = new Map<string, Template[]>();
  for (const r of rows) {
    const key = r.is_custom ? "CUSTOM" : (r.week ?? "OTHER");
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => weekRank(a) - weekRank(b) || a.localeCompare(b))
    .map(([key, templates]) => ({ key, label: GROUP_LABEL[key] ?? "Other", templates }));
}

/** The bucket in words, never the glyph alone. */
export const BUCKET_WORDS: Record<TemplateBucket, string> = {
  crushing: "Crushing it",
  on_track: "On track",
  at_risk: "At risk",
  cancel_path: "Cancel path",
  event: "Event",
  admin: "Admin",
};

/** The buckets a template can be put in (the create route takes these five). */
export const BUCKET_OPTIONS: TemplateBucket[] = ["crushing", "on_track", "at_risk", "cancel_path", "event"];

/** What each bucket means, for the key above the list. */
export const BUCKET_MEANING: Record<Exclude<TemplateBucket, "admin">, string> = {
  crushing: "A student hit a milestone. Celebrate it.",
  on_track: "All is well. A light check-in.",
  at_risk: "Early warning signs. Step in now.",
  cancel_path: "Inactive or leaving. A last try to bring them back.",
  event: "Sent at a moment: the welcome, month 2.",
};

/**
 * Only a custom template can be deleted (admin rebuild 2, WI-8). A built-in
 * has no way back: no route can make its scenario again, and the crons that
 * look for it go quiet. Where its switch works (template-on-off.ts), Turn
 * off stops it instead. DELETE /api/admin/templates/:id refuses a built-in
 * too.
 */
export function canDelete(t: Pick<Template, "is_custom">): boolean {
  return t.is_custom === true;
}

/* ─── Editing ─── */

/** What a row's editor holds. */
export interface DraftFields {
  title: string;
  trigger_description: string;
  intent: string;
  body: string;
  bucket: TemplateBucket;
  trigger_config: TriggerConfig;
}

export const EMPTY_TRIGGER: TriggerConfig = { all: [] };

export function draftOf(t: Template): DraftFields {
  return {
    title: t.title,
    trigger_description: t.trigger_description ?? "",
    intent: t.intent ?? "",
    body: t.body ?? "",
    bucket: t.bucket,
    trigger_config: t.trigger_config ?? EMPTY_TRIGGER,
  };
}

/**
 * What Save sends for template `t`: only the fields the draft changed.
 *
 * The page used to send the bucket and the conditions with every save, so a
 * built-in saved for its text got trigger_config {"all": []} where it held
 * null. check-csm-tasks' auto-dismiss reads any trigger_config it finds
 * (path 2), and an empty list never matches, so every open task of that
 * template (stalled.*, welcome.day1) would be dismissed on the next run.
 * Conditions are sent only when they changed, and an empty list is sent as
 * null: no conditions, so a built-in keeps its own rule.
 */
export function changedFields(t: Template, d: DraftFields): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (d.title !== t.title) out.title = d.title;
  if (d.trigger_description !== (t.trigger_description ?? "")) out.trigger_description = d.trigger_description;
  if (d.intent !== (t.intent ?? "")) out.intent = d.intent;
  if (d.body !== (t.body ?? "")) out.body = d.body;
  if (d.bucket !== t.bucket) out.bucket = d.bucket;
  const saved = t.trigger_config?.all ?? [];
  if (JSON.stringify(d.trigger_config.all) !== JSON.stringify(saved)) {
    out.trigger_config = d.trigger_config.all.length > 0 ? d.trigger_config : null;
  }
  return out;
}

export function isDirty(t: Template, d: DraftFields | undefined): boolean {
  return d !== undefined && Object.keys(changedFields(t, d)).length > 0;
}

/* ─── Message settings (D6) ─── */

/** Where the program link should point since the new course: the app's own address. */
export const PROGRAM_HOST = "sprint.ecomuniversity.com";

export type LinkPlaceholder = "programLink" | "discordInvite";

/** The placeholder each link fills in (src/lib/templates.ts, renderTemplate). */
export const LINK_PLACEHOLDER: Record<"program_login_link" | "discord_invite_link", LinkPlaceholder> = {
  program_login_link: "programLink",
  discord_invite_link: "discordInvite",
};

/** Whether a template's body uses a placeholder, as renderTemplate finds it. */
export function usesPlaceholder(body: string | null | undefined, name: LinkPlaceholder): boolean {
  return typeof body === "string" && body.includes(`{${name}}`);
}

/**
 * Whether template `t` goes out to students as things stand: it is on, or
 * its tasks are made whether it is on or off (template-on-off.ts, a switch
 * that would not stop them). A template that is off where its switch works
 * sends nothing.
 */
export function goesOut(t: Pick<Template, "scenario_id" | "is_active" | "trigger_config">, live: LiveRead): boolean {
  return t.is_active || onOffView(t, live, false).kind === "none";
}

/** The templates that go out with a placeholder in their text. */
export function messagesUsing(templates: Template[], live: LiveRead, name: LinkPlaceholder): Template[] {
  return templates.filter((t) => goesOut(t, live) && usesPlaceholder(t.body, name));
}

const messages = (n: number) => `${n} ${n === 1 ? "message" : "messages"}`;
const send = (n: number) => (n === 1 ? "sends" : "send");

/**
 * Why the program link is wrong, or null when it is a web address on
 * sprint.ecomuniversity.com. The live value on 20 October was the old
 * Vercel address.
 */
export function programLinkProblem(value: string | null | undefined): "empty" | "not-a-link" | "other-host" | null {
  const v = (value ?? "").trim();
  if (!v) return "empty";
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    return "not-a-link";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "not-a-link";
  return url.hostname === PROGRAM_HOST ? null : "other-host";
}

export interface SettingsWarning {
  key: "program_login_link" | "discord_invite_link";
  text: string;
}

/**
 * The panel's warnings: an empty Discord link (with how many messages send
 * it empty), and a program link that is not on sprint.ecomuniversity.com.
 */
export function settingsWarnings(values: SettingValues, templates: Template[], live: LiveRead): SettingsWarning[] {
  const out: SettingsWarning[] = [];
  const discordUsers = messagesUsing(templates, live, "discordInvite").length;
  if (!(values.discord_invite_link ?? "").trim()) {
    out.push({
      key: "discord_invite_link",
      text:
        discordUsers > 0
          ? `${messages(discordUsers)} ${send(discordUsers)} an empty Discord link.`
          : "The Discord link is empty. No message uses it now.",
    });
  }
  const programUsers = messagesUsing(templates, live, "programLink").length;
  const problem = programLinkProblem(values.program_login_link);
  const using = programUsers > 0 ? ` ${messages(programUsers)} ${send(programUsers)} it.` : "";
  if (problem === "empty") {
    out.push({
      key: "program_login_link",
      text:
        programUsers > 0
          ? `${messages(programUsers)} ${send(programUsers)} an empty program link.`
          : "The program link is empty. No message uses it now.",
    });
  } else if (problem === "not-a-link") {
    out.push({ key: "program_login_link", text: `The program link is not a web address.${using}` });
  } else if (problem === "other-host") {
    out.push({ key: "program_login_link", text: `The program link is not on ${PROGRAM_HOST}.${using}` });
  }
  return out;
}

export type SwitchKey = (typeof CONFIG_SWITCH_KEYS)[number];
export type SubSwitchKey = Exclude<SwitchKey, "dms_master_enabled">;

/** The 3 switches under the master, in the order the panel lists them. */
export const SUB_SWITCHES: SubSwitchKey[] = ["engagement_alerts_enabled", "csm_task_summary_enabled", "day28_dm_enabled"];

export const SWITCH_TEXT: Record<SwitchKey, { title: string; description: string }> = {
  dms_master_enabled: {
    title: "Master switch",
    description:
      "Every automated Discord post. While it is off, nothing posts, whatever the switches below say.",
  },
  engagement_alerts_enabled: {
    title: "Disengagement alerts",
    description:
      "Posts newly flagged students to the team's Discord channel. The check runs every 2 hours.",
  },
  csm_task_summary_enabled: {
    title: "Task summary",
    description:
      "Posts the number of new tasks to the team's Discord channel after each task check. The tasks are made either way.",
  },
  day28_dm_enabled: {
    title: "Day 28 message",
    description:
      "A Discord message to the student 28 days after joining. No scheduled job sends it, so this switch changes nothing today.",
  },
};

export interface SwitchView {
  key: SwitchKey;
  title: string;
  description: string;
  /** null: the key has no row in admin_config, so the switch cannot be set here. */
  on: boolean | null;
  /** What the switch does right now, in words. */
  state: string;
}

/**
 * The 4 switches as the crons read them (src/lib/dm-toggles.ts): only the
 * exact text "true" is on, and a switch under the master posts only while
 * the master is on too, which its state says.
 */
export function switchViews(values: SettingValues): { master: SwitchView; others: SwitchView[] } {
  const read = (k: SwitchKey): boolean | null => (values[k] == null ? null : values[k] === "true");
  const masterOn = read("dms_master_enabled");
  const view = (k: SwitchKey, state: string): SwitchView => ({ key: k, ...SWITCH_TEXT[k], on: read(k), state });
  const master = view(
    "dms_master_enabled",
    masterOn === null ? "Not set up: no row in the database" : masterOn ? "On" : "Off: nothing posts",
  );
  const others = SUB_SWITCHES.map((k) => {
    const on = read(k);
    if (on === null) return view(k, "Not set up: no row in the database");
    if (!on) return view(k, "Off");
    return view(k, masterOn ? "On" : "On, but nothing posts while the master switch is off");
  });
  return { master, others };
}

/** What the master switch's Turn on starts, said before it is pressed. */
export function masterTurnOnText(values: SettingValues): string {
  const live = SUB_SWITCHES.filter((k) => values[k] === "true").map((k) => SWITCH_TEXT[k].title);
  return live.length === 0
    ? "Nothing posts yet: every switch below is off."
    : `These start posting right away: ${live.join(", ")}.`;
}

/* ─── The preview ─── */

/**
 * The links the preview fills in: the live values, never a host typed here.
 * When the settings could not be read, none: the preview then shows the
 * placeholders as written and says why.
 */
export function previewConfig(
  settings: SettingsRead,
): Partial<Record<"program_login_link" | "discord_invite_link", string>> {
  if (!settings.ok) return {};
  return {
    program_login_link: settings.values.program_login_link ?? "",
    discord_invite_link: settings.values.discord_invite_link ?? "",
  };
}

/** The line under a preview for a placeholder left as written (renderTemplate's `unresolved`). */
export function unresolvedLine(name: string, settings: SettingsRead): string {
  const shown = `{${name}}`;
  if ((name === "programLink" || name === "discordInvite") && !settings.ok) {
    return `${shown} shows as written: the message settings could not be read.`;
  }
  if (name === "programLink") return `${shown} stays as written: the program link is empty. Set it in Message settings.`;
  if (name === "discordInvite") return `${shown} stays as written: the Discord link is empty. Set it in Message settings.`;
  return `${shown} is not a placeholder the messages know, so it stays as written.`;
}
