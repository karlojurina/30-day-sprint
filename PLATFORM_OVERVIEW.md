# EcomTalent Platform Overview

**For:** Karlo (founder, product decision-maker).
**Purpose:** Single source of truth describing what the platform does, holds, shows, and triggers. Use this as context when designing CSM message flows, KPI definitions, post-day-30 onboarding, the month-2 discount feedback survey, and anything else that sits on top of the existing surfaces.
**Last regenerated:** 2026-05-12. Re-export whenever the platform changes meaningfully.

> Note on terminology: in product conversations you call it "WAP" — in this doc and in the code it's written as **Whop** (the actual product name). They're the same thing.

---

## 1. Architecture in One Paragraph

EcomTalent is a Next.js web app (App Router, TypeScript, Tailwind v4) hosted on **Vercel**. Students log in through **Whop OAuth** (the "Sign in with Whop" button); team members (Karlo, Astrid) log in through a separate email/password form. Everything we own — students, lesson progress, daily notes, discount requests, alerts — lives in a **Supabase PostgreSQL** database with row-level security. We don't store anything sensitive about the Whop membership itself; Whop remains the source of truth for "is this person paying?" and "did they watch lesson X on Whop?" We talk to Whop in three ways: OAuth for login, webhooks for membership and lesson-completion events, and a server-side API key for the admin-only watch-progress sync and promo-code creation. Cron jobs run on Vercel on a daily schedule for engagement alerts and the day-28 summary DM. Discord webhooks deliver team alerts; a Discord bot (when token is present) DMs students. There is no mobile app, no native client — only the web.

---

## 2. Data Model

Every entity the platform stores, in plain English. This is what lets you design flows: if a CSM message needs to know "did this student skip the editing breakdowns?" — that fact has to live in one of these tables.

### 2.1 `students` — one row per Whop member who has logged into our app

| Field | What it means |
|---|---|
| `id` | Our internal student ID (UUID). Used everywhere we link a student to their data. |
| `whop_user_id` | **Authoritative.** The student's Whop user ID. Never changes. |
| `whop_membership_id` | The Whop membership record. Null briefly during signup. |
| `supabase_user_id` | Link to the auth user row (so they can log in). |
| `email`, `name`, `avatar_url` | Pulled from Whop at login. Read-only on our side — if they edit them on Whop, we don't auto-resync. |
| `discord_username` | Pulled from Whop at login (the `username` field). |
| `discord_user_id` | The Discord snowflake (e.g. `123456789012345678`). Looked up once at signup via `whop.com/api/v2/members/{id}` → `social_accounts`. Used by the day-28 DM bot. Best-effort: null if the student hasn't connected Discord. |
| `membership_status` | `active` / `canceled` / `past_due` / `expired`. Updated by Whop webhooks. This is what drives the "Churned" column in Kanban. |
| `joined_at` | The student's Whop **membership** join date (not their login date). Pulled from Whop at OAuth. Drives the day counter and Kanban column placement. (The 14-day discount window anchors on `first_paid_at`, not this — see note 6 below.) |
| `last_active_at` | Last time they hit the dashboard. Used for the "inactive 5d" alert and the Last Active column. |
| `current_streak` | Day-streak counter. |
| `whop_access_token`, `whop_refresh_token` | Their personal Whop OAuth tokens. Used by certain refresh flows. |
| `last_watch_sync_at` | When we last pulled their Whop watch progress. |
| `whop_last_sync_fetched_count` | How many lesson interactions Whop returned last time. |
| `whop_last_sync_matched_count` | How many of those matched a lesson in our DB. |
| `whop_last_sync_unmatched` | List of Whop lesson IDs we couldn't match (diagnostic — usually means we forgot to set `whop_lesson_id` on one of our lessons). |
| `whop_last_sync_error` | Last sync error message, if any. Shown on the student detail page. |
| `ad_submissions_verified` | **Manual gate.** Karlo or Astrid ticks this checkbox after confirming the student has submitted their action-item ads in Discord `#ad-review`. Must be `true` before a discount can be approved. |
| `ad_submissions_verified_at`, `ad_submissions_verified_by` | Audit trail for who ticked it and when. |
| `day28_dm_sent_at` | Timestamp the day-28 summary DM was sent. Null until sent; prevents duplicate sends. |
| `last_streak_milestone_shown`, `month_review_seen_at`, `celebrated_region_ids` | Flags so we don't replay celebrations on every page load. |

### 2.2 `regions` — the 4 phases of the 30-day sprint

| Field | What it means |
|---|---|
| `id` | `r1` / `r2` / `r3` / `r4`. |
| `order_num` | 1–4. |
| `title` | Region name (e.g. "Base Camp", "Creative Lab", "Test Track", "The Market"). |
| `theme_key` | Terrain theme used in the map visual (`shore`, `forest`, `mountains`, `city`). |
| `day_start`, `day_end` | Day range. R1=1–7, R2=8–15, R3=16–23, R4=24–30. |

### 2.3 `lessons` — the 57 lessons the student moves through

