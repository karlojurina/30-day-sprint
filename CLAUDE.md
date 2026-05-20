# EcomTalent Student Platform — Working Principles

The Next.js + Supabase student platform behind EcomTalent's 30-day sprint.
For *what currently exists* see [CONTEXT.md](CONTEXT.md).
For *how tables depend on each other* see [system_contracts.md](system_contracts.md).

This document is about **how we work** — the principles every session
should follow on every task. Stable across the life of the project.

## Build Principles

- **Diagnose deep, fix shallow.** Spend most effort understanding the
  problem. The fix should feel obvious by the time you implement it.
- **Validate before you build.** Check live systems (DB schema, API
  responses, library docs) before committing to an approach. Assumptions
  are the top source of backtracking.
- **Go to the source.** Never trust docs alone — query the database,
  fetch the live record, read the actual code. Docs drift; live state
  doesn't lie.
- **Ceremony proportional to risk.** Small fix → `/quick-fix`. Significant
  build → `/build`. Don't run a 7-phase process for a config tweak.
- **One problem, one fix.** Don't bundle unrelated improvements. Don't
  "improve the neighborhood." Each PR should trace to one specific ask.
- **Think before coding.** State assumptions explicitly. If multiple
  interpretations exist, present them — don't pick silently. If a
  simpler approach exists, say so. If something is unclear, stop and
  name what's confusing. (Karpathy)
- **Surgical changes.** Touch only what you must. Don't refactor adjacent
  code, rewrite comments, or reformat. Match existing style. Every
  changed line should trace directly to the request. (Karpathy)
- **Demand elegance, balanced.** For non-trivial changes, pause and ask
  "is there a more elegant way?" If a fix feels hacky, step back and
  implement the clean solution. Skip this for simple, obvious fixes —
  don't over-engineer. (Cherny)
- **Autonomous execution.** When given a task, just do it. Point at the
  failing test, the error, the log line, then resolve. Zero context-
  switching back to the user. Go fix failing things without being told
  how. (Cherny)

## Verification Standard

Every task has a definition of done. Never mark something complete
without proving it works.

- **Task level:** Transform tasks into verifiable goals. "Add validation"
  → "Write tests for invalid inputs, then make them pass." "Fix the bug"
  → "Reproduce it, then make it not reproduce." (Karpathy)
- **Multi-step level:**
  ```
  1. [Step] → verify: [check]
  2. [Step] → verify: [check]
  ```
  Strong success criteria let a session loop independently. Weak criteria
  ("make it work") require constant clarification.
- **For UI / frontend changes:** open the feature in a browser and use it
  before reporting done. Type-checking and tests verify code correctness,
  not feature correctness. If the UI can't be exercised in this session,
  say so explicitly rather than claiming success.
- **The test:** Would a staff engineer approve this? If not, it's not
  done. (Cherny)

## Bounded Contexts

Each domain owns its boundaries. Don't reach across them without
deliberate intent.

### Folder-level bounded contexts

| Context | Folder | What lives here |
|---------|--------|-----------------|
| Student dashboard | `src/app/dashboard/`, `src/components/map/`, `src/components/playbook/`, `src/components/student/` | Student-facing UI |
| Admin / team | `src/app/admin/`, `src/components/admin/`, `src/components/team/` | Team-facing UI |
| API | `src/app/api/` | Server-side handlers (mutations + reads) |
| Cron / background | `src/app/api/cron/` | Scheduled jobs (Vercel cron) |
| Shared libs | `src/lib/` | Pure functions, helpers, integrations |
| State | `src/contexts/` | React contexts (AuthContext, StudentContext) |
| Types | `src/types/` | Shared TS types (mirrors DB shape) |
| DB | `supabase/schema.sql` + `supabase/migrations/` | Schema as code |

Don't mix concerns across folders. A component that touches the admin
DB tables doesn't belong in `src/components/student/`. A cron job that
needs an admin helper shouldn't pull from `src/components/admin/` —
move the helper to `src/lib/`.

### Table-level bounded contexts

Every table represents *one function*. Don't pile related-but-distinct
state into one table — give each function its own.

**Counter-example (what to avoid):** the `students` table has accumulated
streak fields, sprint milestone fields, Whop sync state, last-active
timestamps, celebration flags, etc. Each of those is a separate
function. When one of them changes, the contract for "what a student
row looks like" expands and every consumer has to handle the new shape.

**The forward pattern.** When tempted to add a column to `students`, ask:

