/**
 * Canonical motion constants — the single source of truth for easing
 * across the EcomTalent student platform.
 *
 * Per .impeccable.md:
 *   "Motion easing is always cubic-bezier(0.22, 1, 0.36, 1) (ease-out-quart).
 *    Never bounce or elastic."
 *
 * Three exports for the three engines we use:
 *   - SPEC_EASE          → array form for Framer Motion
 *   - SPEC_EASE_GSAP     → string form for GSAP (power3.out is the named alias)
 *   - SPEC_EASE_GSAP_INOUT → symmetric variant for in-out tweens
 *
 * If a new component needs an easing, import from here. Do NOT re-derive
 * the curve inline — that's how drift happens.
 */

export const SPEC_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

export const SPEC_EASE_GSAP = "power3.out";
export const SPEC_EASE_GSAP_INOUT = "power3.inOut";

// Mirror of SPEC_EASE_GSAP for fade-OUT / exit tweens — accelerates at
// the start so an element disappears decisively instead of lingering.
// Use sparingly; most exits should still feel like the same family curve.
export const SPEC_EASE_GSAP_IN = "power3.in";
