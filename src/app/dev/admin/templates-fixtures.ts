/**
 * Made-up data for /dev/admin/templates (admin rebuild 2, WI-8). Development
 * only: the dev layout calls notFound() anywhere else.
 *
 * MADE-UP TEXT ONLY. This repository is public. The scenarios and titles are
 * the built-ins' own (they are in the migrations); every message, link,
 * area name and number below is invented.
 *
 *   ?state=full      the live shape of 20 Oct: the program link on the old
 *                    host, the Discord link empty, every switch off, so
 *                    both warnings show (default)
 *          fixed     the links fixed and the master switch on with one
 *                    switch under it: no warning
 *          empty | loading | error
 *          nosettings  the message settings cannot be read
 *          nocourse    the live course cannot be read
 *   ?drift=1   another team member saves Welcome (Day 1) between the first
 *              read and the next: Refresh shows their message, and keeps
 *              this member's unsaved changes on the rows being edited
 *
 * The calls the page made are on window.__adminCalls, for world-tests.
 */

import { configWriteError } from "@/lib/admin/config-keys";
import type { EditableConfigKey } from "@/lib/admin/config-keys";
import type { Answer } from "@/lib/admin/admin-transport";
import type {
  NewTemplateFields,
  SettingValues,
  TemplateStat,
  TemplatesData,
  TemplatesTransport,
} from "@/lib/admin/templates-data";
import { sortTemplates } from "@/lib/admin/templates-data";
import type { LiveCourse } from "@/lib/template-on-off";
import type { Template, TemplateBucket, TriggerConfig } from "@/types/database";

export type TemplatesFixtureState = "full" | "fixed" | "empty" | "loading" | "error" | "nosettings" | "nocourse";

const STATES: TemplatesFixtureState[] = ["full", "fixed", "empty", "loading", "error", "nosettings", "nocourse"];

export function parseTemplatesState(value: string | null): TemplatesFixtureState {
  return STATES.find((s) => s === value) ?? "full";
}

/** One call the page made, for world-tests to read. */
export interface TemplatesFixtureCall {
  name: "load" | "loadStats" | "saveTemplate" | "setActive" | "createTemplate" | "deleteTemplate" | "saveSetting";
  args: unknown[];
}

const STAMP = "2026-10-20T08:30:00.000Z";

function tpl(
  scenario_id: string,
  week: string,
  bucket: TemplateBucket,
  title: string,
  body: string,
  extra: Partial<Template> = {},
): Template {
  return {
    id: `tpl-${scenario_id}`,
    scenario_id,
    bucket,
    week,
    title,
    trigger_description: `Made-up note: when ${title.toLowerCase()} comes up.`,
    intent: "Made-up intent for the dev page.",
    tone: null,
    variables: [],
    body,
    word_count: null,
    is_active: true,
    is_admin_only: false,
    is_custom: false,
    trigger_config: null,
    created_at: STAMP,
    updated_at: STAMP,
    ...extra,
  };
}

const LINKS =
  "Here are your links:\n\nDiscord: {discordInvite}\nThe course: {programLink}\n\nAny question, write back here.";

