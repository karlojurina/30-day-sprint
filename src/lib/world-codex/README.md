# Codex map study

A separate implementation of the September 24 EcomTalent world brief, made
for Lovro to compare with the existing map. Open `/dev/world-codex` while
running `npm run dev`. The page returns 404 outside development.

## Direction

Keep the Firewatch sunset, Gran Turismo destination selection, eight plain
module names, and scroll travel. Give the landscape a different composition:
a river acts as the visual spine, the two bridges mark the learning sequence,
and a winding trail connects the coast, woods, gorge, highlands, lake and summit.
The lighthouse and windmill establish the scale. Distant ridges recede into
warm haze. Architecture is readable by silhouette; UI stays around the edges.

The reference context is `/.impeccable.md` within this project, plus
`../_admin/memos/sprint_rebuild.md` and the world-generator notes in the parent
workspace. This experiment does not revise the agreed production direction.

## Boundaries

- New development route, components, and scene only. The original map,
  assets, student routes, authentication and database are untouched.
- `study.ts` is explicitly sample content/progress. It has no completion
  writes, video playback, curriculum gating, or connection to student data.
- All eight places can be explored for comparison, regardless of the sample
  progress. This is an art/interaction study, not a production access model.
- Lessons open inside a panel over the same scene. The preview clearly says
  its lesson titles are illustrative and no course video is connected.
- Phones show the course index and never mount the dynamically imported 3D
  component. A WebGL failure also falls back to the index.

## Implementation

`terrain.ts` owns the deterministic height field, river, landmark coordinates,
terraces and walking route. `scene.ts` builds the terrain, sky, water, architecture
and vegetation directly in Three.js. It does not reuse the existing GLB or
scene class and makes no requests for textures or models.

Trees and rocks are instanced; static architecture is batched by material.
The initial view has approximately 272k triangles and 49 draw calls. These
are geometry diagnostics, not a device-performance benchmark. Rendering
pauses in a hidden tab or behind the course index. GPU resources are disposed
on unmount. Reduced motion removes the camera smoothing and ambient movement.

The DOM owns accessible buttons and focus. Marker positioning is imperative;
React only updates when the nearest area changes. The bottom navigation keeps
all areas reachable when distant labels overlap. Escape backs out of a lesson,
then an area, and restores focus. The “Hide interface” control keeps a way back.

## Verification

From the project root:

```sh
npx tsc --noEmit --incremental false
npx eslint src/app/dev/world-codex src/components/world-codex src/lib/world-codex world-tests/codex-map.mjs
node world-tests/codex-map.mjs
```

The browser harness expects the dev server at `http://127.0.0.1:3111` (override
with `BASE_URL`). It uses the project's existing Puppeteer installation and
local Google Chrome. Screenshots go to `/tmp/codex-map-shots` (override with
`OUT_DIR`). `--quick` captures only the initial landscape. The full run checks
all eight area panels, lesson navigation, Escape, interface visibility, desktop
and ultrawide rendering, phone overflow/no-canvas, and the WebGL fallback.
