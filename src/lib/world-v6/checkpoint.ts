/**
 * The discount checkpoint in the world (2026-10-14, Lovro: "something in
 * between the trail hut and the boathouse. It's going to be a place, and we
 * should be able to click into it").
 *
 * THE TRAIL CACHE. Out of the gully, on the saddle's crest, a trail crew
 * built a cache: a small log storehouse up on four tall posts (tin bands on
 * them, so nothing climbs up), its door facing the trail, a lantern on a
 * bracket by the door, a ladder, a pennant on the gable and a tag-shaped
 * board hanging under the deck. Hikers leave supplies in it for the ones who
 * come after. Here it holds the 30%: the student who has watched 80% of the
 * videos up to it (every one until 2026-10-26) gets what is inside.
 *
 * Where: 20 east of the trail on the saddle's crest (the ground is flat there,
 * 647 to 649), between Static Ads' lanterns (west of the trail) and the
 * boulders at the crest's east side (rocks.ts, 30 and more away). From the
 * burst at the gully's top the trail leads straight to it, ~350 ahead, so it
 * stands in the notch the camera climbs into; the camera then passes 25 west
 * of it and ~40 over its pennant. No camera key, stop or rail row moves for it.
 * Its depth on the rail (scene depthFor: the rail point that frames it from
 * 400 back, rail.ts sNearest) is the burst's.
 *
 * The look follows the student (dress-checkpoint.ts):
 *   closed   the ladder lies on the ground, the door is shut, the lantern is
 *            dark glass, the pennant is furled, a dim light in the gable
 *            window. What every student sees with no offer, and what it looks
 *            like once the offer is gone.
 *   near     the lantern is lit: the student is in Video Ads II, or a few
 *            videos away.
 *   ready    the ladder stands against the door, the door is ajar with warm
 *            light behind it, the window is lit, the lantern pulses gently,
 *            the pennant flies.
 *   claimed  the door stands open, everything lit and steady, the pennant
 *            flies (an application made, approved or applied).
 *
 * Pure data, no three.js, so node tests load it.
 */

export type CheckpointLook = "closed" | "near" | "ready" | "claimed";

export const CHECKPOINT = {
  /** The scene anchor's id: what pickAnchor and the frame's markers call it. */
  id: "checkpoint",
  /** The landmark object's name (the scene indexes every LM_* object). */
  mesh: "LM_Checkpoint",
  /** Base centre on the ground (y is read off the terrain). */
  x: 1472,
  z: 692,
  /** Compass bearing the door looks along: toward the trail and the gully's top. */
  facing: 205,
  /** Rough height to the pennant's top. */
  height: 44,
  /** The place it follows on the route (index into layout.PLACES: a4, Video Ads II). */
  after: 3,
  /**
   * The click-in view (as layout.PARK_VIEWS): south of it over the trail, a
   * little above its deck, the cache right of the frame's middle with the
   * valley and the peaks behind it and the left of the frame quiet for the
   * panel. Position, compass bearing, pitch below the horizon, vertical lens.
   */
  park: { x: 1436, y: 690, z: 862, bearing: 4, pitch: 4, fov: 40 },
} as const;
