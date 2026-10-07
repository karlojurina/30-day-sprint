import type { WorldScene } from "@/lib/world-v6/scene";

/**
 * /dev/world-v6?bench=1 (cheap laptops, 2026-09-28): the map runs itself on
 * whatever laptop opened it and reports what it measured, for Lovro to copy
 * and paste. Nothing is sent anywhere.
 *
 *   1. the load: when the page started, when the 3D was ready, the tier it
 *      picked and why, the warm compile, the probe;
 *   2. every stop: the camera put on it, then GPU ms per frame (a short burst,
 *      capped at 0.3 s so a weak GPU is not held);
 *   3. the whole route scrolled at a steady pace for 24 s: every frame's
 *      interval, as p50 / p95 / p99 / worst and the count over 33 and 50 ms,
 *      plus what the governor did meanwhile.
 */

export interface BenchStop {
  id: string;
  depth: number;
  /** GPU ms per frame (fastest repeat), or null in poster mode. */
  ms: number | null;
  med: number | null;
}

export interface BenchResult {
  when: string;
  gpu: string | null;
  userAgent: string;
  cores: number | null;
  memoryGb: number | null;
  viewport: string;
  tier: { pick: unknown; start: unknown; afterLoad: unknown; end: number; pixelRatioEnd: number | null; msaa: unknown; reason: unknown };
  poster: string | null;
  load: { readyMs: number | null; warm: unknown; probe: unknown; probe3: unknown };
  programs: number;
  stops: BenchStop[];
  scroll: { seconds: number; frames: number; p50: number; p95: number; p99: number; max: number; over33: number; over50: number };
  governorSteps: string[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const frames = (n: number) =>
  new Promise<void>((resolve) => {
    let k = 0;
    const step = () => (++k >= n ? resolve() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  });

function pct(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  return +sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))].toFixed(1);
}

