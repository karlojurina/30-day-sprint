"use client";

/**
 * Lightweight audio system for the pilot.
 *
 * Three sound cues to start:
 *   - lesson-complete  → soft quill scratch on a lesson node turning gold
 *   - sheet-open       → paper rustle when LessonSheet mounts
 *   - region-complete  → low brass swell when a region is charted
 *
 * Browsers block autoplay until the first user gesture, so the
 * system stays silent until any click happens. Toggle is persisted
 * in localStorage (key: `et.sound.enabled`) — defaults OFF.
 *
 * Each sound file is fetched lazily on first use, decoded into an
 * AudioBuffer, then played via a fresh AudioBufferSourceNode each
 * time. This avoids HTMLAudioElement's stutter on repeat plays.
 *
 * Files live under public/sounds/ — provide them as small .webm
 * (opus codec) for the best size/quality ratio. ~10–40 KB each.
 */

const STORAGE_KEY = "et.sound.enabled";

type SoundId = "lesson-complete" | "sheet-open" | "region-complete";

const SOUND_FILES: Record<SoundId, string> = {
  "lesson-complete": "/sounds/lesson-complete.webm",
  "sheet-open": "/sounds/sheet-open.webm",
  "region-complete": "/sounds/region-complete.webm",
};

let ctx: AudioContext | null = null;
const buffers = new Map<SoundId, AudioBuffer>();
const failedLoads = new Set<SoundId>(); // don't retry forever

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ctx) return ctx;
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  return ctx;
}

async function loadBuffer(id: SoundId): Promise<AudioBuffer | null> {
  if (buffers.has(id)) return buffers.get(id)!;
  if (failedLoads.has(id)) return null;
  const c = getCtx();
  if (!c) return null;
  try {
    const res = await fetch(SOUND_FILES[id]);
    if (!res.ok) {
      failedLoads.add(id);
      return null;
    }
    const arr = await res.arrayBuffer();
    const buf = await c.decodeAudioData(arr);
    buffers.set(id, buf);
    return buf;
  } catch {
    // File missing or undecodable — accept silently. Toggle still works,
    // just plays nothing. User can swap in real assets later.
    failedLoads.add(id);
    return null;
  }
}

export function isSoundEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(STORAGE_KEY) === "true";
}

export function setSoundEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, enabled ? "true" : "false");
  // Resume context on enable — first user gesture will unlock anyway,
  // but this primes it.
  if (enabled) getCtx()?.resume?.();
}

/**
 * Play a sound by id. No-op if sound is disabled, the buffer hasn't
 * loaded yet (it kicks off the load for next time), or the file
 * is missing.
 */
export function playSound(id: SoundId, volume: number = 0.6): void {
  if (!isSoundEnabled()) return;
  const c = getCtx();
  if (!c) return;
  const cached = buffers.get(id);
  if (!cached) {
    // Kick off async load; next call will succeed.
    void loadBuffer(id);
    return;
  }
  try {
    const src = c.createBufferSource();
    src.buffer = cached;
    const gain = c.createGain();
    gain.gain.value = volume;
    src.connect(gain).connect(c.destination);
    src.start(0);
  } catch {
    // AudioContext can be in a bad state on Safari — fail silently
  }
}

/**
 * Pre-load every sound on first user gesture. Call once from a
 * top-level component (e.g. SettingsPopover mount).
 */
export function preloadSounds(): void {
  for (const id of Object.keys(SOUND_FILES) as SoundId[]) {
    void loadBuffer(id);
  }
}
