# EcomTalent for Brands — access audit + build discovery

**Date:** 2026-09-10
**Status:** DISCOVERY COMPLETE. Read-only. No code written, no Whop writes performed.
**Method:** 43-agent read-only probe of the live Whop API + this codebase, every load-bearing
claim independently re-run by an adversarial verifier instructed to refute it.
**Supersedes:** `whop_plan_inventory_2026-09-03.md` (its counts are wrong — see §7).

The goal: a surface in this app that hands Astrid an evidence-backed list of who to remove
from the ETfB Discord and who to remove from the free course.

---

## 1. The single most important finding

**There is not one leak. There are two, on two different products, with two different
populations. They must never share a query.**

Whop experiences, verified bidirectionally from both the product and experience records:

| Experience | Grants | Attached to products | On cancel |
|---|---|---|---|
| `exp_PPBg8keyB337uf` "Learn" | the course | ETfB **+ Apex** | — |
| `exp_hKZwYaNAPDLxqw` "Discord Community" | the ETfB Discord | **ETfB only** | `removerole` |
| `exp_5FZOsv1LpnBAgH` (course Discord) | course Discord | course product | `kickuser` |

So:

- **The Discord leak lives on the ETfB product.** Specifically on `plan_9K9arfzHhdwFg`, an
  archived $0 ETfB plan holding **204 valid memberships, 188 of whom have never paid
  anything**. Because the plan sits on the ETfB *product*, every one of those 204 carries
  Discord entitlement.
- **The free-course leak lives on Apex** (`prod_vCHZUO8dU4ts2`), which grants "Learn" and
  **no Discord at all**.

The team's mental model — "team members get the course, not the Discord" — is correct for
Apex. But it does not describe the 204, which are a separate, older, Discord-carrying
population nobody was tracking.

---

## 2. Verified numbers (live, 2026-09-10)

### ETfB product `prod_bGNf1u02RruKC` — 444 memberships, 262 valid

| Cohort | Count | Where |
|---|---|---|
| Paid / active owners | **58** | 42 on `plan_uSpqAhp2cSeyy`, 7 on `plan_mMFeOEScXw1WQ`, 9 singles on per-owner waitlist plans |
| Free, never paid | **204** | all on `plan_9K9arfzHhdwFg` (archived $0) — 188 never paid a cent |
| Already terminated on that free plan | 9 of 213 | proves explicit termination works and is the ONLY mechanism |

Lovro's "~40 paying" estimate was the closest of his figures to reality (real: 58).

### Apex `prod_vCHZUO8dU4ts2` — 588 memberships, 566 valid free-course seats

| Tier | Seats | Attribution confidence |
|---|---|---|
| One unnamed firehose link `plan_t4VXohAMYT669` | **383** (68%) | **NONE.** No note, no metadata, unlimited stock, created 2025-07-29, still taking redemptions — newest 2026-09-09 |
| 61 named per-owner links | 183 | partial |
| └ of those, owner resolvable AND owner's subscription confirmed dead | **37** across 13 owners | hard match |
| └ of those, roughly attributable but unverified | ~111 | needs a human pass |

**Never quote a single free-seat number. Quote the tiers.** Across the probes this population
was variously described as 566 / 193 / 183 / 133 / 111 / 37 — all of them are real numbers of
different things.

### Plans

181 total · 118 Apex · 42 ETfB · 154 of 181 carry an `internal_notes` value.

---

## 3. Attribution — what actually works

`internal_notes` is the **only** human-readable field on a Whop plan. `title` is null on all
181 plans; `metadata` is empty on all 181. It is exposed on both `/api/v1/plans` and
`/api/v2/plans`.

The chain **link → owner → owner's subscription → their team's seats** is provable end to end.
Worked example, verified live:

```
plan_Va4BldAvwhNiW  "Waitlist slimconvert2c"  ($997 ETfB)
  └ user_LDDwfn3g5Pqs3  damian@trynativebloom.com  active
plan_8HUsF795Qk9Ua  "Iskander - slimconvert2c"  ($0 Apex)
  └ 5 valid seats, one of which is that SAME user_LDDwfn3g5Pqs3
```

**But coverage is poor, and it is worst where the members are.** Of 118 Apex plans:

- 55 notes parse as `Name - username` (machine-joinable)
- 61 are a bare free-text name — "Leo", "Reda", "Teoh", "Ruben", "Ashish", "Alex Birch"
- 2 carry no note at all

The naming convention only hardened around **2026-07-13**. The seats are concentrated in the
older, less-attributable links: **140 seats pre-cutover vs 41 post.**

