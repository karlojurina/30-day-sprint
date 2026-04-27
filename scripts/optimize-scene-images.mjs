// One-off image optimizer for the expedition scene PNGs.
// Reads originals from public/regions/_originals/ and writes WebP at 3200px
// wide into public/regions/. Keeps the originals untouched so the picker
// tool can keep tracing against full-resolution source.
import sharp from "sharp";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

const SRC_DIR = "public/regions/_originals";
const DST_DIR = "public/regions";
const TARGET_WIDTH = 3200;

const files = (await readdir(SRC_DIR)).filter((f) => f.endsWith(".png"));

for (const file of files) {
  const src = join(SRC_DIR, file);
  const dst = join(DST_DIR, file.replace(/\.png$/, ".webp"));
  const before = (await sharp(src).metadata()).size;
  const info = await sharp(src)
    .resize({ width: TARGET_WIDTH, withoutEnlargement: true })
    .webp({ quality: 82, effort: 6 })
    .toFile(dst);
  const ratio = before ? ((1 - info.size / before) * 100).toFixed(1) : "?";
  console.log(
    `${file.padEnd(28)} → ${dst.replace(/^public\//, "")}  (${(info.size / 1e6).toFixed(2)} MB, ${ratio}% smaller)`
  );
}
