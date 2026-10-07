"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AREAS, CURRENT_AREA } from "@/lib/world-codex/study";
import { LANDMARKS } from "@/lib/world-codex/terrain";
import type { MapFrame } from "@/lib/world-codex/scene";
import s from "./map.module.css";

const MapCanvas = dynamic(() => import("./MapCanvas"), { ssr: false });
const mobileQuery = "(max-width: 760px)";
const subscribeMobile = (notify: () => void) => {
  const query = matchMedia(mobileQuery); query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
};
const getMobile = () => matchMedia(mobileQuery).matches;
const getServerMobile = () => true;
const total = AREAS.reduce((sum, a) => sum + a.lessons, 0);
const completed = AREAS.reduce((sum, a) => sum + a.done, 0);

function Arrow({ back = false }: { back?: boolean }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={back ? { transform: "rotate(180deg)" } : undefined}><path d="M4 12h15m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.5" /></svg>;
}

export function MapExperience() {
  const mobile = useSyncExternalStore(subscribeMobile, getMobile, getServerMobile);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [list, setList] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  const [lesson, setLesson] = useState<number | null>(null);
  const [region, setRegion] = useState(0);
  const [showChrome, setShowChrome] = useState(true);
  const markers = useRef<Array<HTMLButtonElement | null>>([]);
  const progress = useRef<HTMLDivElement>(null);
  const regionRef = useRef(0);
  const savedScroll = useRef(0);
  const panelRef = useRef<HTMLElement>(null);
  const returnFocus = useRef<string | null>(null);
  const sceneReady = useCallback(() => setReady(true), []);
  const sceneFailure = useCallback(() => { setFailed(true); setReady(false); }, []);
  const switchView = (next: boolean) => {
    if (next) savedScroll.current = scrollY;
    setList(next);
    requestAnimationFrame(() => window.scrollTo(0, next ? 0 : savedScroll.current));
  };
  const onFrame = useCallback((frame: MapFrame) => {
    const boxes: Array<{ x: number; y: number }> = [];
    const order = [CURRENT_AREA, ...frame.markers.map((_, i) => i).filter(i => i !== CURRENT_AREA)];
    order.forEach(i => {
      const m = frame.markers[i];
      const element = markers.current[i];
      if (!element) return;
      // Keep adjacent labels readable in a distant view. Every area also has a dock button.
      const overlap = boxes.some(b => Math.abs(b.x - m.x) < 165 && Math.abs(b.y - m.y) < 55);
      const visible = m.visible && !overlap;
      if (visible) boxes.push({ x: m.x, y: m.y });
      element.style.transform = `translate(${m.x}px, ${m.y}px) translate(-50%, -100%) scale(${m.scale})`;
      element.style.visibility = visible ? "visible" : "hidden";
      element.style.opacity = visible ? "1" : "0";
      element.tabIndex = visible ? 0 : -1;
    });
    if (progress.current) progress.current.style.transform = `scaleX(${frame.depth})`;
    const nearest = LANDMARKS.reduce((best, a, i) => Math.abs(a.depth - frame.depth) < Math.abs(LANDMARKS[best].depth - frame.depth) ? i : best, 0);
    if (nearest !== regionRef.current) { regionRef.current = nearest; setRegion(nearest); }
    // Read-only diagnostics for the development harness, not production globals.
    document.documentElement.dataset.codexDepth = frame.depth.toFixed(3);
    document.documentElement.dataset.codexDrawCalls = String(frame.calls);
    document.documentElement.dataset.codexTriangles = String(frame.triangles);
  }, []);

  const openArea = useCallback((index: number) => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement.id : null;
    setLesson(null); setActive(index);
  }, []);
  const closeArea = useCallback(() => {
    setActive(null); setLesson(null);
    requestAnimationFrame(() => {
      if (!returnFocus.current) return;
      const trigger = document.getElementById(returnFocus.current);
      const visible = trigger && getComputedStyle(trigger).visibility !== "hidden";
      // During the return flight a landmark can temporarily be off-screen.
      const target = visible ? trigger : document.getElementById(returnFocus.current.replace("codex-area-", "codex-travel-"));
      target?.focus({ preventScroll: true });
    });
  }, []);
  const travel = useCallback((index: number) => {
    setActive(null); setLesson(null);
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: LANDMARKS[index].depth * (document.documentElement.scrollHeight - innerHeight), behavior: reduced ? "instant" : "smooth" });
  }, []);

  useEffect(() => {
    if (active === null) return;
    const bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus({ preventScroll: true });
    return () => { document.body.style.overflow = bodyOverflow; };
  }, [active]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (lesson !== null) setLesson(null);
        else if (active !== null) closeArea();
        else setShowChrome(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, lesson, closeArea]);
  useEffect(() => () => {
    delete document.documentElement.dataset.codexDepth;
    delete document.documentElement.dataset.codexDrawCalls;
    delete document.documentElement.dataset.codexTriangles;
  }, []);

  const listView = mobile || list || failed;
  const area = active === null ? null : AREAS[active];

  return <main className={`${s.experience} ${listView ? s.isList : ""}`} data-ready={ready} data-view={listView ? "list" : "world"}>
    {!mobile && !failed && <MapCanvas parked={active} paused={listView} onFrame={onFrame} onReady={sceneReady} onFailure={sceneFailure} />}
    {!listView && <div className={s.scrollSpace} aria-hidden="true" />}
    <div className={s.vignette} aria-hidden="true" />

    <div className={s.chrome} data-hidden={!showChrome}>
      <header className={s.header}>
        <div className={s.brand}>
          <svg width="31" height="31" viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M4 25 12 8l5 10 4-7 7 14H4Z" stroke="currentColor" strokeWidth="1.5"/><path d="m9 25 7-14M14 25l5-9" stroke="currentColor" strokeWidth="1.5"/></svg>
          <span>ecomtalent<span className={s.brandDot}>®</span></span>
        </div>
        <div className={s.headerMiddle}>THE COURSE <span>/</span> YOUR JOURNEY</div>
        <div className={s.headerProgress}><span><strong>{completed}</strong> / {total}</span><span className={s.mono}>LESSONS COMPLETE</span><div className={s.completion}><i style={{ width: `${completed / total * 100}%` }} /></div></div>
      </header>

      {active === null && <div className={s.topline}>
        <div><p className={s.eyebrow}>A WORLD OF POSSIBILITIES</p><h1>Your journey.</h1></div>
        <div className={s.viewSwitch} aria-label="Map view">
          {!mobile && <button aria-pressed={!listView} onClick={() => switchView(false)} disabled={failed}>World</button>}
          <button aria-pressed={listView} onClick={() => switchView(true)}>Course index</button>
        </div>
      </div>}

      {!listView && active === null && <>
        <div className={s.markers} aria-label="Course areas">
          {AREAS.map((a, i) => <button key={a.name} id={`codex-area-${i}`} ref={element => { markers.current[i] = element; }} className={`${s.marker} ${i === CURRENT_AREA ? s.currentMarker : ""}`} onClick={() => openArea(i)} aria-label={`${a.name}, ${a.done} of ${a.lessons} lessons complete`} style={{ visibility: "hidden" }}>
            <span className={s.markerIndex}>{i < CURRENT_AREA ? "✓" : String(i + 1).padStart(2, "0")}</span>
            <span className={s.markerText}>{a.name}{i === CURRENT_AREA && <small>YOU ARE HERE</small>}</span>
            <span className={s.markerArrow}>↗</span><i className={s.markerStem} />
          </button>)}
        </div>
        <section className={s.resume} aria-label="Continue learning">
          <p className={s.eyebrow}><span className={s.currentDot} /> YOUR NEXT STEP</p>
          <h2>Video Ads I</h2>
          <p className={s.resumeLesson}><span>05</span> Writing a hook that lands</p>
          <button id="codex-resume" className={s.primary} onClick={() => { openArea(CURRENT_AREA); setLesson(4); }}>Continue learning <Arrow /></button>
          <p className={s.resumeMeta}>4 of 22 lessons complete <span>·</span> The stone bridge</p>
        </section>
        <div className={s.orientation} aria-hidden="true"><span>N</span><svg width="40" height="40" viewBox="0 0 40 40" fill="none"><path d="M20 3v34M3 20h34" stroke="currentColor" opacity=".3"/><path d="m20 8 4 12-4-2-4 2 4-12Z" fill="currentColor"/><circle cx="20" cy="20" r="16" stroke="currentColor" opacity=".2"/></svg></div>
        <div className={s.scrollHint}><span>↕</span> Scroll to explore <span className={s.hintDivider}>/</span> Select a place to enter</div>
      </>}

      {listView && active === null && <section className={s.courseIndex} aria-label="All course areas">
        {failed && <p className={s.fallbackNote}>The 3D world isn’t available in this browser. You can still explore every area below.</p>}
        {AREAS.map((a, i) => <button key={a.name} id={`codex-index-${i}`} className={s.indexRow} onClick={() => openArea(i)}>
          <span className={s.indexNumber}>{String(i + 1).padStart(2, "0")}</span><span><small className={s.eyebrow}>{a.landmark}</small><strong>{a.name}</strong></span>
          <span className={s.indexProgress}>{a.done ? `${a.done} / ${a.lessons}` : `${a.lessons} lessons`}{i < CURRENT_AREA ? <span className={s.check}>✓</span> : <Arrow />}</span>
        </button>)}
      </section>}

      {area && active !== null && <section ref={panelRef} tabIndex={-1} className={s.areaPanel} aria-labelledby="codex-area-title">
        <button className={s.back} onClick={lesson === null ? closeArea : () => setLesson(null)}><Arrow back />{lesson === null ? "Back to your journey" : area.name}</button>
        <div className={s.areaHeading}><p className={s.eyebrow}>AREA {String(active + 1).padStart(2, "0")} <span>/</span> {area.landmark}</p>
          <h1 id="codex-area-title">{lesson === null ? area.name : area.topics[lesson]}</h1>
          <p>{lesson === null ? area.description : "This lesson is part of the design preview."}</p>
        </div>
        {lesson === null ? <>
          <div className={s.areaProgress}><span>{area.done} of {area.lessons} lessons complete</span><span>{Math.round(area.done / area.lessons * 100)}%</span><div><i style={{ width: `${area.done / area.lessons * 100}%` }} /></div></div>
          <p className={s.sampleLabel}>SAMPLE LESSONS</p>
          <div className={s.lessons}>{area.topics.map((title, i) => <button key={title} onClick={() => setLesson(i)} className={s.lessonRow}>
            <span className={`${s.lessonState} ${i < area.done ? s.lessonDone : ""}`}>{i < area.done ? "✓" : String(i + 1).padStart(2, "0")}</span><span>{title}</span><span className={s.lessonArrow}>↗</span>
          </button>)}</div>
          {active === 6 && <div className={s.bounty}><span className={s.diamond} /><div><strong>Ad Bounty access</strong><p>Your next step into real creative work.</p></div></div>}
          <p className={s.previewNote}>Sample titles and progress for this map study.</p>
        </> : <>
          <div className={s.lessonPreview}><svg width="38" height="38" viewBox="0 0 40 40" fill="none" aria-hidden="true"><circle cx="20" cy="20" r="18" stroke="currentColor" strokeWidth="1"/><path d="m17 13 10 7-10 7V13Z" fill="currentColor"/></svg><p>Lesson preview</p><span>The finished course video will live here.</span></div>
          <p className={s.previewNote}>This comparison uses sample lessons. Watching and progress tracking stay in the main app.</p>
          <button className={s.primary} onClick={() => setLesson(null)}>Explore this area <Arrow /></button>
        </>}
      </section>}

      {!listView && active === null && <nav className={s.dock} aria-label="Travel to an area">
        <div className={s.dockCaption}><span>SHORE TO SUMMIT</span><span>{String(region + 1).padStart(2, "0")} <span className={s.muted}>/ 08</span></span></div>
        <div className={s.dockStops}>{AREAS.map((a, i) => <button key={a.name} id={`codex-travel-${i}`} onClick={() => travel(i)} aria-label={`Travel to ${a.name}`} aria-current={region === i ? "location" : undefined} className={`${s.dockStop} ${i <= CURRENT_AREA ? s.reached : ""}`}><span>{String(i + 1).padStart(2, "0")}</span><i /><span className={s.stopName}>{a.name}</span></button>)}</div>
        <div className={s.travelTrack}><div ref={progress} /></div>
      </nav>}
      <footer className={s.footer}><span>CODEX STUDY <span className={s.footerDot}>·</span> SAMPLE PROGRESS</span><Link href="/dev/world">View Claude’s map <span aria-hidden="true">↗</span></Link></footer>
    </div>

    {!mobile && !listView && <button className={s.hideUi} onClick={() => setShowChrome(v => !v)} aria-pressed={!showChrome}>{showChrome ? "Hide interface" : "Show interface"}<span aria-hidden="true">{showChrome ? "−" : "+"}</span></button>}
    {!ready && !listView && <div className={s.loading} role="status"><span className={s.loadingLine} /><p>Finding your bearings…</p></div>}
  </main>;
}
