# World render tests

Headless Chrome renders the real WebGL scene so somebody can actually **look**
at it — including me.

This exists because this project produced three confident, wrong visual
diagnoses in a row, all of them from reasoning about renders nobody had seen.
The lesson recorded at the time: build the looking-tool *before* shipping a
guess, not after the second wrong one.

## Run

```bash
npm install                     # once, in this directory
PORT=3111 npm run dev           # in the app root, separate terminal
node render.mjs                 # screenshots at both real aspect ratios
node compare.mjs                # A/B against the published prototype
```

Screenshots land in `shots/` (gitignored — they are large and regenerable).

## What each script does

**`render.mjs`** loads `/dev/world` at the two viewports that have already
bitten once — Lovro's 1691×1278 split screen and his 3428×1230 ultrawide — at
three rail depths, and screenshots each. The ultrawide shot is the one that
matters: `PerspectiveCamera` fov is **vertical**, so a wider monitor sees *more*
world, and the world's edge became visible twice before `X_OVERSCAN` widened the
mesh. Cropping with a narrower lens can never fix that; only a wider mesh can.

**`compare.mjs`** is the stronger check. It renders the published prototype
(`_admin/research/world-gen/.build/`, the build Lovro saw and approved) and the
ported scene at the same viewport and depth, then diffs the centre crop —
centre, because the prototype draws HUD text in the corners that the port does
not. It reports a mean channel difference and the port's mean brightness.

Current: **mean diff 2.89/255, brightness 45.4.** The brightness check is aimed
at a specific historical bug — when glTF flattened Blender's haze Emission onto
every material, the whole world read as a cream blank and brightness would sit
above 200.

## The two traps, both hit the hard way

1. **`--virtual-time-budget` never settles against a `requestAnimationFrame`
   loop.** The run just hangs. Wait on an explicit ready flag instead
   (`window.__worldReady`).
2. **The render loop re-reads `scrollDepth()` every frame**, so setting a depth
   variable is pulled straight back to the scroll position. Drive it by
   *actually scrolling the page*.

## Test hooks live on the dev page only

`window.__worldReady` / `__worldDepth` / `__worldMarkers` are set by
`src/app/dev/world/page.tsx`, which `notFound()`s outside development. The
shipped `WorldCanvas` has no hooks at all — the rule from the research notes is
to inject them into a copy, never the real file.