| Field | What it means |
|---|---|
| `id` | `l001`–`l059` (with some gaps where lessons were deleted in migrations). |
| `region_id` | Which region (R1–R4). |
| `day` | Absolute day 1–30. |
| `type` | `watch` (Whop video), `action` (do the thing), or `setup` (e.g. join Discord). |
| `title` | Display title. |
| `description` | Brief shown in the lesson sheet. |
| `duration_label` | Human runtime like "8 min", "1h 20m". |
| `whop_lesson_id` | The Whop course lesson ID. Drives the auto-sync — when the student watches it on Whop, we mark it complete on our side. Null for `action`/`setup` lessons and for two R3 lessons (l047, l048) that are still pending Karlo's URLs. |
| `is_gate` | True only for **l049** ("Action Item: Static Ads"). This is the discount unlock lesson. |
| `is_boss` | True only for the final reflection lesson in R4. Rendered as a crimson 8-point star on the map. |
| `requires_action` | True for 4 "compound" lessons (l018 Organic, l020 UGC, l022 VSL, l024 High-Prod). These need **both** the briefing watched AND an "I shipped the ad" confirmation to be marked complete. |
| `action_brief` | The action half of a compound lesson — the brief for the ad they have to ship. |
| `discord_channel` | Display hint like `#ad-review` shown inside the lesson sheet. |
| `lesson_group_id` | Currently only `editing_breakdowns` — a set of 9 R2 lessons that collapse into one node on the map. |
| `is_optional` | True for lessons the student can skip without being stuck. Currently l050, l051. The editing-breakdowns group is also effectively optional (per-part skip). |
| `sort_order` | Used to order multiple lessons on the same day. |

### 2.4 `student_lesson_completions` — student × lesson progress

One row per (student, lesson) the student has interacted with. Unique constraint on (student_id, lesson_id).

| Field | What it means |
|---|---|
| `student_id`, `lesson_id` | FKs. |
| `completed_at` | When the student watched the lesson (or marked an action/setup lesson done manually). |
| `action_completed_at` | For compound lessons only — when they ticked "I shipped the ad". A compound lesson counts as fully complete when **both** `completed_at` AND `action_completed_at` are set. |
| `skipped_at` | When the student deliberately skipped (only valid for `is_optional` lessons and editing-breakdowns parts). Skipping still counts toward path progression so the student can keep moving. |

### 2.5 `discount_requests` — the 30%-off application

| Field | What it means |
|---|---|
| `student_id` | FK. |
| `status` | `pending` / `approved` / `rejected`. |
| `promo_code` | Generated code like `ECOM30-ABC123` (first 6 chars of student ID, uppercased). Prefixed `MANUAL-` if Whop's API call failed and the team needs to create it by hand. |
| `whop_promo_id` | Whop's internal ID for the promo. Null if MANUAL fallback. |
| `reviewed_by`, `reviewed_at` | Audit. |
| `rejection_reason` | Optional free-text reason shown to the student. |
| `created_at` | When the student applied. |

### 2.6 `disengagement_alerts` — automated warnings for the team

| Field | What it means |
|---|---|
| `student_id` | FK. |
| `alert_type` | One of: `no_tasks_7d`, `no_activation_14d`, `no_login_5d`, `week2_no_start`, `no_lessons_3d`. |
| `message` | Human-readable text shown in the admin alerts list. |
| `is_dismissed`, `dismissed_by`, `dismissed_at` | Team can mark an alert as handled. |
| `created_at` | When the cron raised it. |

### 2.7 `daily_notes` and `lesson_notes`

- `daily_notes` — one row per (student, calendar date). The dashboard's daily-note input writes here. Used by the day-28 DM ("you wrote N notes").
- `lesson_notes` — one row per (student, lesson). Per-lesson scratchpad. Lighter usage.

### 2.8 `team_members`

| Field | What it means |
|---|---|
| `id` | FK to Supabase auth. |
| `email`, `full_name` | Display. |
| `role` | `founder` / `csm` / `admin`. Currently informational — there is no permission split between roles. Any team member can do anything. |

### 2.9 Other tables (lightly used, present in schema)

- `hidden_rewards`, `student_rewards` — loot-drop system. Built but not actively wired into the UI yet.
- `month_reviews` — frozen day-28 stats snapshot per student.

### 2.10 Relationships

```
team_members  (no relationships — separate auth namespace)

students  1 ── many ──▶  student_lesson_completions
students  1 ── many ──▶  daily_notes
students  1 ── many ──▶  lesson_notes
students  1 ── many ──▶  discount_requests
students  1 ── many ──▶  disengagement_alerts
students  1 ── many ──▶  student_rewards

regions   1 ── many ──▶  lessons
lessons   1 ── many ──▶  student_lesson_completions
```

---

## 3. Whop API Integration

What we sync, when, and who owns each piece of data.

### 3.1 What happens on login (the OAuth flow)

1. Student clicks **"Sign in with Whop"** on `/login`.
2. We redirect them to Whop's OAuth page with a PKCE challenge.
3. Student authorizes on Whop, gets redirected back to our `/api/auth/whop/callback` with an authorization code.
4. We exchange the code for an `access_token` + `refresh_token`.
5. We call Whop's `/oauth/userinfo` to get the basics: Whop user ID, name, email, avatar, username.
6. We call `/api/v1/me/has_access/{WHOP_PRODUCT_ID}` to confirm they have an active membership. If they don't, we redirect them to `/login?error=no_membership`. (There is an env-var bypass for whitelisted user IDs / emails — useful for testing accounts.)
7. We call `/api/v1/me/memberships` to find their **earliest joined-at for this product**. This becomes the authoritative `students.joined_at` and drives the day counter forever after.
8. We call `/api/v2/members/{whop_user_id}` with the admin API key to grab their Discord ID from `social_accounts`. Best-effort; if it fails we proceed with null.
9. We create (or look up) the matching Supabase auth user. The password is a deterministic HMAC of the Whop user ID — same student always gets the same password, and only our server can compute it.
10. We upsert the `students` row with all of the above plus their access/refresh tokens.
11. We kick off a watch-progress sync (see 3.3) with a 2.5-second timeout — non-blocking, just to backfill any lessons they already watched on Whop before this login.
12. We hand them a Supabase session and redirect to `/dashboard`.

