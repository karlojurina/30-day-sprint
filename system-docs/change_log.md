# Change Log

All notable changes to the EcomTalent platform.

Format: [Keep a Changelog](https://keepachangelog.com/)

## [0.1.0] - 2026-04-15

### Added
- Initial project scaffold: Next.js 16 + Supabase + Whop OAuth
- Database schema (7 tables with RLS) and seed data (23 playbook tasks)
- Student auth flow: Whop OAuth 2.1 with PKCE
- Student dashboard: playbook checklist, progress bar, daily notes, discount tracker
- Team dashboard: KPIs, student list, student detail, discount management, alerts
- API routes: auth, discounts (request/approve/reject), webhooks, cron
- Churn detection cron job (daily 9am)
- Auth guards (StudentGuard, TeamGuard)
- AuthContext and StudentContext for state management
