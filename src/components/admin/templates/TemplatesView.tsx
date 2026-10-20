"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card, EmptyState, T } from "@/components/admin/ui";
import {
  ListHeader,
  ListPage,
  LoadError,
  NoticeStack,
  SkeletonRows,
  TAP,
} from "@/components/admin/list-parts";
import type { Notice } from "@/components/admin/list-parts";
import {
  BUCKET_MEANING,
  BUCKET_WORDS,
  SWITCH_TEXT,
  changedFields,
  draftOf,
  isDirty,
  groupTemplates,
  sortTemplates,
} from "@/lib/admin/templates-data";
import type {
  DraftFields,
  NewTemplateFields,
  TemplateStat,
  TemplatesData,
  TemplatesTransport,
} from "@/lib/admin/templates-data";
import type { EditableConfigKey } from "@/lib/admin/config-keys";
import { stripBucketGlyph } from "@/lib/templates";
import type { Template, TeamMember } from "@/types/database";
import { MessageSettings } from "./MessageSettings";
import { NewTemplateDialog } from "./NewTemplateDialog";
import { TemplateRow } from "./TemplateRow";

/**
 * /admin/templates (admin rebuild 2, WI-8: PRD D6 and D12), in the brand
 * kit's dark look.
 *
 * On top, Message settings: the 2 links the messages fill in and the 4
 * automated Discord switches, read by every team role and changed by
 * founders and admins (MessageSettings.tsx). Then every template, grouped by
 * the day it comes up: what it is, its numbers, Off where its switch works,
 * and when opened, its editor (TemplateRow.tsx). A built-in template cannot
 * be deleted, only a custom one. Save sends only what changed.
 *
 * Every call goes through `transport` (src/lib/admin/templates-data.ts), so
 * the dev page /dev/admin/templates renders this same component with
 * made-up data and no login.
 */

type Loaded = { kind: "loading" } | { kind: "error"; error: string } | { kind: "ready"; data: TemplatesData };

type Role = TeamMember["role"];

const NONE: ReadonlySet<string> = new Set();