### 3.2 Whop webhook events we listen for

Endpoint: `/api/webhooks/whop`. Signature verified via Standard Webhooks / Svix using `WHOP_WEBHOOK_SECRET`.

| Event | What we do |
|---|---|
| `membership.activated` / `membership.went_valid` | Set `membership_status = 'active'`. Upsert by `whop_user_id`. |
| `membership.deactivated` / `membership.went_invalid` | Set `membership_status = 'canceled'`. This is what moves a card to the "Churned" column. |
| `payment.succeeded` | Set `membership_status = 'active'`. Catches renewals. |
| `course_lesson_interaction.completed` | Match the Whop user → our student, match the Whop lesson ID → our lesson, insert a `student_lesson_completions` row with `completed_at = now()`. Idempotent. |

### 3.3 Watch-progress sync (the silent backfill)

Webhooks are great for "from now on," but they don't tell us what the student watched before they first logged in to our app. So we also actively pull:

- **When it fires:** at OAuth login (2.5s timeout, best-effort), on a manual "Sync now" button, and when the dashboard tab regains focus (throttled to once every 30 seconds).
- **What it does:** calls `/api/v1/course_lesson_interactions?course_id=...&user_id=...` with the **admin API key** (`WHOP_API_KEY`) and `course_analytics:read` scope. Student OAuth tokens are rejected for this endpoint — only the admin key works. We paginate up to 500 interactions and write `completed_at` for any matched lesson. We also "promote" lessons that were previously marked `skipped_at` if the student actually watched them.
- **Diagnostic fields:** every sync updates `whop_last_sync_fetched_count`, `whop_last_sync_matched_count`, `whop_last_sync_unmatched`, and `whop_last_sync_error` on the student row. These show on the student detail page.

### 3.4 Promo-code creation

When Karlo clicks **Approve** on a discount request, we generate a code and try to create it on Whop:

- **Code format:** `ECOM30-{first 6 chars of student UUID, uppercased}`. Example: `ECOM30-A3F9C2`.
- **Settings:** 30% off, percentage, USD, 1 month duration, one per customer, stock 1, not new-users-only.
- **Fallback:** if the Whop API call fails, we still mark the discount approved and store the code as `MANUAL-ECOM30-...`. Karlo or Astrid has to create that one by hand in the Whop dashboard.

### 3.5 What is authoritative on Whop's side vs. ours

| Field | Authoritative source |
|---|---|
| Is the student paying? | **Whop** (we react to webhooks; we never set membership status ourselves). |
| When did they join? | **Whop** (`joined_at` pulled at OAuth, never overwritten after that). |
| Email / name / avatar / Discord username | **Whop** at the moment of login; not re-synced. If they change it on Whop, our copy goes stale. |
| Did they watch lesson X on Whop? | **Whop** (we pull it via webhook + sync; we never overwrite). |
| Did they ship the action item / skip the optional lesson? | **Ours.** Whop doesn't know about these. |
| Streak, daily notes, discount request, alerts | **Ours.** |
| Promo codes | Both — we generate the code, Whop owns whether it's valid. |

### 3.6 Tokens

We store both the student's personal `whop_access_token` and `whop_refresh_token`. The refresh token is used when their access token expires; the manual "Sync now" path refreshes them. Most server-to-Whop calls use the app-level `WHOP_API_KEY` (Bearer), not the student's personal token — the personal token mostly exists for completeness.

---

## 4. Student-Facing Surface

Every screen the student sees, what they can do, and the gamification mechanics.

### 4.1 `/` (root)

Empty router. Auto-redirects: logged-in student → `/dashboard`, anyone else → `/login`. Shows a brief loading spinner.

### 4.2 `/login`

The OAuth entry point. Premium dark card on a black background.

| Element | What it is |
|---|---|
| Eyebrow | "EcomTalent · 30-Day Sprint" |
| Headline | "You're **in.** Let's go." ("in." is gold) |
| Body | "Sign in with Whop. Your 30 days start the moment you're in." |
| Primary button | "Sign in with Whop" — starts the OAuth flow. |
| Secondary link | "Team login →" — sends Karlo/Astrid to `/admin/login`. |
| Error banner | Appears if the URL has `?error=...`. Friendly copy for: no membership, session expired, security check failed, generic auth failure. |

### 4.3 `/auth/complete`

Silent pass-through after OAuth. Shows a "Signing you in…" spinner while it lifts the temporary session cookie into a persistent Supabase session, then redirects to `/dashboard`. The student never lingers here.

### 4.4 `/dashboard` — the expedition map (the core experience)

This is the whole product. A full-screen SVG canvas with regions laid out as terrain (shore → forest → mountains → city). Lessons appear as nodes on a path through each region.

#### 4.4.1 The map itself

- **Four regions, sequential, locked behind each other.** R1 always unlocked. R2 unlocks when R1 is 100% complete. R3 unlocks when R2 is 100% complete. R4 unlocks when R3 is 100% complete.
- **Lesson nodes.** Each lesson is a clickable shape:
  - **Circle** = watch-type lesson
  - **Diamond** = action-type lesson
  - **16-point gold star** = the discount-gate lesson (l049)
  - **8-point crimson star** = the boss / final reflection lesson (last lesson of R4)
