# Design brief — /admin/etfb (Brand Owners)

**Date:** 2026-09-14
**Status:** Confirmed by Lovro 2026-09-14 and **built the same day**. Two claims in
§3 were wrong and are corrected in place below (see *Corrections from the build*).
**Design context:** `.impeccable.md` → admin face (light `.admin-shell`), plus the
primitives and rules in `src/components/admin/ui.tsx`.
**Background:** `system-docs/etfb_access_audit_2026-09-10.md` (why this page exists,
and why attribution is the hard part).

---

## 1. Feature summary

`/admin/etfb` shows every EcomTalent for Brands owner, the free team link minted for
them, and the people who redeemed it. When an owner stops paying, their people are
still sitting in the ETfB Discord and course, and someone has to take that access away.

Lovro is the user. In his own words, the job the page does is:

> "connect and confirm which brand owners don't have a subscription and which I have
> to remove the link from."

The removal itself happens in Whop, one membership page at a time. That is not a gap
to be closed — it is the design constraint. **This page's product is a confirmed,
trustworthy list, not a bulk action.**

## 2. Primary user action

**Confirm that a given non-paying owner really is non-paying and that this link really
is theirs — then close the link and carry their people's IDs into Whop.**

Note what the primary action is *not*. It is not "remove people." The app never removes
anyone. Designing it as a removal queue (the obvious read) optimizes the wrong verb and
overstates what the app did.

## 3. Design direction

Admin face: light `.admin-shell`, warm cream canvas, white cards, hairline borders,
text hierarchy via opacity, pearl accent. Linear/Vercel operational density. **No
student-side vocabulary** — no parchment, no Cormorant italic, no gold.

The feeling to aim for is **a reference document you can act from**, not a dashboard.
The closest analogue is a well-set audit report: the evidence is the content, the
actions are quiet, and nothing decorative competes with the reading.

Two rules from `ui.tsx` carry most of the weight here:

- **Color is signal, not decoration.** Currently violated — every cancelled row has a
  red `danger` button, so six reds on screen mean nothing. Red must be reserved for the
  one genuinely dangerous condition (§5, *untrustworthy*).
- **Use the radius token, not a number.** The cards hard-coded `borderRadius: 8`.
  They now use `var(--radius-card)`.

## 4. Layout strategy

### The single biggest change: promote the trust state to the top

`snap.unresolvedPlans` means plans could not be read from Whop, and the page already
says what that implies:

> "Some owners may be shown as cancelled when they are not — do not act on this page
> until this reads zero."

That is the most consequential sentence on the page and it currently renders **below**
every action button, in a "Needs attention" section at the bottom. Someone can close a
paying customer's link and start pulling their staff out of Discord without ever
scrolling to it.

**Move it above the work, and disable the actions while it is non-zero.** A warning that
appears after the mistake is available is decoration. This is the one place red belongs.

### Second: one work list, not three co-equal groups

Of the three groups, only **Cancelled** is work. *Cancelling* is explicitly "nothing to
do yet" and *Active* is "nothing to do" — together they are two of three stat tiles and
most of the page's vertical space, for zero actions.

- The page opens directly on Cancelled.
- Cancelling and Active move below a divider, collapsed, as reference.
- The header states the job in one line, not three tiles: **"6 owners to clear · 9 people
  to remove in Whop."**

### Third: delete the accordion

Confirmed volume is **small and steady** — under ~10 cancelled owners, 1-5 people each.
That is roughly 12 rows. It fits on one screen.

Progressive disclosure is the right instinct at 200 rows and pure friction at 12. Today
every owner is collapsed by default, so the people you need — and the evidence you are
meant to be confirming — are one click away and invisible. In the reference screenshot,
five of six owners are closed and only one person's ID is on screen.

**Show the cancelled group fully expanded.** Keep the collapse control for the reference
groups, where volume is genuinely larger.

### Fourth: the evidence is the content, so set it like content

The attribution line — `link labelled rdsmith · owner identified by Whop username in
the label` — is exactly what Lovro means by "connect and confirm." It is currently 11px
tertiary meta, buried inside a collapsed panel, on the same line as the owner's email.

It should be a legible, deliberate line in the card. The existing `HOW_MATCHED` copy is
already good plain English; it just needs to be visible.

### Card anatomy, in reading order

