"""
v6 cheap-laptop model: scales the frame times measured on the M2 Pro
(world-tests/v6-bench.mjs runs in shots/v6/cheap/baseline/) to other GPUs.

  python3 world-tests/v6-bench-model.py            prints the tables and writes model.json next to the runs
  MODEL_DIR=shots/v6/cheap/after MODEL_RULES=after python3 world-tests/v6-bench-model.py   (MODEL_DIR is relative to world-tests/)
        the runs in MODEL_DIR (a run missing there is read from baseline/), and the landing
        with the rules after the cheap-laptop hardening (pickTier's 610M fix, the probe's
        50 ms first frame and tier 3 check at 28 ms, the governor's 38 ms poster step)

Per position and tier, the M2 frame is split into a fixed part (does not grow
with pixels) and a pixel part (ms per megapixel):
  tier 0: least squares over three sizes (1366x768@1, 1920x1080@1, 1691x1278@1.5)
  tiers 1 to 3: fixed = tier 0 fixed x (triangles at the tier / triangles at tier 0);
                pixel = least squares of (measured - fixed) against megapixels over
                1366x768 and 1920x1080 at that tier
Another GPU:  ms = k_fixed * fixed + k_pixel * pixel * megapixels
  k_alu   = M2 FP32 / GPU FP32
  k_bw    = M2 bandwidth / GPU bandwidth
  k_fixed = 0.8 * k_alu                         (range 0.5 to 1.0)
  k_pixel = imr * max(k_alu, 0.6 * k_bw)        imr 1.4 (Intel, AMD), 1.2 (NVIDIA); range x0.8 to x1.3
            x 1.3 with MSAA on (tiers 0, 1) on these immediate mode GPUs
            x 1.5 more on the falls frames (blended curtain, spray and mist fill the screen)
"""
import json, os, glob, math

HERE = os.path.dirname(os.path.abspath(__file__))
BASE_D = os.path.join(HERE, "shots/v6/cheap/baseline")
D = os.path.join(HERE, os.environ["MODEL_DIR"]) if os.environ.get("MODEL_DIR") else BASE_D
RULES = os.environ.get("MODEL_RULES", "baseline")
FROM_BASE = []

def load(tag):
    p = os.path.join(D, tag + ".json")
    if not os.path.exists(p):
        p = os.path.join(BASE_D, tag + ".json")
        if not os.path.exists(p):
            return None
        if D != BASE_D:
            FROM_BASE.append(tag)
    r = json.load(open(p))
    rows = (r.get("positions") or {}).get("rows") or []
    return {x["id"]: x for x in rows} if rows else None

def mp(w, h, pr):
    return w * h * pr * pr / 1e6

RUNS = {
    (0, "1080"): ("gpu-cpu1x-1920x1080@1-tier0", mp(1920, 1080, 1)),
    (0, "768"): ("gpu-cpu1x-1366x768@1-tier0", mp(1366, 768, 1)),
    (0, "1691"): ("gpu-cpu1x-1691x1278@1.5-tier0", mp(1691, 1278, 1.5)),
    (1, "1080"): ("gpu-cpu1x-1920x1080@1-tier1", mp(1920, 1080, 1)),
    (1, "768"): ("gpu-cpu1x-1366x768@1-tier1", mp(1366, 768, 1)),
    (2, "1080"): ("gpu-cpu1x-1920x1080@1-tier2-lowgpu", mp(1920, 1080, 1)),
    (2, "768"): ("gpu-cpu1x-1366x768@1-tier2-lowgpu", mp(1366, 768, 1)),
    (3, "1080"): ("gpu-cpu1x-1920x1080@1-tier3-lowgpu", mp(1920, 1080, 0.75)),
    (3, "768"): ("gpu-cpu1x-1366x768@1-tier3-lowgpu", mp(1366, 768, 0.75)),
}
data = {k: (load(t), m, t) for k, (t, m) in RUNS.items()}
missing = [v[2] for v in data.values() if v[0] is None]

ids = list(data[(0, "1080")][0].keys())
label = {i: data[(0, "1080")][0][i]["label"] for i in ids}
WATER = {"stop3", "k11.5", "k13", "k15", "k17", "k18.7", "k23", "k25.4", "k28"}