- **Node colors.** Locked (faded dark navy), available (navy with teal/sky border), current (slightly larger, EcomTalent logo inside), completed (gold), gate-not-yet (semi-transparent gold), boss (deep crimson).
- **Grouped node — "Editing Breakdowns."** In R2, nine optional editing lessons (l032, l033, l035–l039, l041, l042) collapse into a single node titled "Editing Breakdowns." Clicking it opens a group sheet that lists all 9 parts; the student picks Watch or Skip per part. Both Watch and Skip count toward unlocking R3.
- **Zoom and pan.** Scroll wheel zooms. Drag pans. Double-click a region zooms in. There's a back-to-overview button.
- **Side panel** (when zoomed into a region). Shows region stats + an **Onward →** button. When the region is incomplete, the button is locked: clicking it shows a toast "**N lessons left to unlock Onward**." When complete, click jumps to the next region.

#### 4.4.2 The top-left stats widget

Always visible. Floats over the map. Contains:

| Element | What it shows |
|---|---|
| Avatar + greeting | "Hey {firstName}, welcome back" + sign-out (X) button |
| Overall progress bar | Gold filled bar with "{completed} / {total} lessons" |
| Current region | Roman numeral + name + "{X} of {Y} lessons" |
| Next lesson | Title + duration; clickable to open the lesson sheet |
| Streak | Flame icon + current day count; hover shows longest streak |
| Discount block | See 4.4.4 |

#### 4.4.3 Lesson sheet (modal that opens when you click a lesson)

Three layouts depending on the lesson type:

**A) Watch lesson.** Big play-card. "Watch on Whop · Opens in a new tab · auto-syncs when you come back." Click opens the Whop course lesson URL in a new tab. When the student tabs back to the map, a silent sync (throttled 30s) pulls completion from Whop. No "mark complete" button — it auto-completes.

**B) Action / setup lesson.** Big "Your mission" panel. Description. Discord channel hint if relevant (e.g. `#ad-review`). Gold "Mark complete" button (or "Undo completion" if already done).

**C) Compound lesson** (the 4 ad action items: l018 Organic, l020 UGC, l022 VSL, l024 High-Prod). Two numbered parts side-by-side:
  1. Watch the briefing (Whop link)
  2. Ship the ad (action brief + "Mark ad shipped" button)

Both must be done for the lesson to count.

**Special: the discount gate (l049)**. When the student opens l049 **and** they're eligible (R1+R2 done within 14 days of join, no existing request), the sheet shows a gold-tinted "Discount unlocked" panel with a big **"Apply for my 30% discount"** button. Clicking it creates a `discount_requests` row (status `pending`). After applying, the panel changes to show the current status ("Discount pending review · We'll review within 24 hours" / "Discount approved · [code] [Copy]" / "Discount rejected · {reason or DM the team in Discord}").

**Optional lessons.** If a lesson has `is_optional = true`, an extra "Skip — it's optional" button appears next to the main action. Skip writes `skipped_at`; the student can un-skip later. Skipped lessons still count toward unlocking the next region.

**Keyboard.** Escape closes. Arrow keys nav prev/next. Sheet remembers scroll position per lesson.

#### 4.4.4 The discount block (inside the stats widget)

Six possible states depending on R1+R2 progress, time since join, and request status:

| State | What the widget shows |
|---|---|
| **Countdown** (R1+R2 not yet done, within 14d) | Pulsing green dot + "30% OFF" + countdown "14d 3h 22m 48s left for 30% off" |
| **Eligible** (R1+R2 done, within 14d, no request yet) | Pulsing green dot + "30% OFF" + **Apply** button |
| **Pending** | Clock icon + "Application under review" |
| **Approved** | Clock icon + "30% code: ECOM30-ABC123" + Copy button |
| **Rejected** | Clock icon + "Application not approved · DM the team in Discord" |
| **Window closed** (past 14d, never applied) | Nothing — discount block disappears |

#### 4.4.5 Gamification mechanics

| Mechanic | How it works |
|---|---|
| **Day counter** | Computed from `joined_at`, never stored. Day 1 = join day. |
| **Overall progress %** | completed lessons / total lessons (currently 57). Clamped 0–100. |
| **Per-region progress** | completed lessons in that region / total lessons in that region. |
| **Streak** | Increments by 1 the first time the student completes any lesson on a new calendar day. |
| **Streak celebration modal** | Full-screen flame + "Day N streak!" animation. Fires once per increment (de-duped via localStorage). Auto-dismisses after 5s, click anywhere to dismiss earlier. |
| **Streak toast** | A smaller bottom-right pill currently coded for 7/14/30-day milestones. Not yet wired into the main celebration flow — exists as a foundation. |
| **Discount-approved celebration** | Big spring-in "30% OFF" + code reveal + Copy button. Fires once per approved code. |
| **Lesson complete bloom** | Soft gold ink-bloom across the map when a lesson transitions to completed. Visual only. |
| **Locked-Onward toast** | "N lessons left to unlock Onward" when the student clicks the locked button on the region side panel. |

#### 4.4.6 `/dashboard/notes`

Archive of all daily notes the student has written. Read-only list view.

---

## 5. Admin-Facing Surface

What Karlo and Astrid see. All under `/admin`. Sidebar layout with: Dashboard, Kanban, Students, Alerts, Discounts.

