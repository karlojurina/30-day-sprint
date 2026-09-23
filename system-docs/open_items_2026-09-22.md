# Open items at pause — 2026-09-22

Written because Lovro is stepping away from the rebuild for at least a week. These
are the things that exist only as working-tree state or as a decision not yet made,
i.e. the things that get lost. Everything else is in git or in a doc.

---

## 1. UNCOMMITTED: streak-before-achievements fix on the login path

**File:** `src/app/api/auth/whop/callback/route.ts` — 7 added lines, uncommitted.
**Last commit on main:** `f93cd4a`, 2026-09-18.

The login path called `evaluateAchievements()` without first calling
`updateStudentStreak()`. The other three write paths all do streak first
(`toggle-lesson:56`, `mark-action-shipped:133`, `refresh-watch-sync:54`). Without
it, `streak_7` / `streak_14` / `unbroken` are judged against whatever the streak
was *before* this login's sync, so they silently under-award.

```ts
// Streak FIRST, then achievements — the same order the other three write paths use
await updateStudentStreak(supabase, upsertedStudent.id);
await evaluateAchievements(supabase, upsertedStudent.id);
```

Low risk: additive, inside an existing try/catch that is explicitly designed never
to break a login. **Not pushed — Lovro pushes to main himself.** It has been sitting
in the working tree since roughly 2026-09-18. If the laptop is wiped or the branch
reset, this is lost and the under-awarding continues silently.

**Action: push it, or consciously decide not to.** Do not leave it a third week.

## 2. UNTRACKED: `system-docs/rebuild_capability_map_2026-09-21.md`

Never added to git. Same exposure as above.

## 3. CRON_SECRET is still unrotated

The production `CRON_SECRET` was pasted into a chat transcript on ~2026-09-18 and
has not been rotated in Vercel since. Rotating it is a two-minute job in the Vercel
dashboard. It gates the cron endpoints.

## 4. Decisions the rebuild is blocked on

Both are Lovro's to make; neither is an engineering task.

- **Which deadline moves** — recording or app. 110+ lessons in 8 days (his stated
  end-of-September recording target, as of 2026-09-22) does not survive arithmetic.
  `_admin/memos/sprint_rebuild.md` sequences around that date as if it were fixed.
- **Churn and bounty targets.** `_admin/memos/sprint_rebuild.md` cannot clear Gate 1
  to `/prd` until Success Definition carries a measured churn baseline (frozen
  *before* cutover, per the memo's own wording) and a bounty-access target above
  today's 21.7%.

## 5. Queries worth running before the PRD leans on these numbers

- **What is actually inside "467 of 1,044 buyers never opened the app"?** Refunds,
  chargebacks, dead cards, Discord-only buyers. It has been used in argument as if
  all 467 were recoverable students. Unverified.
- **Does `bounty_access_claimed_at` correlate with finishing Region 1?** If the ~21.7%
  who are unlocked do not actually enrol, the gate is not the constraint and the
  offer is.
- **`cancel_scheduled_at`** (v75.46) is the only window where a subscription can still
  be saved — the student has clicked cancel and still has access. It is instrumented
  and unused. No churn baseline has ever been measured despite churn being the
  program's headline metric.

---

See also: `_admin/memos/sprint_rebuild.md` (Gate 1 memo + its 2026-09-22 addendum)
and `_admin/research/world-gen/README.md` (the world-map prototype handoff).