def fit(points):
    """least squares ms = a + b * MP"""
    n = len(points)
    sx = sum(p[0] for p in points); sy = sum(p[1] for p in points)
    sxx = sum(p[0] ** 2 for p in points); sxy = sum(p[0] * p[1] for p in points)
    den = n * sxx - sx * sx
    b = (n * sxy - sx * sy) / den if den else 0
    a = (sy - b * sx) / n
    return a, b

split = {}  # (id, tier) -> (fixed, pixel per MP)
resid = []
for i in ids:
    pts = [(m, d[i]["burst"]["ms"]) for (t, s), (d, m, _) in data.items() if t == 0 and d and i in d]
    a, b = fit(pts)
    a = max(0.2, a); b = max(0.05, b)
    split[(i, 0)] = (a, b)
    resid += [abs(a + b * m - y) / y for m, y in pts]
# Tiers 1 to 3: one route-wide factor per tier on the pixel part (per position, two small
# M2 bursts are too noisy: some stops came out cheaper at tier 2 than at tier 3).
# fixed_t = fixed_0 x triangles ratio; pixel_t = c_t x pixel_0, c_t by least squares over
# every position at both sizes.
TIER_C = {0: 1.0}
for t in (1, 2, 3):
    num = den = 0.0
    fixed_t = {}
    for i in ids:
        a, b = split[(i, 0)]
        tris0 = data[(0, "1080")][0][i]["counts"]["tris"]
        pts = [(m, d[i]["burst"]["ms"], d[i]["counts"]["tris"]) for (tt, s), (d, m, _) in data.items() if tt == t and d and i in d]
        if not pts:
            continue
        fx = a * (sum(p[2] for p in pts) / len(pts)) / tris0
        fixed_t[i] = fx
        for m, y, _ in pts:
            x = b * m
            num += (y - fx) * x
            den += x * x
    c = max(0.05, num / den) if den else 1.0
    TIER_C[t] = c
    for i, fx in fixed_t.items():
        split[(i, t)] = (fx, split[(i, 0)][1] * c)

# ── The GPUs ──
# gflops FP32, bandwidth GB/s (the usual configuration), imr factor, name as ANGLE on Windows reports it, cpu factor vs M2 Pro single thread
GPUS = [
    ("Apple M2 Pro 16-core (this Mac)", 5726, 200, None, "tier 0", 1.0),
    ("Intel UHD 600 (Celeron N4020, 12 EU)", 125, 19.2, 1.4, "UHD Graphics 600", 5.0),
    ("Intel UHD 620 (i5-8250U, 24 EU)", 422, 37.5, 1.4, "UHD Graphics 620", 2.0),
    ("Intel Iris Xe 80 EU (i5-1135G7)", 1664, 51.2, 1.4, "Iris(R) Xe Graphics", 1.5),
    ("Intel Iris Xe 96 EU (i7-1165G7)", 1997, 68.3, 1.4, "Iris(R) Xe Graphics", 1.4),
    ("AMD Radeon Vega 6 (Ryzen 3 5300U)", 1152, 51.2, 1.4, "Radeon(TM) Graphics", 1.8),
    ("AMD Radeon Vega 8 (Ryzen 5 3500U)", 1229, 38.4, 1.4, "Radeon(TM) Vega 8 Graphics", 2.3),
    ("AMD Radeon 610M (Ryzen 5 7520U)", 486, 44.0, 1.4, "Radeon(TM) 610M", 1.8),
    ("NVIDIA MX450 12 W (GDDR5)", 1667, 48.0, 1.2, "GeForce MX450", 1.5),
    ("NVIDIA MX450 28.5 W (GDDR6)", 2822, 80.0, 1.2, "GeForce MX450", 1.5),
    ("NVIDIA GTX 1650 laptop", 3195, 128.0, 1.2, "GeForce GTX 1650", 1.6),
]
M2_GF, M2_BW = 5726, 200

def ks(g, band="mid"):
    gf, bw, imr = g[1], g[2], g[3]
    if imr is None:
        return 1.0, 1.0, False
    kalu = M2_GF / gf
    kbw = M2_BW / bw
    kf = {"lo": 0.5, "mid": 0.8, "hi": 1.0, "lofix": 0.3}[band] * kalu
    kp = imr * max(kalu, 0.6 * kbw) * {"lo": 0.8, "mid": 1.0, "hi": 1.3, "lofix": 1.0}[band]
    return kf, kp, True

