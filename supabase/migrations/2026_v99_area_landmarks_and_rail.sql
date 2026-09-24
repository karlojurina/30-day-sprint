-- ============================================================
-- v99 — the art direction's data: landmarks and rail stops
--
-- Output of the art-direction conversation (2026-09-24), recorded in
-- 30-day-sprint/.impeccable.md. These are the two columns v94 deliberately
-- left null because the look had not been decided yet.
--
-- WHAT A LANDMARK IS FOR. Navigation by memory — "the viaduct one". The eight
-- silhouettes ARE the area markers; without them /world is a column of pills
-- floating down the middle of a painting, which is what it was before this.
--
-- ⚠ `landmark_label` IS NOT FREE TEXT. The app derives the mesh name from it
--   by convention: `LM_` + the label with spaces removed
--   (lib/world/catalog.ts). So 'Viaduct' finds `LM_Viaduct` in world.glb, and
--   renaming it to 'The Viaduct' would look for `LM_TheViaduct` and silently
--   fall back to the rail centre line. The other half of the contract is
--   `_mesh_from_bm(bm, "LM_Viaduct", ...)` in ridge.py.
--
-- WHERE rail_at COMES FROM. Not taste — `_admin/research/world-gen/
-- check_geom.py` computes it. It is the scroll depth at which the camera
-- STOPS TO LOOK AT that landmark, set back 350 units so the silhouette sits in
-- the middle distance. The first attempt used the depth at which the camera
-- stands ON the landmark, which put the obelisk behind and below the camera at
-- the summit and dropped its marker out of frame entirely (measured: 0 markers
-- visible at depth 0.95). Every value below is verified to land its marker
-- within 5.2 degrees of frame centre.
--
-- Re-run check_geom.py and use the SQL line it prints if ridge.py's LEN_Y,
-- LANDMARK_SPOTS or build_camera ever change. These numbers are downstream of
-- all three.
--
-- Safe: `regions_next` is the staging catalog. Nothing live reads it.
-- Idempotent.
-- ============================================================

begin;

update public.regions_next as r
   set landmark_label = v.label,
       rail_at        = v.rail_at,
       terrain        = v.terrain
  from (values
    ('a1', 'Lighthouse', 0.0708, 'the shore'),
    ('a2', 'Windmill',   0.1934, 'the lowland wood'),
    ('a3', 'Bridge',     0.3000, 'the river valley'),
    ('a4', 'Viaduct',    0.4151, 'the gorge'),
    ('a5', 'Watchtower', 0.5236, 'the basin'),
    ('a6', 'Cairn',      0.6321, 'the highlands'),
    ('a7', 'Jetty',      0.6863, 'the plateau, with the pond'),
    ('a8', 'Obelisk',    0.8302, 'the peaks')
  ) as v(id, label, rail_at, terrain)
 where r.id = v.id;

-- `terrain` is INTERNAL. It never reaches a student: the UI shows the plain
-- module name, because Lovro rejects metaphor names on sight and his audiences
-- scan. It is here so the generator and the database agree on what each place
-- is meant to be.
comment on column public.regions_next.terrain is
  'Internal terrain character, matching TERRITORIES in ridge.py. NEVER shown '
  'to a student — the UI shows the plain module name.';

comment on column public.regions_next.landmark_label is
  'The silhouette marking this area. The app derives the glb mesh name as '
  '''LM_'' || replace(label, '' '', '''') — so this is a contract with '
  'ridge.py, not free text.';

comment on column public.regions_next.rail_at is
  'Scroll depth 0..1 at which the camera stops to look at this area''s '
  'landmark. Computed by _admin/research/world-gen/check_geom.py; re-run it if '
  'LEN_Y, LANDMARK_SPOTS or build_camera change.';

commit;

-- ============================================================
-- POST-CHECKS
-- ============================================================
--
-- 1. All eight have both values, ascending:
--    select id, name, landmark_label, rail_at, terrain
--      from regions_next order by order_num;
--    EXPECT 8 rows; rail_at rising 0.0708 -> 0.8302; no nulls in either column.
--
-- 2. The labels match meshes that exist in world.glb. The app logs
--    "[world] landmarks not in the glb: ..." if one does not resolve, and the
--    marker falls back to the rail rather than vanishing.
--    EXPECT: LM_Lighthouse, LM_Windmill, LM_Bridge, LM_Viaduct,
--            LM_Watchtower, LM_Cairn, LM_Jetty, LM_Obelisk
--
-- 3. Nothing live moved:
--    select count(*) from regions;    -- EXPECT 4
--    select count(*) from lessons;    -- EXPECT 65
-- ============================================================
