"use client";

import { useMemo, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { WorldV6 } from "@/components/world-v6/WorldV6";
import { sourceData, type WorldDiscount, type WorldSource } from "@/components/world-v6/source";
import tokens from "@/components/world-v6/tokens.module.css";
import { useWorldStage } from "@/components/world/WorldStage";
import { useMapModel, type ReadyMapModel } from "@/components/world/useMapModel";
import { useWorldDiscount } from "@/components/world/useWorldDiscount";
import { useLessonAccess, useLessonTransport } from "@/lib/world/useLessonTransport";
import { STUDENT_HOME, WORLD_LOCK_MODE } from "@/lib/world/access";
import { posterSrc } from "@/lib/world-v6/poster";
import u from "@/components/world/world-ui.module.css";

/**
 * The map's host: joins the catalog, the student and the address to the map.
 *
 * It only reads. The catalog and the student's finished lessons become what
 * the map shows (buildMapModel, then sourceData). The address, read by the
 * stage, says which place is open and whether a lesson page is open over the
 * map. What the student does inside the map comes back as four callbacks, and
 * each one only changes the address. A fifth, onPrefetch, asks Next for the
 * lesson page's route and, for a lesson with a video, the video's address
 * before the click (embed-cache.ts), into the same cache the lesson page
 * reads (useLessonTransport.ts). Neither while the membership is not active.
 * The student's early-finish discount goes in too (useWorldDiscount.ts), for
 * the checkpoint between the Trail Hut and the Boathouse; its Apply is the
 * one thing here that writes (POST /api/discounts/request).
 *
 * THE MAP IS NOT MOUNTED UNTIL THE CATALOG HAS LOADED AND IS THE EIGHT-AREA
 * ONE. Loading, a failed load, an empty catalog and a catalog of any other
 * size each get a plain card here and load no 3D (useMapModel names the five
 * states, and the routes over the map read the same ones).
 *
 * The cards wear the map's own floating panel, as the screens beside them do
 * (world-ui.module.css).
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
  const { openAreaId, lessonId, href } = useWorldStage();
  // The lesson page's own transport, so what is asked for here is what its player finds.
  const transport = useLessonTransport();
  // Nothing is asked for ahead while the membership is not active.
  const { active } = useLessonAccess();

  const data = useMemo(() => sourceData(model, WORLD_LOCK_MODE), [model]);

  // The discount, with the next video it asks for as a place and a row of the map.
  const { state: discountNow, now: discountClock, apply: applyDiscount } = useWorldDiscount();
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
    const at = openAreaId === null ? -1 : ids.indexOf(openAreaId);
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
      onOpenArea: (k) => go(href(ids[k])),
      onCloseArea: () => go(href()),
      onWatch: (k, i) => go(href(ids[k], data.lessonIds[k]?.[i])),
      onFeature: (k) => go(href(ids[k], data.featureIds[k])),
      // The lesson page's route (the address onWatch pushes), once per lesson
      // per page, so the click does not wait on it; and, for a lesson with a
      // video, its address.
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
    };
  }, [model, data, openAreaId, lessonId, href, router, transport, active, discount]);

  return <WorldV6 source={source} />;
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