TIER_PR = {0: 1.0, 1: 1.0, 2: 1.0, 3: 0.75}  # at DPR 1 (cheap laptops): tiers 0-2 draw at 1.0, tier 3 at 0.75
SCREENS = {"1920x1080": (1920, 1080), "1366x768": (1366, 768)}
STOPS = [f"stop{k}" for k in range(1, 9)]

def frame(g, i, t, screen, band="mid", pr=None, msaa=None):
    if (i, t) not in split:
        return None
    fx, px = split[(i, t)]
    w, h = SCREENS[screen]
    m = mp(w, h, TIER_PR[t] if pr is None else pr)
    kf, kp, imr = ks(g, band)
    if imr and (t <= 1 if msaa is None else msaa):
        kp *= 1.3
    if imr and i in WATER:
        kp *= 1.5
    return kf * fx + kp * px * m

def route(g, t, screen, band="mid"):
    v = [(frame(g, i, t, screen, band), i) for i in ids if (i, t) in split]
    v.sort()
    return v

out = {"missing": missing, "split": {f"{i}|{t}": v for (i, t), v in split.items()}, "gpus": []}
L = []
say = L.append
if missing:
    say("MISSING RUNS: " + ", ".join(missing))
if FROM_BASE:
    say("READ FROM baseline/ (not re-run): " + ", ".join(FROM_BASE))
if D != BASE_D or RULES != "baseline":
    say(f"runs from {D}; landing rules: {RULES}")
resid.sort()
say(f"tier 0 fit over 3 sizes: median residual {100*resid[len(resid)//2]:.0f}%, 90th {100*resid[int(len(resid)*0.9)]:.0f}%")
say("pixel part per tier relative to tier 0 (route-wide, measured on the M2): " + ", ".join(f"tier {t} {c:.2f}" for t, c in TIER_C.items()))
say("M2 split per stop (fixed ms + pixel ms/MP), tiers 0 / 3:")
for i in STOPS + ["k0", "k11.5", "k13", "k23", "k45"]:
    s0 = split.get((i, 0)); s3 = split.get((i, 3))
    say(f"  {i:7s} {label[i][:30]:30s} t0 {s0[0]:.2f} + {s0[1]:.2f}/MP   t3 {s3[0]:.2f} + {s3[1]:.2f}/MP" if s0 and s3 else f"  {i} -")