### 5.1 `/admin/login`

Email + password form. Supabase auth. "Invalid email or password" on failure. Bottom link to student login.

### 5.2 `/admin` — Dashboard

| Section | What it shows |
|---|---|
| Hero KPI: Month 2 conversion | Big % + "of N past renewal." Of launch-cohort paying students whose renewal moment has resolved (`first_paid_at` + 30d cycle + 7d grace), the share whose access survived it — i.e. a second payment must have landed. Definition lives in `isMonth2Converted` / `isInMonth2Cohort` (`src/lib/admin/metrics-definitions.ts`); read the `RENEWAL_GRACE_MS` docstring before touching it. An access-survival PROXY, not a payment count — no payments table exists. Shows "—" only when no student has resolved yet. |
| Hero KPI: AdValue onboarded | Placeholder "—" / "Pending integration with Zak". Not wired. |
| Supporting stats (this week) | Active students, Joined this week, Avg progress, Churned in last 30 days. |
| Quick actions | Open Kanban / Pending discounts (with count badge) / Active alerts (with count badge). |
| Recent alerts | 5 most recent undismissed alerts with student name + message + day. Empty state: "No active alerts. All students are on track." |

**Important filter:** all admin views only show students who joined **on or after 2026-05-01** AND have a non-null `whop_membership_id` AND status in (`active`, `past_due`, `canceled`). This hides pre-launch test accounts and freeloaders from old free communities. The cutoff is hard-coded.

### 5.3 `/admin/students` — list view

Search bar (matches name, email, Discord username). Status filter dropdown (All / Active / Canceled / Past due). Table:

| Column | Sortable | Notes |
|---|---|---|
| Name | yes | Avatar + name + email below |
| Discord | — | username or "—" |
| Day | yes | Day number from `joined_at`. Color codes: ≤14 normal, 15–25 orange, >25 red. |
| Progress | yes | Bar + % |
| Last active | yes | Relative time ("3h ago") |
| Status | — | Pill: active / canceled / past due |

Clicking a row goes to `/admin/students/{id}`.

### 5.4 `/admin/students/{id}` — student detail

Single student. Layout, top to bottom:

1. **Header.** Name + email + day + membership status. Back button.
2. **Four stat cards.** Progress %, current streak, joined date, last active.
3. **Whop sync diagnostic.** Last synced timestamp. Three counters: Fetched / Matched / Unmatched. If there was an error, it's shown in red. If there are unmatched Whop lesson IDs, they're listed in monospace — this is how Karlo finds lessons that need a `whop_lesson_id` set.
4. **Lesson progress by region.** Each region listed with all its lessons. Checkbox per lesson (filled if completed). Type badges. Completed lessons are strikethrough.
5. **Discount section.**
   - "Gate lesson (l049): completed / not yet"
   - If a discount request exists: status pill, promo code (if approved), rejection reason (if rejected)
   - **The verification checkbox** — "Ad submissions verified" with helper text: "Tick this once you've confirmed the student submitted all action items in the Discord ad-review channel. Required for discount approval." This is the gate Karlo has to manually flip before an Approve will succeed.
6. **Quick DM templates.** Three buttons that copy templated text to clipboard:
   - **Welcome:** "Hey {name}! Welcome to EcomTalent. I'm here to help you get the most out of your first 30 days. Have you checked out your expedition map yet? Let me know if you have any questions!"
   - **Check-in:** "Hey {name}! Just checking in — how's everything going? I noticed you're on Day {dayNumber}. Is there anything I can help you with?"
   - **Encouragement:** "Hey {name}! You're making great progress — {overallPercent}% through your expedition. Keep going! The next region is where things really click."

Note: there is a **second, more detailed set** of templates used on the Kanban cards (Day 1 / Day 7 / Day 14 / Day 21 — see Section 6). The two sets are not yet unified.

### 5.5 `/admin/kanban` — Kanban board

Six-column board, auto-flowing (no drag-to-move). See Section 6 for the auto-move logic.

**Per-card content:**

- Name (truncated) + "Day N" right-aligned
- Thin progress bar + "{X}% complete · {last active}"
- **Four SOP chips:** Day 1 / Day 7 / Day 14 / Day 21. Click copies the corresponding template to clipboard with `{firstName}` / `{fullName}` / `{dayNumber}` interpolated. Button briefly shows "Copied" for ~1.4s.

**Clicking a card** opens a right-side drawer with:
- Name + email + day + status
- Stat grid (progress, streak, joined, last active)
- "Lessons by region" — one row per region with a mini progress bar
- Discount section (status + code + the ad-submissions-verified checkbox)
- "Open full detail page →" link

### 5.6 `/admin/discounts` — discount queue

Segmented control: **Pending / Approved / Rejected / All** (defaults to Pending).

