/**
 * Marker label layout. Runs once per rendered frame, so it allocates nothing:
 * every buffer is sized once in the constructor and reused.
 *
 * The problem it solves: with a low camera the far landmarks bunch up near the
 * horizon, and the old build printed six of seven labels inside one 180px
 * band. The rules, in order:
 *
 *   1. Priority: the current area, then the area nearest the camera, then the
 *      rest by nearness.
 *   2. A marker gets a text label only if its box overlaps nothing placed
 *      before it and no text label already sits within BAND px horizontally.
 *      Any 180px band can therefore hold at most one text label.
 *   3. Otherwise it becomes a dot, still clickable. A dot is dropped only when
 *      it would touch a placed text label's body, stem or pin, or sit in a
 *      reserved rect (the header, the NEXT block, the dock). Every area stays
 *      reachable from the dock either way.
 *   4. A text label whose body would cover another marker's pin is raised
 *      on a longer stem (up to MAX_STEM_EXTRA) until it clears it. From the
 *      shore the viaduct's pin sat under the "Video Ads I" label on a laptop,
 *      so the viaduct had no marker at all while it stood mid-frame.
 *
 * Hysteresis: a label that was text last frame keeps the plain BAND; a dot
 * needs BAND_ENTER to turn into text. Both are >= BAND, so the one-per-band
 * guarantee holds while the two labels at a boundary stop flickering.
 *
 * Round 1 (Lovro's walkthrough: "the text is on top of the big tree so as
 * soon as I scroll in a bit, I don't see it"): a label stays while any real
 * part of its landmark is on screen. When the anchor above the landmark's top
 * has left the frame, or its label would run into the header or an edge, the
 * pin slides into the landmark's visible box (the scene's rl..rb): down to
 * just under the header, sideways inside the frame. Near a side edge the
 * plaque may sit off centre on its stem (`shift`), as long as the stem still
 * meets it. The output pin position is px/py, not the marker's own x/y.
 */

export const HIDDEN = 0;
export const DOT = 1;
export const TEXT = 2;

/** Pixels from the anchor point up to the label's bottom edge. */
export const STEM = 24;
/** Half the size of a dot's box. */
export const DOT_HALF = 7;
/** Minimum horizontal distance between two text labels. */
export const BAND = 180;
/** A dot must clear this much before it becomes text again. */
export const BAND_ENTER = 196;
/** Clear space around a text label. */
export const PAD = 6;
/** Clear space a dot must keep from a text label, or it is dropped. */
export const DOT_GAP = 3;
/** Text labels stay this far inside the viewport. */
export const EDGE = 12;
/** Most a label's stem may grow to clear a pin under its body, in CSS px. */
export const MAX_STEM_EXTRA = 44;
/** A slid pin keeps this far inside its landmark's visible box. */
export const SLIDE_IN = 6;
/** An off-centre plaque keeps at least this much of itself on each side of its stem. */
export const SHIFT_KEEP = 12;
/** A slid pin floats this far over its landmark's top, as scene.ts's MARKER_LIFT_PX does. */
export const LIFT = 14;

export interface LabelMarker {
  x: number;
  y: number;
  visible: boolean;
  proximity: number;
  /** The landmark's visible box on screen, CSS px, not clipped to the frame. NaN or absent: none. */
  rl?: number;
  rt?: number;
  rr?: number;
  rb?: number;
}

export class LabelLayout {
  readonly n: number;
  /** Output, per slot: HIDDEN, DOT or TEXT. Holds last frame's result until run() is called. */
  readonly mode: Uint8Array;
  /** Output, per slot: extra stem length in CSS px for a TEXT label (rule 4). */
  readonly stem: Float32Array;
  /** Output, per slot: where the pin goes (TEXT and DOT), CSS px. The marker's x/y, or slid into its landmark. */
  readonly px: Float32Array;
  readonly py: Float32Array;
  /** Output, per slot: the plaque's offset from its stem, CSS px (0 = centred). */
  readonly shift: Float32Array;
  /** Cached label sizes per slot, in CSS px. Filled outside the frame loop. */
  readonly width: Float32Array;
  readonly height: Float32Array;