# Validation: predict the 1691x1278@1.5 and 1366x768 tier 3 runs from the split (M2 itself).
say("")
for g in GPUS:
    kf, kp, imr = ks(g)
    rec = {"gpu": g[0], "gflops": g[1], "bw": g[2], "k_fixed": round(kf, 2), "k_pixel": round(kp, 2), "screens": {}}
    for sc in SCREENS:
        rec["screens"][sc] = {}
        for t in (0, 1, 2, 3):
            stops = [frame(g, i, t, sc) for i in STOPS]
            rt = route(g, t, sc)
            lo = route(g, t, sc, "lo"); hi = route(g, t, sc, "hi")
            rec["screens"][sc][t] = {
                "stops": [round(x, 1) if x is not None else None for x in stops],
                "worst": round(rt[-1][0], 1), "worstAt": rt[-1][1],
                "median": round(rt[len(rt) // 2][0], 1),
                "worstRange": [round(lo[-1][0], 1), round(hi[-1][0], 1)],
                "opening": round(frame(g, "k0", t, sc), 2),
            }
    out["gpus"].append(rec)

def fmt(x):
    return "-" if x is None else (f"{x:.0f}" if x >= 10 else f"{x:.1f}")

for sc in SCREENS:
    say(f"\nModelled GPU ms per frame at {sc} (DPR 1; tiers 0-2 at pixel ratio 1.0, tier 3 at 0.75):")
    say("| GPU | tier | a1 | a2 | a3 | a4 | a5 | a6 | a7 | a8 | route worst (where) | worst range |")
    say("|---|---|---|---|---|---|---|---|---|---|---|---|")
    for rec in out["gpus"]:
        for t in (0, 1, 2, 3):
            r = rec["screens"][sc][t]
            say(f"| {rec['gpu']} | {t} | " + " | ".join(fmt(x) for x in r["stops"]) + f" | {fmt(r['worst'])} ({r['worstAt']}) | {fmt(r['worstRange'][0])} to {fmt(r['worstRange'][1])} |")

# ── Where each GPU lands: quality.ts pickTier (by the name, checked with the real function
# in the model doc), then refineTier on the opening x 1.8, then the governor's ladder at DPR 1:
# t0@1.0 -> t1@1.0 -> t2@1.0 -> t2@0.85 -> t3@0.75, one step while the route's 90th percentile
# moving frame stays over 20 ms. MSAA stays as the pick made the canvas.
PICK = {"tier 0": 0, "UHD Graphics 600": 2, "UHD Graphics 620": 2, "Iris(R) Xe Graphics": 1, "Radeon(TM) Graphics": 2,
        "Radeon(TM) Vega 8 Graphics": 2, "Radeon(TM) 610M": 1, "GeForce MX450": 0, "GeForce GTX 1650": 0}
LADDER = [(0, 1.0), (1, 1.0), (2, 1.0), (2, 0.85), (3, 0.75)]
if RULES == "after":
    PICK["Radeon(TM) 610M"] = 2  # quality.ts LOW_GPU now knows 610M and 660M: tier 2, MSAA off

def stats_at(g, t, pr, sc, msaa, band="mid"):
    v = sorted((frame(g, i, t, sc, band, pr, msaa), i) for i in ids if (i, t) in split)
    return v[-1], v[int(len(v) * 0.9)], v[len(v) // 2]

say("\nWhere each GPU lands (pick, probe, governor) and its frames there, mid estimate:")
say("| GPU | screen | pick (MSAA) | probe predicts | after probe | governor lands on | median ms | p90 ms | worst ms (where) | worst, range | median / worst if fixed = 0.3 k_alu |")
say("|---|---|---|---|---|---|---|---|---|---|---|")
for g in GPUS:
    for sc in SCREENS:
        pick = PICK[g[4]]
        msaa = pick <= 1
        pred = frame(g, "k0", pick, sc, msaa=msaa) * 1.8
        t = pick
        poster = None
        if RULES == "after" and pred / 1.8 > 50:
            t = 3  # the probe's first synced frame over 50 ms: tier 3 at once
        elif pred > 14 and t < 3:
            t += 1
        elif pred < 5 and t > 0:
            t -= 1
        if RULES == "after" and (t == 3 or pred > 50):
            t = 3
            p3 = frame(g, "k0", 3, sc, msaa=msaa)
            if p3 > 28:
                poster = f"load: tier 3 opening {p3:.0f} ms > 28"
        step = [k for k, (tt, p) in enumerate(LADDER) if tt == t][0]
        while True:
            tt, pr = LADDER[step]
            worst, p90, med = stats_at(g, tt, pr, sc, msaa)
            if p90[0] > 20 and step < len(LADDER) - 1:
                step += 1
                continue
            break
        if RULES == "after" and poster is None and step == len(LADDER) - 1:
            # the governor's poster step: moving frames averaging over 38 ms at the last rung
            if med[0] > 38:
                poster = f"governor: median {med[0]:.0f} ms > 38 at tier 3, 0.75"
        lo = stats_at(g, tt, pr, sc, msaa, "lo")[0][0]
        hi = stats_at(g, tt, pr, sc, msaa, "hi")[0][0]
        lf = stats_at(g, tt, pr, sc, msaa, "lofix")
        lands = f"tier {tt} at {pr}" + (f" -> POSTERS ({poster})" if poster else "")
        say(f"| {g[0]} | {sc} | {pick} ({'on' if msaa else 'off'}) | {pred:.1f} | {t} | {lands} | {fmt(med[0])} | {fmt(p90[0])} | {fmt(worst[0])} ({worst[1]}) | {fmt(lo)} to {fmt(hi)} | {fmt(lf[2][0])} / {fmt(lf[0][0])} |")
        out.setdefault("landing", []).append({"gpu": g[0], "screen": sc, "pick": pick, "msaa": msaa, "probePredicts": round(pred, 1), "afterProbe": t, "lands": [tt, pr], "poster": poster, "median": round(med[0], 1), "p90": round(p90[0], 1), "worst": round(worst[0], 1), "worstAt": worst[1], "worstRange": [round(lo, 1), round(hi, 1)]})

json.dump(out, open(os.path.join(D, "model.json"), "w"), indent=1)
open(os.path.join(D, "model.txt"), "w").write("\n".join(L) + "\n")
print("\n".join(L))