Per row:
- Student name (link to detail) + "Applied {date}"
- Status pill
- Promo code (if approved, green monospace box)
- Rejection reason (if rejected, red text)
- **Pending only:**
  - **Approve** button — calls `/api/discounts/approve`. Server validates:
    1. `ad_submissions_verified = true` on the student. If not, returns "Ad submissions not verified yet — tick the verification flag on the student's detail page first."
    2. All R1+R2 lessons fully complete (compound lessons need both halves).
    3. Latest completion is within 14 days of join.
    
    If all checks pass, generates a Whop promo code and stores it. If Whop's API fails, falls back to a `MANUAL-` prefix and still approves.
  - **Reject** button — opens a browser `prompt()` asking for an optional reason, then writes `status = rejected` + `rejection_reason`. (Note: it's literally `window.prompt` — a quick UI shortcut, not a polished form.)

### 5.7 `/admin/alerts` — alert triage

Checkbox at top: "Show dismissed."

Per row:
- Type badge (one of: "No tasks in 7 days" / "No activation by Day 14" / "Inactive for 5+ days" / "Week 2 not started")
- Student name (link to detail)
- Message
- "Day N · {date}"
- **Dismiss** button — sets `is_dismissed = true` + audit fields

Dismissed alerts are hidden by default; visible at 50% opacity when "Show dismissed" is on.

---

## 6. Kanban Auto-Move Logic

The board has six columns and a card's column is computed **on every render** from two fields: `membership_status` and `joined_at` (via day number). There's no manual move and no persisted column — the rules below are the entire system.

**Evaluation order (first match wins):**

| # | Condition | Lands in |
|---|---|---|
| 1 | `membership_status == 'canceled'` | **Churned** |
| 2 | day > 30 AND `membership_status == 'active'` | **Month 2+** |
| 3 | day ≤ 7 | **Week 1** |
| 4 | day ≤ 14 | **Week 2** |
| 5 | day ≤ 21 | **Week 3** |
| 6 | (otherwise — days 22–30) | **Week 4** |

**Implications:**

- A `past_due` student with day ≤ 7 lands in Week 1. They stay in their week column even though Whop hasn't received their payment. Only `canceled` moves them to Churned.
- A `past_due` student past day 30 goes to **Week 4**, not Month 2+ (Month 2+ requires `active`).
- A student who churns at day 5 lands in **Churned**, not Week 1. Their join history is preserved in `joined_at` but the column is overridden.
- There is no "Re-activated" column. If a canceled student later goes `active` again via webhook, they re-enter whichever week column matches their current day.

**Design note for new scenarios.** Because the column is pure-function of (status, day), Karlo can design rules like "when a student lands in Week 3, send the Day 14 follow-up" purely based on these two facts — the rule never needs to wait for an event. Anything dependent on lesson progress (e.g. "Week 3 but R2 incomplete") would need to be a separate alert, not a column.

---

## 7. Existing Automations & Triggers

What fires on its own, when, and to whom.

### 7.1 Cron jobs (Vercel scheduler)

| Job | Schedule (UTC) | Status | What it does |
|---|---|---|---|
| `/api/cron/check-engagement` | 09:00 daily | **Live** | Scans all active students. For each, computes days since last lesson and last login. Creates new (non-duplicate) alerts for: no lessons in 3 days (early warning), no lessons in 7 days (urgent), no login in 5+ days. Posts a summary embed to the team Discord channel with the list of new alerts. |
| `/api/cron/day28-dm` | 09:30 daily | **Live** | Finds students 28–30 days past join who haven't received the day-28 DM yet. Builds a personal stats embed (lessons completed, longest streak, notes written, discount status). Tries to DM via Discord bot; falls back to a team-channel post if the DM fails (no bot token, student hasn't connected Discord, mutual-guild missing, etc.). Stamps `day28_dm_sent_at` whether DM or fallback. **Note:** Karlo's stated long-term intent is to fire this on **exactly day 28**, not the 28–30 window. |

Both crons require `Authorization: Bearer {CRON_SECRET}`.

### 7.2 Login-time triggers (fire when a student logs in)

| Trigger | What it does |
|---|---|
| Upsert student row | Refresh email/name/avatar/Discord username from Whop; refresh access/refresh tokens. |
| Watch-progress sync | 2.5s timeout, non-blocking. Backfills any Whop lesson completions not yet recorded. |
| `last_active_at = now()` | Updated every dashboard render (lightly throttled). |

### 7.3 Tab-focus / visibility triggers (fire while the student is on `/dashboard`)

| Trigger | What it does |
|---|---|
| Tab regains focus | Silent watch-progress sync (throttled to once every 30s). Picks up "I just watched a lesson on Whop in another tab" without the student needing to do anything. |

### 7.4 Webhook triggers (fire when Whop sends us something)

| Webhook | What it does |
|---|---|
| Membership activated / went valid | Set `membership_status = 'active'`. |
| Membership deactivated / went invalid | Set `membership_status = 'canceled'`. (Moves the card to Churned.) |
| Payment succeeded | Set `membership_status = 'active'`. |
| Course lesson interaction completed | Record `completed_at` for the matched lesson. |

### 7.5 Admin-triggered (manual but with automation underneath)

| Action | What it does |
|---|---|
| Approve discount | Validates eligibility, generates a real Whop promo code, stores it, updates the request. |
| Reject discount | Updates the request status + reason. |
| Verify ad submissions checkbox | Toggles `ad_submissions_verified` on the student. |
| Dismiss alert | Marks an alert as handled. |
| Send DM (currently) | **Manual.** All "send" actions today are clipboard-copy → paste into Discord by hand. There is no in-app send button. |

### 7.6 Celebration triggers (fire client-side, dashboard only)

| Trigger | What fires |
|---|---|
| Streak counter increments | Full-screen streak celebration modal (de-duped via localStorage). |
| Discount request transitions to `approved` (next time the student loads the dashboard) | Full-screen "30% OFF" celebration with code reveal + Copy button. |
| Any lesson transitions from incomplete → complete | Soft gold ink-bloom across the map. |
| Locked Onward button click | Toast: "N lessons left to unlock Onward". |