  private readonly order: Int16Array;
  /** This frame's markers by slot, for rule 4. */
  private cur: ReadonlyArray<LabelMarker | null> = [];
  /**
   * Placed boxes, 4 floats each (l, t, r, b), plus a flag saying whether each
   * is text. A text label is three: its body, its stem and its pin.
   */
  private readonly boxes: Float32Array;
  private readonly boxIsText: Uint8Array;
  private boxCount = 0;
  private readonly textX: Float32Array;
  private textCount = 0;
  private readonly reserved: Float32Array;
  private reservedCount = 0;
  /** slide()'s result. */
  private sx = 0;
  private sy = 0;
  private sShift = 0;

  constructor(n: number, maxReserved = 8) {
    this.n = n;
    this.mode = new Uint8Array(n);
    this.stem = new Float32Array(n);
    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
    this.shift = new Float32Array(n);
    this.width = new Float32Array(n).fill(120);
    this.height = new Float32Array(n).fill(30);
    this.order = new Int16Array(n);
    this.boxes = new Float32Array(n * 3 * 4);
    this.boxIsText = new Uint8Array(n * 3);
    this.textX = new Float32Array(n);
    this.reserved = new Float32Array(maxReserved * 4);
  }

  /** Replace the reserved rects (screen areas labels must stay out of). */
  clearReserved(): void {
    this.reservedCount = 0;
  }

  addReserved(l: number, t: number, r: number, b: number): void {
    if (this.reservedCount * 4 >= this.reserved.length) return;
    const o = this.reservedCount * 4;
    this.reserved[o] = l;
    this.reserved[o + 1] = t;
    this.reserved[o + 2] = r;
    this.reserved[o + 3] = b;
    this.reservedCount++;
  }

  /**
   * Lay out one frame.
   * @param bySlot  marker for each slot (area index), or null when the scene has none
   * @param first   slot that always goes first (the current area), or -1
   * @param viewW   viewport width in CSS px
   * @param viewH   viewport height in CSS px
   * @param second  slot that goes next (the place under the pointer), or -1
   */
  run(bySlot: ReadonlyArray<LabelMarker | null>, first: number, viewW: number, viewH: number, second = -1): void {
    const n = this.n;
    let m = 0;
    for (let k = 0; k < n; k++) if (k !== first && k !== second) this.order[m++] = k;
    // Insertion sort by proximity, nearest first. n is 8.
    for (let i = 1; i < m; i++) {
      const k = this.order[i];
      const pk = bySlot[k]?.proximity ?? -1;
      let j = i - 1;
      while (j >= 0 && (bySlot[this.order[j]]?.proximity ?? -1) < pk) {
        this.order[j + 1] = this.order[j];
        j--;
      }
      this.order[j + 1] = k;
    }

    this.boxCount = 0;
    this.textCount = 0;
    this.cur = bySlot;
    if (first >= 0 && first < n) this.place(first, bySlot[first], viewW, viewH);
    if (second >= 0 && second < n && second !== first) this.place(second, bySlot[second], viewW, viewH);
    for (let i = 0; i < m; i++) {
      const k = this.order[i];
      this.place(k, bySlot[k], viewW, viewH);
    }
  }

