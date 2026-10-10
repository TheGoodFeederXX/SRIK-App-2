# SRIK project contract

Target: a single-school management application for Sekolah Rendah Islam Al-Khairiah. Source project Oliskey/Othiskey is reference code, not the target architecture.

## Mandatory rules

- Read docs/srik/01_DECISIONS.md and the current phase file. Do not implement deferred features without a scope change.
- No school_id, branch_id, tenant routing, cross-school administration or SaaS subscription architecture. SchoolProfile is configuration, not a tenant.
- Production backend is Supabase Auth, PostgreSQL, Data API, RLS, RPC, Storage, Realtime and selectively Edge Functions/Cron. Replace Express, Prisma, custom JWT, Socket.io, Redis and BullMQ in stages.
- Preserve React/Vite/TypeScript frontend where useful. Avoid an unrelated framework rewrite.
- Frontend checks improve UX; database/server authorization is authoritative. Deny by default. Test both permission and record scope.
- Every table exposed through the Data API must enable RLS and have explicit grants and tested policies for allowed operations. Operations not permitted must remain denied; do not add permissive CRUD policies just to complete a checklist.
- Supabase secret keys must never enter frontend source, VITE variables, bundles or public logs. Use a publishable key in the browser.
- Use SQL migrations as schema source of truth. No untracked production dashboard changes.
- Multi-row business operations must be atomic RPC/database transactions. Privileged/external operations belong in authenticated, authorized Edge Functions where needed.
- Academic years, classes and subjects are relational. Current class derives from enrollment; no subject-name strings as foreign-key substitutes.
- Use exact NUMERIC/Decimal money, never Float. Do not calculate authoritative payment totals with JavaScript floating-point arithmetic.
- Published report cards are immutable snapshots with explicit revisions. PBD TP is not automatically determined from exam score.
- Audit sensitive mutations at the authoritative backend. Clients cannot edit audit history.
- Remove dead legacy code once replacements work. Never delete real data, secrets or live migrations without verifying scope and authorization.
- App shell caching is v1 scope. Offline attendance/score writes and conflict resolution are deferred.
- Keep AGENTS.md short. Put detailed specifications and phase evidence in docs/srik/.

## Phase completion

Report changed behavior, migrations, meaningful validation, remaining risks and proposed decisions. Do not mark a phase complete while its acceptance criteria fail. Inspect actual code before claiming any legacy feature or dependency was removed.
