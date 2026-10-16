/**
 * The Ad Bounty checkpoint in the world (map review, 2026-10-15, plan item 18;
 * Lovro at 13:23 to 14:09: "how to win on the bounty program, that is going
 * to require another checkpoint ... maybe on this island over here. Just
 * think of something nice again, clickable, and then that is going to have
 * the one video for bounties").
 *
 * THE BOUNTY BOARD. The notice board on the isle past the rope bridge, made
 * into a landmark (dress-sky.ts, LM_Bounty): a timber board under a shingled
 * gable roof on a stone step, bounty notices pinned to it with wax seals, a
 * brass seal on the gable, a caged lantern hanging off each post, a writing
 * stand with the sign-up ledger. Brands post their briefs here; the student
 * who comes off the bridge reads them before boarding the airship.
 *
 * Where: on the isle's top, LEFT of the walk from the bridge's end to the
 * moored ship (ALONG units along it, LEFT units to its left), facing back
 * toward the bridge's end, so it stands in the frame as the student comes off
 * the bridge. The supplies that stood on the walk (the crates the camera went
 * through, 13:44) stand behind the board now. No camera key, stop or rail row
 * moves for it. Its depth on the rail (scene depthFor: the rail point that
 * frames it from 400 back, rail.ts sNearest) is on the isle's crossing.
 *
 * Always open: the bounty is no reward to earn, so the checkpoint never
 * locks, has no look that follows the student, and shows from day one.
 *
 * Pure data, no three.js, so node tests load it.
 */
import { BRIDGE, SHIP_MOORED, WORLD } from "./layout";

const DEG = Math.PI / 180;
/** Compass bearing of the walk across the isle: the bridge's end to the moored ship. */
const WALK = Math.atan2(SHIP_MOORED.x - BRIDGE.b[0], -(SHIP_MOORED.z - BRIDGE.b[2])) / DEG;
/** The board's centre: this far along the walk from the bridge's end, this far to its left. */
const ALONG = 58;
const LEFT = 34;
const BX = BRIDGE.b[0] + Math.sin(WALK * DEG) * ALONG + Math.sin((WALK - 90) * DEG) * LEFT;
const BZ = BRIDGE.b[2] - Math.cos(WALK * DEG) * ALONG - Math.cos((WALK - 90) * DEG) * LEFT;
/** The board's face looks back at the bridge's end. */
const FACING = Math.atan2(BRIDGE.b[0] - BX, -(BRIDGE.b[2] - BZ)) / DEG;

export const BOUNTY = {
  /** The scene anchor's id: what pickAnchor and the frame's markers call it. */
  id: "bounty",
  /** The landmark object's name (the scene indexes every LM_* object). */
  mesh: "LM_Bounty",
  /** The board's centre on the isle's top (the isle is flat at WORLD.bountyIsle.y). */
  x: BX,
  y: WORLD.bountyIsle.y,
  z: BZ,
  /** Compass bearing the board's face looks along. */
  facing: FACING,
  /** The walk's bearing, and how far left of it the board stands (dress-sky keeps the walk clear). */
  walk: WALK,
  left: LEFT,
  /** The place it follows on the route (index into layout.PLACES: a7, Creative Strategy). */
  after: 6,
  /**
   * The click-in view (as layout.PARK_VIEWS): off the isle's south-west rim,
   * beside the bridge's end and 40 over the top, looking north-east across
   * the isle: the board in the lower right, the moored airship over it, the
   * cloud sea and the night sky on the left, quiet for the panel. Position,
   * compass bearing, pitch below the horizon, vertical lens.
   */
  park: { x: -1735, y: 1650, z: -2330, bearing: 28, pitch: 6, fov: 40 },
} as const;