### 7.7 Built but not wired

| Capability | State |
|---|---|
| Streak toast component | Built (`StreakToast.tsx`) but not wired into the main celebration path. Could be used for 7/14/30-day milestones. |
| `hidden_rewards` / `student_rewards` tables | Loot-drop tables exist in the schema; no UI surface uses them yet. |
| `month_reviews` table | Day-28 frozen-snapshot table exists; the day-28 cron does not currently write to it (it computes stats live). |

---

## 8. What Is NOT Built Yet

The explicit gap list. Anywhere new logic will need to be designed and implemented.

### 8.1 CSM notification system (partial)

**What works:** Daily engagement alerts post a summary embed to the team Discord channel. The day-28 DM cron tries to DM the student via a Discord bot.

**What's missing:**
- **Realtime per-event team alerts** (e.g. "Student X just churned" the moment the webhook arrives). Webhooks update the DB silently; no notification surface fires.
- **Slack.** Not implemented. Only Discord.
- **Email.** Not implemented anywhere.
- **In-app send button** (DM the student from the admin UI). Today everything is clipboard-copy.
- **Bot-driven scheduled outreach.** No way to say "DM this template to all Week 2 students who haven't completed l020." The Day 1/7/14/21 chips on Kanban cards are still copy-paste.

### 8.2 Message-template engine

**What works:**
- Two static template sets exist as TypeScript objects: the 3 simple templates on the student detail page (Welcome / Check-in / Encouragement) and the 4 SOP templates on Kanban cards (Day 1 / Day 7 / Day 14 / Day 21).
- Variable interpolation supports `{firstName}`, `{fullName}`, `{dayNumber}`.

**What's missing:**
- No CMS / database table for templates. Edits require a code change.
- No conditional templates (e.g. "if student has skipped editing breakdowns, use this variant").
- No richer variable set (e.g. `{currentRegion}`, `{lessonsLeftInR2}`, `{discountStatus}`).
- No template versioning or A/B variants.
- No analytics on which templates were copied (the SOP chips fire an analytics event ID but nothing reads it).
- The two template sets are not unified — they live in different files and have different shapes.

### 8.3 Discount approval workflow

**What works:**
- Application flow: student clicks Apply → row created with `status = pending`.
- Validation on Approve: ad-submissions-verified + R1+R2 complete + within 14 days.
- Whop promo code generation (or `MANUAL-` fallback).
- Approval celebration on the student side.

**What's missing:**
- **Feedback survey gating** (see 8.4) — currently the only gate is the manual checkbox + the time/progress checks.
- **MANUAL- recovery.** Once a code is stored with the `MANUAL-` prefix, there's no async retry job to attempt the Whop API again. Karlo has to create that promo by hand in Whop's dashboard.
- **Rejection UI.** Rejection uses `window.prompt()` for the reason. A proper form with reason categories / templated replies would help.
- **Audit log / history.** A given request has only one `reviewed_by` / `reviewed_at`. There's no history if it was approved, then re-evaluated.
- **Re-application.** A rejected student has no documented path to re-apply. The schema would allow a second row but there's no UI for it.

### 8.4 Feedback survey (the "disguised feedback survey gating the 30% month-2 discount")

**Status: not built.**

What exists today: the discount is gated by lesson completion + the manual ad-verification checkbox. There is **no survey form**, no questions table, no answers table, no UI surface that asks the student anything before they apply.

When Karlo designs this:
- Decide where it sits in the flow (before "Apply", as part of the application, before the celebration?).
- New tables likely needed: `survey_questions`, `survey_responses`.
- The "disguised" angle (it should feel like a normal step, not an explicit survey) needs UX design.
- The quiz infrastructure (`src/lib/quiz.ts`, hinted at in migrations) exists for post-content quizzes but is not wired to the discount flow.

### 8.5 Post-day-30 handoff to Ad Bounty onboarding

**Status: not built.**

What exists: the Kanban "Month 2+" column. The Workshop Cabinet UI has a one-line hint about "month two and beyond." That's the entire current footprint.

What's missing:
- No onboarding flow for a student transitioning from sprint → bounty.
- No email / Discord / in-app touch when day 30 is hit.
- No "Ad Bounty" surface at all on the student side.
- No way to mark a student as having "graduated" or to switch their dashboard mode.
- No data model for bounty submissions, payouts, or status.

This is a full feature design from scratch.

### 8.6 Other partial/missing pieces

| Item | State |
|---|---|
| `adValueOnboardedRate` KPI on dashboard | Returns `null` with a placeholder "Pending integration with Zak." Needs an external data source. |
| `whop_lesson_id` for **l047 + l048** | Null. Lesson sheet shows "Video content coming soon" placeholder. Unblocks once Karlo pastes the Whop URLs. |
| `week2_no_start` alert type | Defined in the schema enum but never produced by the cron. Dead code unless wired. |
| `no_activation_14d` alert type | Defined and labeled but the cron doesn't currently emit it. |
| Direct in-app DM send | Not implemented. Discord bot exists for the day-28 path but not exposed to the admin UI. |
| Bulk actions in admin | None. No "approve all" / "DM all Week 2" / "dismiss all" affordances. |
| Re-engagement flow for canceled students | None. Once churned, they fall out of the dashboard but nothing reaches out. |
| Activation Points (AP1/AP2/AP3) | Mentioned in old CONTEXT.md but **not present in the current data model**. Replaced by the region/lesson model. If Karlo wants AP tracking, it's new work. |
| Past-due handling | A `past_due` student stays in their week column with no special UI. No alert. No reminder. |
| Multi-team-member permissions | All team members have the same powers. The `role` field is informational only. |

