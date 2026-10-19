"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { WorldV6 } from "@/components/world-v6/WorldV6";
import { sourceData, type WorldDiscount, type WorldSource } from "@/components/world-v6/source";
import tokens from "@/components/world-v6/tokens.module.css";
import { useWorldStage } from "@/components/world/WorldStage";
import { useMapModel, type ReadyMapModel } from "@/components/world/useMapModel";
import { useWorldDiscount } from "@/components/world/useWorldDiscount";
import { WorldCorner } from "@/components/world/WorldCorner";
import { PlaybookLink } from "@/components/world/PlaybookLink";
import { WorldDiscountForm } from "@/components/world/WorldDiscountForm";
import { WorldCelebrations } from "@/components/world/WorldCelebrations";
import { approvalOnMap } from "@/lib/world/celebrations";
import { useLessonAccess, useLessonTransport } from "@/lib/world/useLessonTransport";
import { STUDENT_HOME, WORLD_LOCK_MODE } from "@/lib/world/access";
import { posterSrc } from "@/lib/world-v6/poster";
import u from "@/components/world/world-ui.module.css";

/** The development harness's pretend student's name (FixtureStudentProvider.tsx). /world provides nothing and reads AuthContext. */
export const StudentNameStandInContext = createContext<string | null>(null);

/** The first word of a name ("Maya Brooks" gives "Maya"), or null when there is none. */
function firstNameOf(name: string | null | undefined): string | null {
  const first = name?.trim().split(/\s+/)[0];
  return first ? first : null;
}

/**
 * The map's host: joins the catalog, the student and the address to the map.
 *
 * It only reads. The catalog and the student's finished lessons become what
 * the map shows (buildMapModel, then sourceData). The address, read by the
 * stage, says which place is open and whether a lesson page is open over the
 * map. What the student does inside the map comes back as four callbacks, and
 * each one only changes the address (a lesson's page shows at the click,
 * ahead of its address: WorldStage's open()). A fifth, onPrefetch, asks Next for the
 * lesson page's route and, for a lesson with a video, the video's address
 * before the click (embed-cache.ts), into the same cache the lesson page
 * reads (useLessonTransport.ts). Neither while the membership is not active.
 * The student's early-finish discount goes in too (useWorldDiscount.ts), for
 * the checkpoint between the Trail Hut and the Boathouse; its Apply opens the
 * application's questions (WorldDiscountForm.tsx, mounted beside the map),
 * and sending them is the one thing here that writes
 * (POST /api/discounts/submit-feedback; /api/discounts/request when there
 * are no active questions).
 * The header's group at the right (WorldCorner.tsx) shows the student's
 * streak and achievements, holds the map's discount segment and Sign out,
 * and reads its own data (useWorldBadges.ts). A graduate gets the Playbook link in it
 * (PlaybookLink.tsx). The old dashboard's streak and discount-approved
 * celebrations are mounted beside the map (WorldCelebrations.tsx).
 *
 * THE MAP IS NOT MOUNTED UNTIL THE CATALOG HAS LOADED AND IS THE EIGHT-AREA
 * ONE. Loading, a failed load, an empty catalog and a catalog of any other
 * size each get a plain card here and load no 3D (useMapModel names the five
 * states, and the routes over the map read the same ones).
 *
 * The cards wear the map's own floating panel, as the screens beside them do
 * (world-ui.module.css).
 *
 * The welcome at the map's start (2026-10-19) greets the student by the first
 * word of their name: AuthContext's `student.name`, the field the header's
 * "Signed in as" reads (WorldCorner.tsx). The development harness has no
 * signed-in student: its pretend one's name stands in through
 * StudentNameStandInContext.
 */
export function WorldMap() {
  const { status, model } = useMapModel();

  if (status === "loading") {
    return (
      <Card kind="loading" poster>
        <p role="status" className={u.message}>
          Loading the world…
        </p>
      </Card>
    );
  }

  if (status === "error") {
    return (
      <Card kind="error">
        <p className={u.message}>Your course didn&apos;t load.</p>
        <RetryButton />
      </Card>
    );
  }

  if (status === "empty") {
    // An empty catalog is also how a failed catalog query and a refused data
    // request arrive today (useMapModel), so this card offers the retry too.
    return (
      <Card kind="empty">
        <p className={u.message}>There are no lessons here yet.</p>
        <RetryButton />
      </Card>
    );
  }

  if (status === "shape" || !model) {
    return (
      <Card kind="shape">
        <p className={u.message}>The new course isn&apos;t switched on here yet.</p>
        <Link href={STUDENT_HOME} className={u.link}>
          <span aria-hidden="true">←</span>
          Back to your course
        </Link>
      </Card>
    );
  }

  return <SourcedMap model={model} />;
}

function RetryButton() {
  return (
    <button type="button" onClick={() => window.location.reload()} className={u.primary}>
      Try again
    </button>
  );
}

/** Lesson routes already handed to router.prefetch on this page. */
const routesAsked = new Set<string>();