- *Is this part of who the student is?* (email, name, whop_user_id) →
  belongs on `students`.
- *Is this state about a specific behavior or feature?* (streak data,
  sprint milestones, sync diagnostics) → its own table with a
  `student_id` foreign key.

Existing tables that follow this pattern: `student_lesson_completions`,
`daily_notes`, `discount_requests`, `student_quiz_attempts`,
`student_rewards`, `month_reviews`. New behavior state should follow
the same shape, not bolt onto `students`.

See [system_contracts.md](system_contracts.md) for the table-by-table
dependency map.

## Source of Truth Proximity

Every piece of information should live as close to its source of truth
as possible. Don't duplicate what you can reference.

**Three questions carry any session:**
1. *Where are we going?* → the PR description / brief / open issue.
2. *Where are we now?* → CONTEXT.md (live state of the app).
3. *What was decided?* → git commit messages + memory entries.

The gap between (1) and (2) is the remaining work.

**Rules:**
- **Don't copy what you can reference.** Migration filename, not the
  full SQL. Function name, not the body. Table name, not the schema
  dump.
- **Files are either living or disposable.** Living docs (CLAUDE.md,
  CONTEXT.md, system_contracts.md) get maintained. One-off scripts,
  planning notes, scratch files get deleted when their job is done.
- **Update at the moment of change.** When a table is added or a route
  is renamed, CONTEXT.md and system_contracts.md change in the same
  PR. Not later.

## Living Documentation Rule

All structural documents reflect current state at all times.

**Living documents** (answer "what is true now?"):
- `CLAUDE.md` — these principles
- `CONTEXT.md` — app structure
- `system_contracts.md` — table dependency map
- Memory files (`~/.claude/projects/.../memory/`)
- Migration files (the cumulative state of the DB)

**Static documents** (answer "what was true then?" — no updates needed):
- Old PR descriptions
- Commit messages
- Migration headers (they describe the *moment* of the change)

**The trigger:** any structural change — new/renamed/deleted route,
table, context, lib module. At the moment of change, check whether any
living doc references it. Update or flag the update.

**The principle:** if you change the territory, update the map. If the
territory no longer exists, delete the map.

## Self-Improvement Loop

After ANY correction from the user, capture the lesson so the same
mistake doesn't repeat.

1. **Identify the pattern.** What went wrong? What should have happened?
2. **Save to memory.** Write a feedback memory with the rule, why it
   matters (cite the incident), and when it applies.
3. **Apply immediately.** Don't just note it. Change behavior in the
   same session.

Corrections are the most valuable input — they reveal the gap between
how you work and how the user needs you to work. (Cherny)

## Subagent Strategy

Use subagents liberally to keep the main context clean and parallelize.

- **Offload research, exploration, and verification** to subagents —
  don't pollute main context with raw search results.
- **One task per subagent.** Don't bundle unrelated things.
- **For complex problems, throw more compute at it.** Launch multiple
  in parallel rather than doing serial work.
- **Use subagents for independent verification** after making changes
  — they provide a second look without context bias. (Cherny)

## Development Lifecycle

| Entry point | When | Skill |
|-------------|------|-------|
| Identify a constraint or opportunity | Strategic decision needed | `/memo` |
| Design a system change | After memo, before building | `/prd` |
| Build the designed system | After PRD complete | `/build` |
| Something's broken or needs a small tweak | Known issue, contained scope | `/quick-fix` |
| Verify system integrity | Before release, after big changes | `/audit` |
| Close out a completed project | All work done, ready to archive | `/close-project` |

**Primary flow:** `/memo` (why) → `/prd` (what) → `/build` (how)
**Fast path:** `/quick-fix` (diagnose → fix → verify — escalates to
primary flow if too big)

## Session Close Protocol

Before ending any session that modified the app, check:

1. **CONTEXT.md** — does the current-state map reflect what changed?
2. **system_contracts.md** — did any table dependencies change?
3. **Migration** — if the DB schema changed, is there a migration file?
   Is it idempotent?
4. **Memory** — any non-obvious decision or correction worth saving?
5. **No orphan files** — delete one-time scripts, scratch files, temp outputs.
6. **Verification** — does the build pass? Does the changed feature
   actually work end-to-end in a browser?

The key word is *flag*. Not every update has to land in the same session,
but every change needs to be acknowledged — either handled or explicitly
noted as deferred.

## Build Commands

```bash
npm run dev    # Start dev server
npm run build  # Production build
npm run lint   # ESLint
```