  private place(k: number, mk: LabelMarker | null | undefined, viewW: number, viewH: number): void {
    const prev = this.mode[k];
    if (!mk || !mk.visible) {
      this.mode[k] = HIDDEN;
      return;
    }
    const w = this.width[k];
    const h = this.height[k];

    // The pin: the marker's own anchor while it is in the frame and its label
    // fits there, otherwise slid into the landmark's visible part.
    let x = mk.x;
    let y = mk.y;
    let shift = 0;
    const inFrame = x >= 0 && x <= viewW && y >= 0 && y <= viewH;
    if (!inFrame || !this.fits(x, y, 0, w, h, viewW)) {
      if (this.slide(mk, w, h, viewW, viewH)) {
        x = this.sx;
        y = this.sy;
        shift = this.sShift;
      } else if (!inFrame) {
        this.mode[k] = HIDDEN;
        return;
      }
    }
    this.px[k] = x;
    this.py[k] = y;
    this.shift[k] = shift;

    // Text candidate: label box above the stem, joined down to the pin.
    const cx = x + shift;
    const l = cx - w / 2;
    const r = cx + w / 2;
    const extra = this.stemToClear(k, x, y, l, r, h);
    const t = y - STEM - extra - h;
    const b = y + DOT_HALF;
    let ok = l >= EDGE && r <= viewW - EDGE && t >= EDGE;
    if (ok) ok = !this.hitsReserved(l, t, r, b);
    if (ok) {
      const band = prev === TEXT ? BAND : BAND_ENTER;
      for (let i = 0; i < this.textCount; i++) {
        if (Math.abs(this.textX[i] - cx) < band) { ok = false; break; }
      }
    }
    if (ok) {
      for (let i = 0; i < this.boxCount; i++) {
        const o = i * 4;
        if (l - PAD < this.boxes[o + 2] && r + PAD > this.boxes[o] && t - PAD < this.boxes[o + 3] && b + PAD > this.boxes[o + 1]) {
          ok = false;
          break;
        }
      }
    }
    if (ok) {
      this.push(l, t, r, t + h, true);
      this.push(x - 2, t + h, x + 2, y - DOT_HALF, true);
      this.push(x - DOT_HALF, y - DOT_HALF, x + DOT_HALF, y + DOT_HALF, true);
      this.textX[this.textCount++] = cx;
      this.stem[k] = extra;
      this.mode[k] = TEXT;
      return;
    }

    // Dot. Dropped where it would touch a text label or sit under the chrome.
    this.shift[k] = 0;
    if (this.hitsReservedPoint(x, y)) {
      this.mode[k] = HIDDEN;
      return;
    }
    const dl = x - DOT_HALF;
    const dt = y - DOT_HALF;
    const dr = x + DOT_HALF;
    const db = y + DOT_HALF;
    for (let i = 0; i < this.boxCount; i++) {
      if (!this.boxIsText[i]) continue;
      const o = i * 4;
      if (dl - DOT_GAP < this.boxes[o + 2] && dr + DOT_GAP > this.boxes[o] && dt - DOT_GAP < this.boxes[o + 3] && db + DOT_GAP > this.boxes[o + 1]) {
        this.mode[k] = HIDDEN;
        return;
      }
    }
    this.push(dl, dt, dr, db, false);
    this.mode[k] = DOT;
  }

  /** Would a centred-or-shifted label on a pin at (x, y) sit inside the frame and clear of the chrome? */
  private fits(x: number, y: number, shift: number, w: number, h: number, viewW: number): boolean {
    const l = x + shift - w / 2;
    const r = l + w;
    const t = y - STEM - h;
    return l >= EDGE && r <= viewW - EDGE && t >= EDGE && !this.hitsReserved(l, t, r, y + DOT_HALF);
  }