`internal_notes` values are also **not unique** — 148 distinct values across 154 populated
notes, with "Alex Birch" appearing on two different plans, plus duplicates of "App Access" and
one plan literally named `test`.

> **Design rule: `plan_id` is the join key. `internal_notes` is a display label only.**
> Keying owner identity on the note string will merge two different owners.

### What does NOT work for attribution

- **ETfB plan names.** 77% of ETfB memberships sit on two shared plans; 19 of the 33
  `Waitlist <username>` quick_link plans have zero memberships. `plan_id` on ETfB is a
  product-tier key, not a per-owner key.
- **Custom fields.** Only 1 of 181 plans has any (the $1,500 strategy call).
- **`member_count`.** Exists on v1 plans, absent on v2, and it **lags** (564 summed vs 566
  live). Enumerate memberships; never read the counter.

### An untested path worth one dashboard toggle

`/api/v5/company/memberships` returns **200** with this key and exposes `checkout_id`,
populated on 383/383 of the firehose redemptions. `/api/v2/checkout_sessions` **exists** but is
permission-blocked. It may be a dead end (`checkout_id` looks per-membership, not per-link),
but it is the only untried route to the 68%.

---

## 4. Discord

**Whop records entitlement. It never records guild presence.** Nothing in the API exposes a
Discord server ID at any route this key can reach.

Entitlement fails in **both** directions:
- ETfB's cancel action is `removerole`, not `kickuser` — a perfectly-firing cancellation
  leaves the person sitting in the server with no role.
- Anyone can join by plain invite with no membership at all. (Lovro has confirmed this
  happened: manual adds, plus editors who were historically given the ETfB role.)

**Discord-ID coverage on valid ETfB memberships is 66.8%, not the 86% I quoted earlier**
(175 of 262). Split: paid cohort 54/58 (93%), free cohort 121/204 (59%). **Four of the 58
currently-active payers have no linked Discord account at all.**

> **Design rule: a missing Discord ID is UNKNOWN and routes to a human. It is never evidence.**
> An "in the guild but not in the valid Whop set" rule false-positives on paying customers.

The guild roster must come from Discord itself. This codebase has never read one —
`src/lib/discord.ts` can only *send* (webhook post + bot DM). Reading a member list needs a bot
in the guild with the **SERVER MEMBERS privileged intent** enabled in the Discord developer
portal, then `GET /guilds/{id}/members?limit=1000`.

---

## 5. Whop API traps — every one verified, every one fails silently

These are the reason a wrong kick list would look exactly like a right one.

| Trap | Verified behaviour |
|---|---|
| **Invalid filter is silently ignored** | `?product_id=prod_ZZZZZZZZZZZZZ` returns `total_count: 8188` — the entire account — with a plausible pagination block and HTTP 200. Also fires on a trailing-space id (`prod_bGNf1u02RruKC%20`). |
| **`per_page` is not the param** | `per_page=50` → 10 rows, `total_page 45`. `per=50` → 50 rows, `total_page 9`. `per=100` is capped to 50. |
| **v1 plans paging** | `limit=100` silently returns 20. The working param is `first=100`. |
| **401 has two meanings** | Generic *"does not have permission to access this route"* = route does not exist (a nonsense control URL returns it verbatim). Named *"...the list_checkout_sessions endpoint... enable permissions"* = route exists, scope-blocked. |

> **Design rule: every filtered Whop call must assert (a) all returned rows carry the requested
> id, and (b) `total_count` != the unfiltered account total, before its result is used.**

---

## 6. Pre-existing production bugs found (independent of this build)

**6a. The 2-hourly sync is blind to most of the account.**
`src/lib/whop-members.ts:194` builds the URL with `per_page=`, which Whop ignores → 10 rows per
page. Against `maxPages = 500` that is a hard **5,000-row ceiling on 8,188 memberships**,
newest-first, with no error. Anything the sync "knows" about memberships older than roughly
**2025-11-13 is nothing.** Same failure class as the v75.25 PostgREST row-cap incidents.