export function TemplatesView({ transport, role }: { transport: TemplatesTransport; role: Role | null }) {
  const canEdit = role === "founder" || role === "admin";
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [drafts, setDrafts] = useState<Record<string, DraftFields>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [stats, setStats] = useState<{ ok: true; byId: Record<string, TemplateStat> } | { ok: false; error: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);
  const seq = useRef(0);
  const noticeSeq = useRef(0);

  const notify = useCallback((tone: Notice["tone"], text: string) => {
    const id = ++noticeSeq.current;
    // One notice at a time: the newest is what the last button did.
    setNotices([{ id, tone, text }]);
  }, []);

  /** One read of the page and the send numbers. Null when a newer read started meanwhile: that one's answer wins. */
  const read = useCallback(async () => {
    const mine = ++seq.current;
    const [page, numbers] = await Promise.all([transport.load(), transport.loadStats()]);
    return mine === seq.current ? { page, numbers } : null;
  }, [transport]);

  /**
   * Shows a read. `keep`: the templates whose unsaved changes stay (Refresh
   * keeps the ones being edited); every other row starts again from the
   * template as just read, so a change someone else saved shows as saved,
   * never as this member's unsaved draft.
   */
  const apply = useCallback((got: NonNullable<Awaited<ReturnType<typeof read>>>, keep: ReadonlySet<string>) => {
    const { page, numbers } = got;
    setStats(numbers.ok ? { ok: true, byId: numbers.data } : { ok: false, error: numbers.error });
    if (!page.ok) {
      setLoaded({ kind: "error", error: page.error });
      return;
    }
    setLoaded({ kind: "ready", data: page.data });
    setDrafts((prev) =>
      Object.fromEntries(page.data.templates.map((t) => [t.id, (keep.has(t.id) ? prev[t.id] : undefined) ?? draftOf(t)])),
    );
  }, []);

  useEffect(() => {
    let alive = true;
    void read().then((got) => {
      if (alive && got) apply(got, NONE);
    });
    return () => {
      alive = false;
    };
  }, [read, apply]);

  async function retry() {
    setRetrying(true);
    const got = await read();
    setRetrying(false);
    if (got) apply(got, NONE);
  }

  /** Refresh: reads everything again. Unsaved changes are kept unless the template is gone. */
  async function refresh() {
    const editing = new Set(
      loaded.kind === "ready" ? loaded.data.templates.filter((t) => isDirty(t, drafts[t.id])).map((t) => t.id) : [],
    );
    setReloading(true);
    const got = await read();
    setReloading(false);
    if (!got) return;
    if (!got.page.ok) {
      notify("danger", `Couldn't refresh: ${got.page.error}`);
      return;
    }
    apply(got, editing);
  }

  /** Puts a template the route answered in place of the one shown. */
  function replace(t: Template, draft?: DraftFields) {
    setLoaded((cur) =>
      cur.kind === "ready"
        ? { ...cur, data: { ...cur.data, templates: cur.data.templates.map((x) => (x.id === t.id ? t : x)) } }
        : cur,
    );
    if (draft) setDrafts((d) => ({ ...d, [t.id]: draft }));
  }

  async function save(t: Template): Promise<string | null> {
    const draft = drafts[t.id];
    if (!draft) return null;
    const fields = changedFields(t, draft);
    if (Object.keys(fields).length === 0) return null;
    setBusy(t.id);
    const r = await transport.saveTemplate(t.id, fields);
    setBusy(null);
    if (!r.ok) return `Couldn't save: ${r.error}`;
    replace(r.data, draftOf(r.data));
    notify("success", `Saved ${stripBucketGlyph(r.data.title)}.`);
    return null;
  }

  async function setActive(t: Template) {
    setBusy(t.id);
    const r = await transport.setActive(t.id, !t.is_active);
    setBusy(null);
    if (!r.ok) {
      notify("danger", `Couldn't turn ${t.is_active ? "off" : "on"} ${stripBucketGlyph(t.title)}: ${r.error}`);
      return;
    }
    // The template as saved; the draft (unsaved text) is kept as it is.
    replace(r.data);
    notify("success", `${stripBucketGlyph(r.data.title)} is ${r.data.is_active ? "on" : "off"}.`);
  }

  async function remove(t: Template): Promise<string | null> {
    setBusy(t.id);
    const r = await transport.deleteTemplate(t.id);
    setBusy(null);
    if (!r.ok) return `Couldn't delete: ${r.error}`;
    setLoaded((cur) =>
      cur.kind === "ready"
        ? { ...cur, data: { ...cur.data, templates: cur.data.templates.filter((x) => x.id !== t.id) } }
        : cur,
    );
    setOpen((cur) => (cur === t.id ? null : cur));
    notify("success", `Deleted ${stripBucketGlyph(t.title)}.`);
    return null;
  }

  async function create(fields: NewTemplateFields): Promise<string | null> {
    const r = await transport.createTemplate(fields);
    if (!r.ok) return `Couldn't create the template: ${r.error}`;
    setLoaded((cur) =>
      cur.kind === "ready"
        ? { ...cur, data: { ...cur.data, templates: sortTemplates([...cur.data.templates, r.data]) } }
        : cur,
    );
    setDrafts((d) => ({ ...d, [r.data.id]: draftOf(r.data) }));
    setOpen(r.data.id);
    setCreating(false);
    notify("success", `Created ${stripBucketGlyph(r.data.title)}. It is on.`);
    return null;
  }

  async function saveSetting(key: EditableConfigKey, value: string): Promise<string | null> {
    const r = await transport.saveSetting(key, value);
    if (!r.ok) return `Couldn't save: ${r.error}`;
    setLoaded((cur) =>
      cur.kind === "ready" && cur.data.settings.ok
        ? {
            ...cur,
            data: {
              ...cur.data,
              settings: { ok: true, values: { ...cur.data.settings.values, [key]: r.data.value } },
            },
          }
        : cur,
    );
    notify("success", settingSaved(key, value));
    return null;
  }

  const header = (meta: React.ReactNode, ready: boolean) => (
    <ListHeader
      title="Templates"
      description="The messages the team sends to students, and when each one comes up as a task."
      meta={meta}
      action={
        ready ? (
          <div className="flex flex-wrap justify-end" style={{ gap: 8 }}>
            <Button variant="raised" size="md" busy={reloading} onClick={() => void refresh()}>
              Refresh
            </Button>
            {canEdit && (
              <Button variant="raised" size="md" onClick={() => setCreating(true)}>
                New template
              </Button>
            )}
          </div>
        ) : undefined
      }
    />
  );

  if (loaded.kind === "loading") {
    return (
      <ListPage>
        {header("Loading", false)}
        <SkeletonRows rows={5} label="Loading the templates" />
      </ListPage>
    );
  }

  if (loaded.kind === "error") {
    return (
      <ListPage>
        {header(null, false)}
        <LoadError title="Couldn't load the templates." detail={loaded.error} onRetry={() => void retry()} busy={retrying} />
      </ListPage>
    );
  }

  const data = loaded.data;
  const custom = data.templates.filter((t) => t.is_custom).length;
  const meta = [
    `${data.templates.length} ${data.templates.length === 1 ? "template" : "templates"}, ${custom} custom`,
    stats && !stats.ok ? "the send numbers could not be loaded" : null,
    reloading ? "Updating" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <ListPage>
      {header(meta, true)}

      {!canEdit && (
        <p role="status" style={{ ...T.bodyDim, lineHeight: 1.5, marginBottom: 16 }}>
          You can read the templates and the message settings. Only a founder or an admin can change them.
        </p>
      )}

      <MessageSettings
        settings={data.settings}
        templates={data.templates}
        live={data.live}
        canEdit={canEdit}
        onSave={saveSetting}
      />

      <BucketKey />

      {data.templates.length === 0 ? (
        <Card>
          <EmptyState title="No templates yet." />
        </Card>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {groupTemplates(data.templates).map((g) => (
            <section key={g.key} aria-label={g.label}>
              <h2 style={{ ...T.eyebrow, color: "var(--color-text-secondary)", marginBottom: 8 }}>{g.label}</h2>
              <Card padding={0}>
                {g.templates.map((t) => (
                  <TemplateRow
                    key={t.id}
                    template={t}
                    draft={drafts[t.id] ?? draftOf(t)}
                    open={open === t.id}
                    stat={stats?.ok ? stats.byId[t.id] : undefined}
                    live={data.live}
                    trigger={data.trigger}
                    settings={data.settings}
                    canEdit={canEdit}
                    busy={busy === t.id}
                    handlers={{
                      onToggleOpen: () => setOpen((cur) => (cur === t.id ? null : t.id)),
                      onDraft: (next) => setDrafts((d) => ({ ...d, [t.id]: next })),
                      onSave: () => save(t),
                      onSetActive: () => void setActive(t),
                      onDelete: () => remove(t),
                    }}
                  />
                ))}
              </Card>
            </section>
          ))}
        </div>
      )}

      {creating && canEdit && (
        <NewTemplateDialog trigger={data.trigger} onClose={() => setCreating(false)} onCreate={create} />
      )}

      <NoticeStack notices={notices} onClose={(id) => setNotices((n) => n.filter((x) => x.id !== id))} />
    </ListPage>
  );
}