  /**
   * Slide the pin into the landmark's visible box: sideways to stay in the
   * frame (the plaque may sit off centre), down until its label clears the
   * header and the top edge. False when the landmark has no box, too little
   * of it is in the frame, or the pin would have to leave it. Result in
   * sx, sy, sShift.
   */
  private slide(mk: LabelMarker, w: number, h: number, viewW: number, viewH: number): boolean {
    const rl = mk.rl ?? NaN;
    const rr = mk.rr ?? NaN;
    const rt = mk.rt ?? NaN;
    const rb = mk.rb ?? NaN;
    if (!(rl < rr) || !(rt < rb)) return false;
    const vl = Math.max(rl, 0);
    const vr = Math.min(rr, viewW);
    const vt = Math.max(rt, 0);
    const vb = Math.min(rb, viewH);
    if (vr - vl < 2 * SLIDE_IN || vb - vt < 2 * SLIDE_IN) return false;
    // Sideways: the marker's x held inside the visible box and the frame.
    let x = Math.min(Math.max(mk.x, vl + SLIDE_IN), vr - SLIDE_IN);
    const cx = Math.min(Math.max(x, EDGE + w / 2), viewW - EDGE - w / 2);
    // The stem must meet the plaque: pull the pin toward the plaque's middle,
    // as long as it stays on the landmark.
    const reach = w / 2 - SHIFT_KEEP;
    x = Math.min(Math.max(x, cx - reach), cx + reach);
    if (x < vl + SLIDE_IN - 0.5 || x > vr - SLIDE_IN + 0.5) return false;
    const shift = cx - x;
    // Down: below the chrome at the top of the frame that the plaque would touch.
    const l = cx - w / 2;
    const r = cx + w / 2;
    let top = EDGE;
    for (let i = 0; i < this.reservedCount; i++) {
      const o = i * 4;
      const rT = this.reserved[o + 1];
      const rB = this.reserved[o + 3];
      if ((rT + rB) / 2 > viewH / 2) continue;
      if (l - PAD < this.reserved[o + 2] && r + PAD > this.reserved[o] && rB > top) top = rB;
    }
    // No higher than the landmark's own top allows (its samples, lifted), no
    // higher than the label needs; still on the landmark.
    const y = Math.max(mk.y, top + PAD + h + STEM, Math.min(rt - LIFT, vb - SLIDE_IN));
    if (y > vb - SLIDE_IN) return false;
    this.sx = x;
    this.sy = y;
    this.sShift = shift;
    return true;
  }

  /**
   * Rule 4: how much longer this label's stem must be for its body to clear
   * every other visible pin above its own. 0 when none is in the way, or
   * when clearing would take more than MAX_STEM_EXTRA.
   */
  private stemToClear(k: number, x: number, y: number, l: number, r: number, h: number): number {
    let extra = 0;
    for (let pass = 0; pass < 2; pass++) {
      let moved = false;
      for (let j = 0; j < this.n; j++) {
        const mj = this.cur[j];
        if (j === k || !mj || !mj.visible || mj.y >= y) continue;
        if (mj.x + DOT_HALF + DOT_GAP <= l || mj.x - DOT_HALF - DOT_GAP >= r) continue;
        const bodyB = y - STEM - extra;
        const bodyT = bodyB - h;
        const dotT = mj.y - DOT_HALF - DOT_GAP;
        const dotB = mj.y + DOT_HALF + DOT_GAP;
        if (dotB <= bodyT || dotT >= bodyB) continue;
        extra += bodyB - dotT;
        moved = true;
      }
      if (!moved) break;
    }
    return extra <= MAX_STEM_EXTRA ? Math.ceil(extra) : 0;
  }

  private push(l: number, t: number, r: number, b: number, text: boolean): void {
    const o = this.boxCount * 4;
    this.boxes[o] = l;
    this.boxes[o + 1] = t;
    this.boxes[o + 2] = r;
    this.boxes[o + 3] = b;
    this.boxIsText[this.boxCount] = text ? 1 : 0;
    this.boxCount++;
  }

  private hitsReserved(l: number, t: number, r: number, b: number): boolean {
    for (let i = 0; i < this.reservedCount; i++) {
      const o = i * 4;
      if (l < this.reserved[o + 2] && r > this.reserved[o] && t < this.reserved[o + 3] && b > this.reserved[o + 1]) return true;
    }
    return false;
  }

  private hitsReservedPoint(x: number, y: number): boolean {
    for (let i = 0; i < this.reservedCount; i++) {
      const o = i * 4;
      if (x > this.reserved[o] && x < this.reserved[o + 2] && y > this.reserved[o + 1] && y < this.reserved[o + 3]) return true;
    }
    return false;
  }
}