**6b. `WHOP_PRODUCT_ID` holds two PLAN ids, not product ids.**
Locally at least. Whop silently ignores a non-product value in `product_id` and returns all
8,188 memberships (trap #1 above), so the `students` table may already be a partial
company-wide mirror. **Unverified in Vercel production — must be checked.**

**6c. The v75.59 upsert tripwire has a hole.** It uses `Object.keys`, which counts a key whose
value is `undefined` — but `JSON.stringify` then drops that key from the request body. A row
can pass the tripwire and still omit a column, which is exactly the shape of the 2026-06-11
incident that NULLed 638 `first_paid_at` values.

**6d. Webhook layer.** No raw-payload table exists in 40 tables. No `cancel_at_period_end`
event is handled. No webhook-id dedupe and no timestamp-freshness check, so a captured request
replays forever. And the flat `plan_id` field three handlers read **matches no live Whop
membership shape** (v2 uses nested `plan`, v5 uses flat `plan_id` with flat `user_id`, v1 uses
nested `plan{id}` + nested `user{id}`) — evidence it was never transcribed from a real payload.

**6e. `PAYING_WHOP_PLAN_IDS`** holds 2 plan ids against 46 paid plans on the account, and
fails with only a `console.warn`.

---

## 7. `whop_plan_inventory_2026-09-03.md` is wrong

It reports 167 plans / 110 Apex / 36 ETfB. Live truth is **181 / 118 / 42**. Zero plans have
been created since 2026-09-03, so this is enumeration error, not growth — its documented
pagination recipe used `limit=100`, which is silently ignored and returns 20. **Do not cite
that doc in a PRD without re-running its numbers.**

---

## 8. Non-negotiable design constraints

1. **Two leaks, two objects, two kick lists, two approval flows.** Never one query.
2. **Key on "holds ANY valid ETfB membership", never on product membership alone.** 25 of the
   566 valid Apex seat-holders also hold a valid ETfB membership, several paying $997/month.
3. **Identify team links by `product_id == prod_vCHZUO8dU4ts2`, never by `visibility ==
   'hidden'`.** 11 hidden plans belong to other products and **five of those are paid**
   ($997/30d, $697/30d, $970/yr, $97/30d, $1/30d). Filtering on visibility puts paying
   customers on the kick list.
4. **Three confidence tiers, rendered distinctly. Never a single number.**
5. **Manual owner assignment is a first-class workflow, not an error state.** Only ~23% of free
   seats are machine-attributable. If hand-assignment is an afterthought, the tool solves the
   small half.
6. **New tables keyed on `whop_user_id` (text). Do NOT write these people into `students`.**
   That table is UNIQUE on `whop_user_id`, collapses a dual-product person into one row via an
   access/recency tiebreak, and every admin surface filters it by a join-date cutoff and the
   2-plan paying allowlist. 15 users already hold memberships on both products.
7. **The reconciliation sync is the authoritative spine; the webhook is at most a latency
   accelerator.** No row is marked "safe to remove" on webhook state alone (see 6d).
8. **Every row carries its evidence and its confidence tier inline; every tile renders
   ok / no_data / error as distinct states** (the v86 `/admin/stats` discriminated-union
   pattern). A failed Whop lookup must never render as "0 remaining entitlements".
9. **Gate reads team-wide (`requireTeam`, no role list, matching `/admin/tasks`), writes on
   founder/admin.** Do NOT use an immutable-ID allowlist like `/admin/stats` — it would lock
   out the one person whose job this is. Confirm Astrid's role first.
10. **Stopping the source is a prerequisite, not a follow-up.** The firehose link took a
    redemption on 2026-09-09 and 8 new Apex links were created on 2026-09-03. A list generated
    against an open tap goes stale before Astrid finishes working it.

---

## 9. The riskiest assumption

**That the free-seat leak IS the owner→team-member chain.**

383 of 566 free-course seats sit on one unnamed link. A random sample of 9 of its redeemers
found **7 who hold that single membership and nothing else in the entire account** — no ETfB
subscription, no course purchase, no connection to any brand owner, consumer gmail addresses
(`mrbeastkiduniya48@`, `sanaross888@`, `munjunseak@`).

That does not look like brand owners forwarding a link to staff. It looks like a general-purpose
free-course link handed out broadly.

If that is what it is, the entire attribution effort addresses at most 183 seats — a third of
the population — and the decision about the other 383 is a business call, not an engineering
one. **Settle what that link is before writing the plan.**

---

## 10. Open items requiring Lovro

Blocking: what `plan_t4VXohAMYT669` is · whether ETfB and course Discord are the same server ·
what the 204 free ETfB seats were and whether to grandfather them · Astrid's `team_members` row
and role · `WHOP_PRODUCT_ID` in Vercel production.

Cheap unblocks: enable `list_webhooks` + `list_checkout_sessions` on the Whop API key (both
routes confirmed to exist and be scope-blocked, not absent).

Unverifiable read-only, settle under approval during the build: whether a plan can be
**created** via API, and whether `internal_notes` is **writable** via PATCH. Both are required
for the mint-the-link-in-app design.