function templates(): Template[] {
  const stalledDiscord = (d: number) =>
    tpl(
      `stalled.discord.day${d}`,
      `D${String(d).padStart(2, "0")}`,
      "cancel_path",
      `Stalled student (Discord) - Day ${d}${d === 10 ? " final" : ""}`,
      `Hey {firstName}, a made-up day ${d} note.\n\nThe course is waiting for you here: {programLink}`,
    );
  const stalledWhop = (d: number) =>
    tpl(
      `stalled.whop.day${d}`,
      `D${String(d).padStart(2, "0")}`,
      "cancel_path",
      `Stalled student (Whop, no Discord) - Day ${d}${d === 10 ? " final" : ""}`,
      `Hey {firstName}, a made-up day ${d} note sent on Whop.\n\n${LINKS}`,
    );
  return sortTemplates([
    tpl("welcome.day1", "D01", "event", "Welcome (Day 1)", "Hey {firstName}! A made-up welcome.\n\nStart here: {programLink}"),
    ...[3, 5, 7, 10].flatMap((d) => [stalledDiscord(d), stalledWhop(d)]),
    tpl("nolessons.day3", "D03", "at_risk", "Activated, no lessons watched - Day 3", "Hey {firstName}, a made-up nudge to open the first lesson."),
    tpl("nolessons.day7", "D07", "at_risk", "Activated, no lessons watched - Day 7", "Hey {firstName}, a made-up nudge, a week in."),
    tpl("nolessons.day14", "D14", "cancel_path", "Activated, no lessons watched - Day 14", "Hey {firstName}, a made-up last nudge."),
    tpl("noship.r1.day7", "D07", "at_risk", "R1 actions not shipped - Day 7 (Golf voice)", "Hey {firstName}, a made-up note about the first action item."),
    tpl("noship.r2.day14", "D14", "at_risk", "R2 actions not shipped - Day 14", "Hey {firstName}, a made-up note about two action items."),
    tpl("pace.day7", "D07", "at_risk", "Behind on pace - Day 7", "Hey {firstName}, a made-up note on pace.", {
      is_active: false,
      trigger_config: { all: [{ metric: "region_pace", op: "is", value: "behind" }] } as TriggerConfig,
    }),
    tpl("pace.day14", "D14", "at_risk", "Behind on pace - Day 14 (discount slipped)", "Hey {firstName}, a made-up note on pace, day 14."),
    tpl("pace.day21", "D21", "at_risk", "Behind on pace - Day 21 (last push)", "Hey {firstName}, a made-up note on pace, day 21."),
    tpl("month2.entry", "M2", "event", "Month 2 entry (Spencer math + Playbook)", "Hey {firstName}! A made-up month 2 note.\n\nUse {unknownThing} here."),
    tpl("C-a1b2c3", "X", "cancel_path", "Is cancelling", "Hey {firstName}, a made-up note for a member who is cancelling.", {
      is_custom: true,
      trigger_config: {
        all: [
          { metric: "is_canceling", op: "is" },
          { metric: "membership_status", op: "is", value: "active" },
        ],
      } as TriggerConfig,
    }),
    tpl("C-d4e5f6", "X", "at_risk", "Quiet after area 2", "Hey {firstName}, a made-up note after area 2.", {
      is_custom: true,
      is_active: false,
      // An area of the new course: RegionId still names the old course's r1..r4 only.
      trigger_config: { all: [{ metric: "region_complete", region: "a2", op: "is" }] } as unknown as TriggerConfig,
    }),
  ]);
}

const AREAS = ["Foundations", "Hooks", "Scripts", "Editing", "Statics", "Testing", "Clients", "Bounties"];
const ACTION_LESSONS = [
  { id: "a1l05", region: "a1", title: "Find three ads that sell" },
  { id: "a2l07", region: "a2", title: "Write five hooks" },
  { id: "a4l17", region: "a4", title: "Send your first edit" },
];

function liveCourse(): LiveCourse {
  const lessons = new Set<string>();
  AREAS.forEach((_, i) => {
    for (let n = 1; n <= 17; n++) lessons.add(`a${i + 1}l${String(n).padStart(2, "0")}`);
  });
  return {
    courseIsNew: true,
    regions: new Set(AREAS.map((_, i) => `a${i + 1}`)),
    lessons,
    actionLessons: new Set(ACTION_LESSONS.map((l) => l.id)),
  };
}

function settingsFor(state: TemplatesFixtureState): SettingValues {
  if (state === "fixed") {
    return {
      program_login_link: "https://sprint.ecomuniversity.com/login",
      discord_invite_link: "https://discord.gg/madeup123",
      dms_master_enabled: "true",
      engagement_alerts_enabled: "true",
      csm_task_summary_enabled: "false",
      day28_dm_enabled: "false",
    };
  }
  return {
    program_login_link: "https://old-course-host.example.com/login",
    discord_invite_link: "",
    dms_master_enabled: "false",
    engagement_alerts_enabled: "false",
    csm_task_summary_enabled: "false",
    day28_dm_enabled: "false",
  };
}

const STATS: Record<string, TemplateStat> = {
  "tpl-stalled.discord.day3": {
    created: 40, open: 4, sent: 32, dismissed: 4, replied: 6, no_reply: 20,
    success: 9, success_eligible: 22, success_label: "logged in within 72h", graded_on_old_course: 8,
  },
  "tpl-nolessons.day3": {
    created: 25, open: 3, sent: 18, dismissed: 4, replied: 2, no_reply: 12,
    success: 6, success_eligible: 15, success_label: "started a lesson", graded_on_old_course: 0,
  },
};

let seq = 0;

/** What someone else saves in Welcome (Day 1) under ?drift=1. */
export const DRIFTED_WELCOME = "Hey {firstName}! A welcome another team member saved.\n\nStart here: {programLink}";