```
Ray Smith                                          [ Close link ]
rdsmith032@gmail.com

  Link "rdsmith" · matched by Whop username · 2 people

  ☐  basti8475@gmail.com     mem_EmDVRg35L0aNGc   joined 10 Jul   [Open in Whop] [Keep]
  ☐  rdsmith032@gmail.com    mem_fS6onoLPCNSCot   joined 10 Jul   [Open in Whop] [Keep]
                                                  @iwillberich
```

## 5. Key states

| State | What it must convey |
|---|---|
| **Loading (first read)** | Reading live from Whop. Existing behaviour is fine. |
| **`no_data`** | The link table is empty, so nothing here can be trusted. Already handled correctly and must stay distinct from "no work". |
| **`error`** | The Whop read failed. Explicit, never an empty list — an empty list reads as an all-clear and hides people who should have lost access. Already correct; keep the reasoning note. |
| **Untrustworthy (`unresolvedPlans > 0`)** | **New treatment.** Data loaded but is partially wrong. Banner above the work, actions disabled, red. Today this is a footnote at the bottom. |
| **Work to do** | The default. Cancelled group open, sorted by most people first; owners with nobody on their link sink to the bottom. |
| **No work** | "Nothing to remove." Must read as *success and freshly verified*, not as a failed load. Show the read timestamp here specifically — that is what makes an empty list believable. |
| **Owner unconfirmed** (`attributionConfidence === "confirm"`) | "I am not certain this link is theirs." Must visibly hold the card back, not just add a pill next to a live action button. This is the state that precedes removing a paying customer's staff. |
| **Link already closed** | Persistent on the card: `Link closed · 2 people still to remove in Whop`. Not a toast. |
| **No link yet** (active owners) | "No link yet" + Create link. Reference group. |
| **Person marked done** | Struck through, dimmed, stays visible until a refresh confirms they are gone from Whop. |
| **Kept** | Deliberately left alone, with Undo. Existing section is fine; move it under the reference divider. |
| **Protected seats** | Currently a run-on meta sentence joined by `·`. Should be a short labelled list — it explains why someone you expected is missing. |

## 6. Interaction model

**The Whop round-trip is the core loop, and it is the thing to optimize.** Confirmed:
Lovro opens each membership's page in Whop individually.

1. **Each person's row links straight to their membership page in Whop** (new tab).
   This removes the whole copy → alt-tab → search → paste cycle, which is the single
   largest cost in the current flow and happens once per person.
   *Blocked on one unknown — see §9.* Until confirmed, keep Copy ID and add
   **Copy all IDs** per owner as the fallback.
2. **A done checkbox per person.** Local, optimistic, no server write — the app still
   changes nothing. It exists so that when he comes back from Whop he can see where he
   got to. Cleared on refresh when the person is genuinely gone. At this volume that is
   all the progress tracking needed.
3. **Close link** stays where it is but loses the red. Its result becomes card state.
4. **Refresh** stays visible with the "last read" timestamp. Correct here, and now
   documented as an explicit admin-side exception to the student-side ban.
5. **Toasts** shrink back to transient confirmations only. Anything that describes
   ongoing state — "they still have access until cancelled in Whop" — belongs on the card.

Motion: essentially none. Ease-out-quart on the disclosure of the reference groups, and
nothing else. This is a document.

## 7. Content requirements

Keep the plain-English voice already in the file — `HOW_MATCHED`, the error reasoning,
"nobody on their link" — it is the best thing about the current page. Changes:

- **Header:** `6 owners to clear · 9 people to remove in Whop` (replaces three stat tiles).
- **Untrustworthy banner:** `3 plans could not be read from Whop. Some owners may show as
  cancelled when they are not. Actions are off until this clears.`
- **Empty:** `Nothing to remove.` + `Read live from Whop at 18:11.`
- **Card evidence line:** `Link "rdsmith" · matched by Whop username · 2 people`
- **Unconfirmed:** `Not sure this link is theirs — matched on name only.` + `Confirm this is right`
- **Closed:** `Link closed · 2 people still to remove in Whop`
- **Identity:** one consistent format — name, falling back to email, falling back to Whop
  user id. The raw `internal_notes` label ("b", "Aaronkim") moves into the evidence line
  where it belongs as evidence, and stops appearing as a card title.