---

## 9. Open Questions / Known Issues

Things to be aware of before designing on top of the platform.

1. **Day-28 cron window.** Currently fires for students 28–30 days past join. Stated intent is to fire on **exactly day 28** later. Decide before adding more day-N triggers.
2. **CONTEXT.md is out of date.** It describes an older "checklist" model with `tasks` and `student_task_completions` tables. The actual platform uses `lessons` and `student_lesson_completions` with a map. Don't trust CONTEXT.md as a spec.
3. **Activation Points (AP1/AP2/AP3) don't exist in the code.** The old docs reference them; the schema has no AP fields. Any KPI that mentions activation points is currently undefined.
4. **Email-as-identity is fragile.** Whop students get a synthetic Supabase email like `user_XYZ@whop.ecomtalent.com`. If you want to email students directly, you need their real email from the `students.email` field (which is the Whop-provided one).
5. **`joined_at` is set once, at first login, from Whop's earliest membership for our product.** If Whop's data is wrong at that moment, our day counter is wrong forever. There's no UI to correct it.
6. **The discount window is 14 days from `first_paid_at` (original Whop signup), not from the student's first login.** A student who joins on Whop but waits 5 days to log in only has 9 days left. Worth being explicit about in CSM Day 1 messaging.
7. **Compound lesson semantics matter for KPIs.** A "completed lesson" can mean: (a) `completed_at` is set, or (b) for compound lessons, both halves are set. The discount eligibility check uses (b). A naive "count of `student_lesson_completions` rows where completed_at is not null" undercounts compound lessons that are only half done and overcounts compound lessons where only the watch half is done.
8. **`student_lesson_completions` rows can also represent skips.** Any KPI that counts rows must filter on `completed_at IS NOT NULL` (or explicitly include skips, depending on what you mean by "engagement").
9. **The `MANUAL-` promo-code fallback is silent.** If the Whop API fails on approval, the student still sees a code, but it's not a real Whop promo. The team has to manually create it. There's no admin warning surface for this beyond the response of the API call.
10. **Whop user metadata can go stale.** If a student changes their name, avatar, or Discord username on Whop after first login, we don't re-sync. To refresh, they'd need to log in again (we re-upsert on every login).
11. **`discord_user_id` is best-effort.** If a student doesn't connect Discord, or connects it after first login, we won't have their Discord ID and the day-28 DM falls back to a team-channel post. There's no retry job to backfill.
12. **All admin views filter to `joined_at >= 2026-05-01`.** Pre-cutoff students are invisible. If you ever need to view older test accounts you have to bypass this in code.
13. **No realtime updates in admin.** The admin pages fetch on load. If a student completes a lesson while Karlo is on the Kanban board, the card doesn't update until refresh.
14. **The streak counter increments on the first completion of a new calendar day.** Calendar day is in the student's local time as detected by the browser, not a fixed timezone. Edge cases around midnight and DST exist.
15. **Promo codes are 6-char-of-student-ID, single-use, 1 customer, stock 1.** They're not transferable. If a code needs to be re-issued, the existing one has to be expired on Whop.
16. **No soft-delete for any table.** A student churning sets `membership_status = canceled` but their data stays. A `DELETE` would cascade through completions, notes, requests, alerts.
17. **No GDPR / data export surface.** If a student requests their data, there's no built-in path.

---

## Appendix: Quick reference

**Key constants** (live in `src/lib/constants.ts`):
- Total lessons: **57** (R1: 20, R2: 22, R3: 10, R4: 7 — approximate; always prefer the live count).
- Total days: **30**.
- Total regions: **4**.
- Discount window: **14 days** from `first_paid_at` (original Whop signup).
- Discount gate lesson: **l049** ("Action Item: Static Ads").
- Admin student cutoff: joins on/after **2026-05-01**.
- Editing Breakdowns group: 9 lessons (l032, l033, l035–l039, l041, l042).
- Compound lessons (watch + ship): l018, l020, l022, l024.
- Currently optional lessons: l050, l051 (plus all 9 Editing Breakdowns).

**Crons:**
- Engagement check — 09:00 UTC daily.
- Day-28 DM — 09:30 UTC daily.

**Key Whop endpoints used:**
- `/oauth/authorize`, `/oauth/token`, `/oauth/userinfo` — login.
- `/api/v1/me/has_access/{product}` — membership check.
- `/api/v1/me/memberships` — earliest join date.
- `/api/v2/members/{user_id}` — Discord ID lookup.
- `/api/v1/course_lesson_interactions` — watch-progress sync (admin key, `course_analytics:read`).
- `/api/v1/promo_codes` — discount code creation.

**Promo code format:** `ECOM30-{first 6 chars of student UUID, uppercased}`, 30% off, 1 month duration, one per customer.

**Discord:**
- Team channel webhook (`DISCORD_TEAM_WEBHOOK_URL`) — engagement alert digests, day-28 DM fallbacks.
- Discord bot (`DISCORD_BOT_TOKEN`) — day-28 student DMs. Optional; without it everything goes to the team channel.

---

*Doc generated 2026-05-12 against the current main branch. If something in this doc disagrees with what you see in the app, the app is right — this doc needs to be regenerated.*