export async function runBench(
  scene: WorldScene,
  stops: ReadonlyArray<{ id: string }>,
  onStatus: (text: string) => void,
  scrollSeconds = 24,
): Promise<BenchResult> {
  const info0 = scene.qualityInfo() as { report: Record<string, unknown>; quality: { tier: number } };
  const r0 = info0.report;
  const tierAfterLoad = info0.quality.tier;
  const steps: string[] = [];
  const tb = performance.now();
  let lastLast = String(r0.last ?? "");
  /** Every tier or pixel ratio change during the bench (the governor's, or the probe's). */
  const noteSteps = () => {
    const last = String((scene.qualityInfo() as { report: Record<string, unknown> }).report.last ?? "");
    if (last !== lastLast) {
      lastLast = last;
      steps.push(`${((performance.now() - tb) / 1000).toFixed(1)} s: ${last}`);
    }
  };
  // Every stop reachable: the bench runs the open route.
  scene.setLock("open", stops.length - 1);
  await frames(3);

  const out: BenchStop[] = [];
  const positions = [{ id: "opening", depth: 0 }, ...stops.map((s) => ({ id: s.id, depth: scene.depthFor(s.id) }))];
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i];
    onStatus(`Stop ${i + 1} of ${positions.length}: ${p.id}`);
    window.scrollTo({ top: scene.scrollYForDepth(p.depth), left: 0, behavior: "instant" });
    scene.seedDepth(p.depth);
    await frames(4);
    await sleep(250);
    const b = scene.burstProbe(4, 3, 60, 300);
    out.push({ id: p.id, depth: +p.depth.toFixed(4), ms: b ? b.ms : null, med: b ? b.med : null });
    noteSteps();
  }

  // The whole route at a steady pace, as a student would scroll it.
  onStatus(`Scrolling the route (${scrollSeconds} s)`);
  window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  scene.seedDepth(0);
  await frames(4);
  const end = scene.scrollYForDepth(scene.lockLimit());
  const intervals: number[] = [];
  await new Promise<void>((resolve) => {
    const t0 = performance.now();
    let prev = t0;
    const step = (now: number) => {
      intervals.push(now - prev);
      prev = now;
      const t = Math.min(1, (now - t0) / (scrollSeconds * 1000));
      window.scrollTo({ top: end * t, left: 0, behavior: "instant" });
      noteSteps();
      if (t < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
  intervals.shift();
  const sorted = intervals.slice().sort((a, b) => a - b);

  const info = scene.qualityInfo() as {
    report: Record<string, unknown>;
    quality: { tier: number };
    pixelRatio: number | null;
    poster: { reason: string | null };
    programs: number;
  };
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    when: new Date().toISOString(),
    gpu: (r0.gpu as string | null) ?? null,
    userAgent: navigator.userAgent,
    cores: navigator.hardwareConcurrency ?? null,
    memoryGb: nav.deviceMemory ?? null,
    viewport: `${window.innerWidth}x${window.innerHeight}@${window.devicePixelRatio}`,
    tier: { pick: r0.pick, start: r0.start, afterLoad: tierAfterLoad, end: info.quality.tier, pixelRatioEnd: info.pixelRatio, msaa: r0.msaa, reason: r0.pickReason },
    poster: info.poster.reason,
    load: { readyMs: (r0.readyMs as number) ?? null, warm: r0.warm, probe: r0.probe, probe3: r0.probe3 ?? null },
    programs: info.programs,
    stops: out,
    scroll: {
      seconds: scrollSeconds,
      frames: intervals.length,
      p50: pct(sorted, 0.5),
      p95: pct(sorted, 0.95),
      p99: pct(sorted, 0.99),
      max: +(sorted[sorted.length - 1] ?? 0).toFixed(1),
      over33: intervals.filter((v) => v > 33.4).length,
      over50: intervals.filter((v) => v > 50).length,
    },
    governorSteps: steps,
  };
}

/** The results as plain text, for the copy button and the box. */
export function benchText(b: BenchResult): string {
  const warm = b.load.warm as { ms?: number; programsAfter?: number; pending?: number } | undefined;
  const probe = b.load.probe as { ms?: number; cold?: number; first?: number; took?: number } | undefined;
  const lines = [
    `World v6 bench, ${b.when}`,
    `GPU: ${b.gpu ?? "hidden by the browser"}`,
    `Screen: ${b.viewport}, ${b.cores ?? "?"} cores, ${b.memoryGb ?? "?"} GB`,
    `Tier: picked ${String(b.tier.pick)} (${String(b.tier.reason)}), after load ${String(b.tier.afterLoad)}, end ${b.tier.end} at pixel ratio ${b.tier.pixelRatioEnd ?? "-"}, MSAA ${String(b.tier.msaa)}`,
    `Posters: ${b.poster ?? "no, 3D"}`,
    `Load: ready ${b.load.readyMs ?? "?"} ms after navigation; warm compile ${warm?.ms ?? "?"} ms, ${warm?.programsAfter ?? "?"} programs${warm?.pending ? `, ${warm.pending} still compiling` : ""}; probe ${probe?.ms ?? "-"} ms (cold frame ${probe?.cold ?? "-"}, warm frame ${probe?.first ?? "-"}, took ${probe?.took ?? "-"} ms)`,
    `Programs now: ${b.programs}`,
    `Stops, GPU ms per frame: ${b.stops.map((s) => `${s.id} ${s.ms ?? "-"}`).join(", ")}`,
    `Scroll ${b.scroll.seconds} s, ${b.scroll.frames} frames: p50 ${b.scroll.p50} ms, p95 ${b.scroll.p95}, p99 ${b.scroll.p99}, worst ${b.scroll.max}; ${b.scroll.over33} over 33 ms, ${b.scroll.over50} over 50 ms`,
    `Governor: ${b.governorSteps.length ? b.governorSteps.join(" | ") : "no change"}`,
    `Browser: ${b.userAgent}`,
  ];
  return lines.join("\n");
}