/** The Templates page's calls, answered from the made-up database a moment later, as a real answer would come. */
export function fixtureTemplatesTransport(
  state: TemplatesFixtureState,
  opts: { drift?: boolean } = {},
): TemplatesTransport & { calls: TemplatesFixtureCall[] } {
  const calls: TemplatesFixtureCall[] = [];
  /** When the first read came. Development runs a mount's effect twice at once, so "the next read" is one that comes later. */
  let firstRead: number | null = null;
  let drifted = false;
  const db = { templates: state === "empty" ? [] : templates(), settings: settingsFor(state) };
  const later = <T>(answer: Answer<T>) => new Promise<Answer<T>>((resolve) => setTimeout(() => resolve(answer), 250));
  const find = (id: string) => db.templates.find((t) => t.id === id);
  const notFound = { ok: false as const, status: 404, error: "Template not found" };
  let minute = 0;
  const stamp = () => new Date(Date.parse(STAMP) + 60_000 * ++minute).toISOString();

  return {
    calls,

    load() {
      calls.push({ name: "load", args: [] });
      if (state === "loading") return new Promise<Answer<TemplatesData>>(() => {});
      firstRead ??= Date.now();
      if (opts.drift && !drifted && Date.now() - firstRead > 300) {
        drifted = true;
        const welcome = find("tpl-welcome.day1");
        if (welcome) Object.assign(welcome, { body: DRIFTED_WELCOME, updated_at: stamp() });
      }
      if (state === "error") {
        return later<TemplatesData>({ ok: false, status: 500, error: "The templates could not be read: canceling statement due to statement timeout" });
      }
      return later<TemplatesData>({
        ok: true,
        status: 200,
        data: {
          templates: db.templates.map((t) => ({ ...t })),
          live:
            state === "nocourse"
              ? { course: null, error: "the lessons could not be read: permission denied for table lessons" }
              : { course: liveCourse(), error: null },
          trigger: {
            catalog: {
              regions: AREAS.map((name, i) => ({ id: `a${i + 1}`, label: `Area ${i + 1} (${name})` })),
              actionLessons: ACTION_LESSONS.map((l) => ({ id: l.id, label: `${l.title} (${l.id})` })),
              courseIsNew: true,
            },
            error: null,
          },
          settings:
            state === "nosettings"
              ? { ok: false, error: "permission denied for table admin_config" }
              : { ok: true, values: { ...db.settings } },
        },
      });
    },

    loadStats() {
      calls.push({ name: "loadStats", args: [] });
      if (state === "loading") return new Promise<Answer<Record<string, TemplateStat>>>(() => {});
      return later({ ok: true, status: 200, data: STATS });
    },

    saveTemplate(id, fields) {
      calls.push({ name: "saveTemplate", args: [id, fields] });
      const t = find(id);
      if (!t) return later<Template>(notFound);
      Object.assign(t, fields, { updated_at: stamp() });
      return later({ ok: true, status: 200, data: { ...t } });
    },

    setActive(id, isActive) {
      calls.push({ name: "setActive", args: [id, isActive] });
      const t = find(id);
      if (!t) return later<Template>(notFound);
      Object.assign(t, { is_active: isActive, updated_at: stamp() });
      return later({ ok: true, status: 200, data: { ...t } });
    },

    createTemplate(fields: NewTemplateFields) {
      calls.push({ name: "createTemplate", args: [fields] });
      const t: Template = {
        ...tpl(`C-new${String(++seq).padStart(3, "0")}`, "X", fields.bucket, fields.title, fields.body, {
          is_custom: true,
          intent: fields.intent || null,
          trigger_description: "",
          trigger_config: fields.trigger_config,
        }),
      };
      db.templates = sortTemplates([...db.templates, t]);
      return later({ ok: true, status: 200, data: { ...t } });
    },

    deleteTemplate(id) {
      calls.push({ name: "deleteTemplate", args: [id] });
      const t = find(id);
      if (!t) return later<null>(notFound);
      // The route's own refusal (DELETE /api/admin/templates/:id).
      if (!t.is_custom) {
        return later<null>({ ok: false, status: 400, error: "A built-in template can't be deleted. Only a custom one can." });
      }
      db.templates = db.templates.filter((x) => x.id !== id);
      return later<null>({ ok: true, status: 200, data: null });
    },

    saveSetting(key: EditableConfigKey, value: string) {
      calls.push({ name: "saveSetting", args: [key, value] });
      // The route's own check (PUT /api/admin/config).
      const refused = configWriteError(key, value);
      if (refused) return later<{ key: string; value: string }>({ ok: false, status: 400, error: refused });
      db.settings = { ...db.settings, [key]: value };
      return later({ ok: true, status: 200, data: { key, value } });
    },
  };
}