## 8. Recommended references

- `reference/spatial-design.md` — card rhythm and the reference-group divider
- `reference/ux-writing.md` — the banner, the empty state, the unconfirmed copy
- `reference/interaction-design.md` — optimistic done-state, disabled-action patterns
- `reference/color-and-contrast.md` — re-scoping red to the one state that earns it
- Not motion-design.md. This page should barely move.

## 9. Open questions

1. **The Whop membership URL pattern. DO NOT GUESS THIS. It has already shipped broken
   once.** Commit `21f3659` (2026-09-11) removed a "Find in Whop" button that 404'd —
   Lovro hit it within a minute of opening the page. Its URL,
   `https://whop.com/dashboard/<biz_id>/members?query=<email>`, was invented. That
   commit's own message is the rule: *"every API call in this build was checked against
   live Whop, and then a dashboard path was invented from nothing."*

   So **Copy ID is not a fallback — it is the earned resolution of a real bug**, and it
   carries a second reason beyond the 404: a membership id is the unambiguous handle for
   the exact access being cancelled, whereas searching by email can resolve to a
   different, still-paying subscription for the same person. On this page a wrong link
   is worse than an extra paste.

   The deep link only goes in when a real URL is pasted from a browser sitting on a
   membership page, confirmed to contain the `mem_` id, and clicked once to verify. Not
   from docs, not from search, not from the API shape. Until then §6.1 stays as
   Copy ID + Copy all N IDs, which is what shipped.
2. **Does "Keep" expire?** Kept seats are excluded indefinitely. If an owner later
   re-subscribes and cancels again, a stale Keep silently protects someone. Probably fine
   at this volume, but it is an unexamined decision.
3. **The 204.** The audit's archived $0 ETfB plan holds 204 seats, 188 never paid. Lovro
   scoped this page as "small and steady," so this brief does **not** design for that
   population. If it ever lands here, revisit — the no-accordion, no-bulk decisions
   above are volume-dependent and would flip.

---

## Blast radius

Everything in this brief is presentational or client-local. No new writes to Whop, no
change to the archive endpoint, no removal capability. **No gate.**

The moment an in-app remove/revoke button is added, this crosses the line (changes real
data; a wrong click removes a paying customer's staff) and needs `/prd` → `/ship`. Lovro
has said that is not the plan.


---

## Corrections from the build

Two things in this brief were wrong. Recorded rather than quietly edited.

1. **"One radius: 10" is not true.** That line comes from the header comment in
   `ui.tsx`, which is stale. The real tokens in `globals.css` are `--radius-chip: 8`,
   `--radius-control: 12`, `--radius-card: 16`, `--radius-sheet: 20`. `.impeccable.md`
   says tokens are canonical, so the cards now use `var(--radius-card)` and the brief's
   original claim is withdrawn. The `ui.tsx` comment should be fixed separately.

2. **Disabled buttons had no disabled state.** The brief assumed it could turn actions
   off during the untrustworthy state. `buttonStyle()` ignored `disabled` entirely, so a
   dead button looked identical to a live one — which would have made the safety gate
   invisible and worse than nothing. `buttonStyle()` now takes `disabled` and renders
   0.4 opacity with `cursor: not-allowed`. This affects every admin page, for the better.

## What shipped

- Trust banner promoted above the work; every action disabled while
  `unresolvedPlans > 0`.
- Accordion deleted for the cancelled group; cards render fully open, sorted by most
  people first.
- Cancelling / Active / Kept / unrecorded links collapsed into one **Reference** section
  below a divider.
- Three stat tiles replaced by one header line plus a "read live at HH:MM" timestamp.
- Attribution evidence promoted from 11px tertiary meta to card content.
- Unconfirmed owners now **block** Close link until confirmed, with the reasoning stated
  on the card. Previously a pill sat next to a live button.
- Per-person done checkbox — local only, no server write, pruned on refresh once Whop
  confirms the person is gone.
- `Close link` demoted from `danger` to `subtle`; red now appears only in the banner.
- `protectedSeats` changed from a `·`-joined run-on to a labelled list.
- Toast switched to the shared `Toast` primitive (the black-on-black bug) and
  `role="status"` added to it for every admin page.

Still open: §9.1, the Whop membership URL. `Copy all N IDs` is in as the fallback.
