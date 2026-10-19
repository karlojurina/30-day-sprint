"use client";

import { useState } from "react";
import { AdminTopNav } from "@/components/admin/AdminTopNav";
import tokens from "@/components/admin/admin-tokens.module.css";
import {
  AdminPage,
  Button,
  Card,
  EmptyState,
  PageHeader,
  Pill,
  Section,
  T,
  Tabs,
} from "@/components/admin/ui";

export type FrameRole = "founder" | "csm" | "admin";
export type FrameGround = "light" | "dark";

/** Made-up team members, one per role. The long name checks that the
 *  profile cuts it short instead of widening the bar. */
const MEMBERS = {
  founder: { full_name: "Jamie Rowe", role: "founder" },
  csm: { full_name: "Alexandra Montgomery-Hayes", role: "csm" },
  admin: { full_name: "Robin Hale", role: "admin" },
} as const;

export function FrameView({
  role,
  ground,
}: {
  role: FrameRole;
  ground: FrameGround;
}) {
  // The bar marks the page it sits over: Tasks keeps the light look, Today
  // is a rebuilt page.
  const pathname = ground === "dark" ? "/admin/today" : "/admin/tasks";
  return (
    <div
      className="flex flex-col min-h-screen"
      data-frame-role={role}
      data-frame-ground={ground}
    >
      <AdminTopNav
        member={MEMBERS[role]}
        pathname={pathname}
        onSignOut={() => {}}
      />
      {ground === "dark" ? (
        <div className={tokens.tokens} style={{ flex: 1 }}>
          <DarkPage />
        </div>
      ) : (
        <div style={{ flex: 1 }}>
          <LightPage />
        </div>
      )}
    </div>
  );
}

/**
 * One of the pages that keep the light look for now. Only pieces whose text
 * measures 4.5:1 or more in the light look are used here; the light look's
 * secondary and tertiary text measure under that on its cream canvas.
 */
function LightPage() {
  return (
    <AdminPage>
      <PageHeader
        title="Tasks"
        actions={<Button variant="primary">Refresh</Button>}
      />
      <Card>
        <p style={T.body}>
          A page that keeps the light look for now, under the new bar.
        </p>
        <div className="flex flex-wrap gap-2" style={{ marginTop: 16 }}>
          <Pill tone="success">Approved</Pill>
          <Pill tone="warning">Waiting</Pill>
          <Pill tone="danger">Rejected</Pill>
          <Pill tone="accent">Code added</Pill>
        </div>
        <div className="flex flex-wrap gap-2" style={{ marginTop: 16 }}>
          <Button variant="primary">Primary</Button>
          <Button variant="subtle">Subtle</Button>
          <Button variant="danger">Danger</Button>
        </div>
      </Card>
    </AdminPage>
  );
}

/** A page in the dark look: the same ui.tsx pieces under the token class. */
function DarkPage() {
  const [tab, setTab] = useState<"open" | "handled">("open");
  return (
    <AdminPage>
      <PageHeader
        title="Today"
        meta="Updated 09:41"
        actions={<Button variant="raised">Refresh</Button>}
      />

      <Section eyebrow="Status pills">
        <div className="flex flex-wrap gap-2">
          <Pill tone="danger">Cancelling</Pill>
          <Pill tone="warning">30% closing</Pill>
          <Pill tone="success">30% ready</Pill>
          <Pill tone="neutral">Not started</Pill>
          <Pill tone="accent">Open task</Pill>
        </div>
      </Section>

      <Section eyebrow="A list" count={2}>
        <Card padding={0}>
          <SampleRow name="Dana Whitfield" tone="danger" reason="Cancelling" />
          <SampleRow name="Theo Marsh" tone="neutral" reason="Not started" />
        </Card>
      </Section>

      <Section eyebrow="Buttons">
        <Card>
          <div className="flex flex-wrap gap-2">
            <Button variant="raised">Raised</Button>
            <Button variant="subtle">Subtle</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="ink">Ink</Button>
          </div>
        </Card>
      </Section>

      <Section eyebrow="Tabs">
        <Tabs
          tabs={[
            { value: "open", label: "To do", count: 4 },
            { value: "handled", label: "Handled", count: 12 },
          ]}
          value={tab}
          onChange={setTab}
        />
      </Section>

      <Card>
        <EmptyState title="Nobody needs a message right now." />
      </Card>
    </AdminPage>
  );
}

function SampleRow({
  name,
  tone,
  reason,
}: {
  name: string;
  tone: "danger" | "neutral";
  reason: string;
}) {
  return (
    <div
      className="list-row"
      style={{ gap: 12, flexWrap: "wrap", paddingBlock: 12 }}
    >
      <span style={{ ...T.body, fontWeight: 600 }}>{name}</span>
      <Pill tone={tone}>{reason}</Pill>
      <span style={{ flex: 1 }} />
      <Button variant="raised">Open in Discord</Button>
      <Button variant="raised">Mark messaged</Button>
    </div>
  );
}
