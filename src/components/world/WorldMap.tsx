"use client";

import { useMemo, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { WorldV6 } from "@/components/world-v6/WorldV6";
import { sourceData, type WorldSource } from "@/components/world-v6/source";
import tokens from "@/components/world-v6/tokens.module.css";
import { useWorldStage } from "@/components/world/WorldStage";
import { useMapModel, type ReadyMapModel } from "@/components/world/useMapModel";
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
 * each one only changes the address.
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

/** The map with a real student in it. Mounted once the model is the eight-area one. */
function SourcedMap({ model }: { model: ReadyMapModel }) {
  const router = useRouter();
  const { openAreaId, lessonId, href } = useWorldStage();

  const data = useMemo(() => sourceData(model, WORLD_LOCK_MODE), [model]);

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
    };
  }, [model, data, openAreaId, lessonId, href, router]);

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