/** The map with a real student in it. Mounted once the model is the eight-area one. */
function SourcedMap({ model }: { model: ReadyMapModel }) {
  const router = useRouter();
  const { openAreaId, lessonId, href, open } = useWorldStage();
  // The lesson page's own transport, so what is asked for here is what its player finds.
  const transport = useLessonTransport();
  // Nothing is asked for ahead while the membership is not active.
  const { active } = useLessonAccess();
  // The welcome's name: the pretend student's on the development harness, else the signed-in one's.
  const { student } = useAuth();
  const standInName = useContext(StudentNameStandInContext);
  const firstName = firstNameOf(standInName ?? student?.name);

  const data = useMemo(() => sourceData(model, WORLD_LOCK_MODE), [model]);

  // The discount, with the next video it asks for as a place and a row of the map.
  const { state: discountNow, now: discountClock, apply: applyDiscount, form: discountForm } = useWorldDiscount();
  const discount = useMemo<WorldDiscount>(() => {
    let next: WorldDiscount["next"] = null;
    if (discountNow.kind === "locked" && discountNow.nextLessonId) {
      for (let k = 0; k < data.lessonIds.length && !next; k++) {
        const i = data.lessonIds[k].indexOf(discountNow.nextLessonId);
        if (i >= 0) next = { k, i };
      }
    }
    return { state: discountNow, now: discountClock, next, apply: applyDiscount };
  }, [discountNow, discountClock, applyDiscount, data]);

  const source = useMemo<WorldSource>(() => {
    const ids = model.areas.map((a) => a.id);
    // The Ad Bounty's lesson is its own checkpoint's (plan item 18): its page
    // opens over the checkpoint's panel, so the place it is filed under in the
    // catalog does not open under it. Browser back, the page's back link and
    // Esc all come home to the panel (LessonScreen sends the last two to the
    // map's address).
    const bountyPage = lessonId !== null && lessonId === data.bounty?.id;
    const at = openAreaId === null || bountyPage ? -1 : ids.indexOf(openAreaId);
    // scroll: false on every one. The page scroll is the camera, and an
    // address change must never move it.
    const go = (to: string) => router.push(to, { scroll: false });
    return {
      areas: data.areas,
      study: data.study,
      total: data.total,
      lock: WORLD_LOCK_MODE,
      minutes: (k, i) => data.minutes[k]?.[i] ?? null,
      isDone: (k, i) => data.done[k]?.[i] ?? false,
      openK: at >= 0 ? at : null,
      // A lesson address implies its place is open underneath.
      paused: lessonId !== null,
      firstName,
      onOpenArea: (k) => go(href(ids[k])),
      onCloseArea: () => go(href()),
      // A lesson's page shows at the click and its address follows (WorldStage's open()).
      onWatch: (k, i) => {
        const id = data.lessonIds[k]?.[i];
        if (id) open(ids[k], id);
        else go(href(ids[k]));
      },
      // The feature row's page: the Ad Bounty's lesson, from its checkpoint's panel.
      onFeature: (k) => {
        const id = data.featureIds[k];
        if (id) open(ids[k], id);
        else go(href(ids[k]));
      },
      // The lesson page's route (the address onWatch pushes), once per lesson
      // per page, so the address lands at once after the click (Next skips
      // this under `next dev`); and, for a lesson with a video, its address.
      onPrefetch: (k, i) => {
        if (!active) return;
        const lesson = model.areas[k]?.lessons[i];
        const to = lesson ? href(ids[k], data.lessonIds[k]?.[i]) : null;
        if (to !== null && !routesAsked.has(to)) {
          routesAsked.add(to);
          router.prefetch(to);
        }
        if (lesson?.hasVideo) transport.prefetch(lesson.id);
      },
      discount,
      bounty: data.bounty ?? undefined,
      bountyOpen: bountyPage,
    };
  }, [model, data, openAreaId, lessonId, href, open, router, transport, active, discount, firstName]);

  // The header's group at the right: streak, achievements, the map's discount
  // segment, the Playbook link for a student who has it (PlaybookLink.tsx) and
  // Sign out (WorldCorner.tsx). WorldV6 calls it with the discount segment and
  // whether the checkpoint's panel is up, which closes the list as a place does.
  const corner = (discount: ReactNode, checkpointOpen: boolean) => (
    <WorldCorner
      paused={lessonId !== null}
      placeOpen={openAreaId !== null}
      checkpointOpen={checkpointOpen}
      discount={discount}
      playbook={<PlaybookLink />}
    />
  );

  // The application the full-screen moment is for: approved, or applied since (approvalOnMap).
  const approval = approvalOnMap(discountNow);

  return (
    <>
      <WorldV6 source={source} corner={corner} />
      {/* Over the map, outside it: the discount's questions and the two celebrations. */}
      <WorldDiscountForm form={discountForm} paused={lessonId !== null} />
      <WorldCelebrations
        approvedRequestId={approval?.requestId ?? null}
        applied={approval?.applied ?? false}
        paused={lessonId !== null}
      />
    </>
  );
}

/** One of the four cards shown in the map's place. The routes over it still paint above. */
function Card({
  kind,
  poster = false,
  children,
}: {
  kind: "loading" | "error" | "empty" | "shape";
  poster?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      data-world-card={kind}
      className={`${tokens.tokens} ${u.ground}`}
      // The landing's still view, behind the loading card only.
      style={poster ? { backgroundImage: `url(${posterSrc("k0")})` } : undefined}
    >
      <div className={`${u.card} ${u.note}`}>{children}</div>
    </div>
  );
}