/** The notice after a setting is saved. */
function settingSaved(key: EditableConfigKey, value: string): string {
  if (key === "program_login_link") return "Saved the program link.";
  if (key === "discord_invite_link") return value ? "Saved the Discord link." : "Saved: the Discord link is empty.";
  return `${SWITCH_TEXT[key].title} is ${value === "true" ? "on" : "off"}.`;
}

/** What the bucket words mean, folded under one line. */
function BucketKey() {
  return (
    <details style={{ marginBottom: 20 }}>
      <summary
        style={{
          ...T.body,
          fontWeight: 600,
          minHeight: TAP,
          display: "flex",
          alignItems: "center",
          cursor: "pointer",
          color: "var(--color-text-secondary)",
        }}
      >
        What the buckets mean
      </summary>
      <dl className="grid grid-cols-1 sm:grid-cols-2" style={{ gap: "10px 24px", marginTop: 4 }}>
        {(Object.keys(BUCKET_MEANING) as Array<keyof typeof BUCKET_MEANING>).map((b) => (
          <div key={b}>
            <dt style={{ ...T.body, fontWeight: 600 }}>{BUCKET_WORDS[b]}</dt>
            <dd style={{ ...T.bodyDim, lineHeight: 1.5 }}>{BUCKET_MEANING[b]}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
