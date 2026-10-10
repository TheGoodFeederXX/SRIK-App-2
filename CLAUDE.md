# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## ⚠️ CRITICAL: BEFORE STARTING ANY TASK — ASK CLARIFYING QUESTIONS

Before writing a single line of code for any request, Claude must **always ask the owner clarifying questions** to fully understand what is needed.

### Why this is required:
The owner's first message may be brief or high-level. Claude must never assume it knows exactly what is wanted. Asking questions first prevents wasted work, wrong implementations, and unwanted changes.

### How Claude must ask questions:
- Ask **all questions in one message** — not one at a time across multiple turns
- Questions must be **specific and practical**: "Should this work for all branches or just the main branch?", "Should the teacher see this before or after submitting?"
- Do not ask vague questions like "Can you tell me more?" — ask targeted questions about behavior, scope, edge cases, and user roles affected
- After the owner answers, Claude may ask **one follow-up round** if something is still genuinely unclear — then proceed
- Claude must **never start coding** before getting at least a basic confirmation of the plan

### Example format Claude must use:
> "Before I start, I have a few questions to make sure I build this correctly:
> 1. [Question about scope]
> 2. [Question about which roles are affected]
> 3. [Question about edge case or behavior]
> Please answer these and I'll get started."

---

## ⚠️ CRITICAL: AFTER FINISHING CODE — EXPLAIN HOW IT WORKS, NOTHING ELSE

When Claude finishes writing or updating code, it must explain **how the feature works from the user's perspective only**.

### Rules for the post-code explanation:
- Explain **what the user will see and experience** — what happens when they click, submit, navigate, or interact
- Explain **the flow**: what triggers what, in plain everyday language
- Do NOT mention technology names — no React, the backend database, TypeScript, Express, RLS, hooks, queries, middleware, components, or any technical term
- Do NOT explain why a technology was chosen or how it works internally
- Do NOT list file names, function names, or code structure
- Keep it **short and conversational** — 3 to 8 sentences is usually enough
- Write as if explaining to a non-technical school owner who just wants to know: "What does this do and how do I use it?"

### Example of what Claude must NOT write:
> "I updated the `StudentService.ts` to use a Prisma-enforced scoping-scoped query with a React `useEffect` hook that triggers on branch context change..."

### Example of what Claude MUST write:
> "When a teacher opens the attendance page, they will only see students from their assigned class. After marking attendance and clicking Save, the record is immediately saved and the admin can see it from their dashboard. If the teacher tries to mark attendance for a date that already has a record, they will see a warning before overwriting it."

---

## ⚠️ CRITICAL: TEST THE CODE BEFORE GIVING ANY FEEDBACK

After writing or updating any code, Claude must **always test it first** before reporting back to the owner. Claude must never say "this should work" or "it's done" without running a real check.

### What Claude must do after writing code:

1. **Run the relevant tests** — if a test file exists for the feature, run it. If no test exists, Claude must write a basic test for the new code and run it
2. **Check for build errors** — run `npm run build` or the relevant compile check to confirm there are no TypeScript or build errors
3. **Check for runtime errors** — if the change touches a server route or backend service, start the server and confirm it starts without crashing
4. **Fix any failures silently** — if a test fails or an error is found, Claude must fix it and re-test before saying anything to the owner. The owner should never hear about a problem that Claude can fix itself
5. **Only report back after everything passes** — Claude's final message must only come after all tests and checks are green

### What Claude must include at the end (after all tests pass):
> "I tested this and everything is working. Here is how it works: [plain language explanation — no tech terms]"

### What Claude must NEVER do:
- Say "done" or "here is the code" without testing first
- Ask the owner to test it themselves as the first step
- Mention test results, file names, or error logs in the final explanation — just confirm it works and explain the behaviour
- Skip testing because the change seems "small" or "obvious" — every change must be tested, no exceptions

---

## ⚠️ CRITICAL: UI PRESERVATION POLICY — READ FIRST

**Claude must NEVER modify the UI without explicit owner approval.**

This rule applies to every task — bug fixes, new features, backend changes, refactors, database updates, and everything else. It is non-negotiable and overrides all other instructions.

### What Claude must NEVER change without being explicitly told to:
- Layout, spacing, padding, margins, or positioning of any element
- Colors, gradients, themes, or color schemes
- Typography — fonts, font sizes, font weights, line heights
- Component structure or hierarchy (e.g. moving a card, reordering sections)
- Icons, images, illustrations, or visual assets
- Animations, transitions, or motion effects
- Button styles, input styles, or form appearances
- Navigation structure, sidebar, topbar, or tab layouts
- Modal, drawer, or overlay designs
- Responsive breakpoints or mobile layouts
- Any Tailwind classes, CSS, or inline styles that affect appearance

### What Claude IS allowed to do (without UI approval):
- Fix bugs in logic, data fetching, or state management — **without touching any styling**
- Add backend routes, controllers, or services
- Update database queries or the backend database logic
- Add new functionality — but only by **inserting new components** that match the existing design system exactly, never by altering existing ones
- Refactor TypeScript types or utility functions
- Write or update tests

### When Claude wants to suggest a UI improvement:
Claude must **stop and ask** before making any change. The exact format is:

> "I noticed [X]. Would you like me to update the UI for this? I will not make any changes until you confirm."

Claude must describe exactly what it intends to change and wait for a **clear "yes, go ahead"** from the owner before touching a single style, class, or layout property.

### If a task requires a UI change to be completed:
Claude must inform the owner:

> "This feature requires a UI change to [specific area]. Here is what I would change: [description]. Please confirm before I proceed."

Claude does not proceed until confirmed. Claude does not make "small" or "minor" UI tweaks on its own judgment — all UI changes require consent, no matter how trivial they seem.

---

## Project Overview

**SRIK — Sekolah Rendah Islam Al-Khairiah.** A **single-school** management application (target ~250 users): lower-primary religious school administration covering students, teachers, guardians, classes, subjects, timetable, attendance, assessments, report cards and finance.

The code in this repository is the **Oliskey** multi-tenant SaaS project, which serves as **reference code — not the target architecture**. The SRIK refactor replaces its tenancy, auth and backend in stages.

> **Scope authority:** `AGENTS.md` + `docs/srik/01_DECISIONS.md` + the current phase file. Where this file describes architecture that conflicts with them, **they win** — see "Legacy Architecture (reference only)" below.

---

## Product Scope (LOCKED — see docs/srik/01_DECISIONS.md)

- **Single school.** No `school_id`, no `branch_id`, no tenant routing, no cross-school admin, no SaaS subscription/billing. `SchoolProfile` is configuration, not a tenant.
- **Roles:** `ADMIN` and `TEACHER`, plus a permission table. Do **not** create extra roles for Guru Data / Jadual / Peperiksaan — those are extra permissions on a TEACHER.
- **Deferred:** parent portal, student login, offline attendance/score writes, discipline, SEGAK, transport, native app, full PBD, automatic timetable generation. Do not build these without a scope change.
- **Removed:** hostel, scholarship, sponsorship, alumni-as-module, inspector/proprietor/compliance/exam-officer/counselor workflows, Paystack, Flutterwave, gamification, transport, shop/vendor, Nigerian compliance, TRCN, British-curriculum assumptions, demo-reset infrastructure, multi-branch SaaS.

---

## Commands

### Development

```bash
npm run dev        # Frontend only (Vite), port 3000
npm run server     # Backend only (Express), port 5000
npm run start:all  # Frontend + backend concurrently
```

### Build

```bash
npm run build            # Frontend production build
npm run build:backend    # Backend TypeScript → backend/dist (CommonJS)
```

### Testing

```bash
npm run test:run   # Frontend unit tests (Vitest, single run)
npx vitest run components/admin/__tests__/StudentListScreen.test.tsx   # one file

# Backend integration tests — REQUIRES a live PostgreSQL and DATABASE_URL set.
# Without it the fixture setup fails and most tests skip (see docs/srik/IMPLEMENTATION_STATUS.md).
npx vitest run --config backend/vitest.config.ts
```

### Database

```bash
npm run db:migrate   # Prisma migrate (legacy path — being replaced by Supabase SQL migrations)
npm run db:seed      # Synthetic seed only. Never seed real school data.
```

---

## Environment

**Root `.env`** (frontend — `VITE_` vars are bundled and public):
```
VITE_API_URL=                # optional; defaults to same-origin /api
VITE_APP_NAME=
VITE_APP_VERSION=
```

Supabase (target — see docs/srik/03_PHASE_1_SUPABASE_AUTH.md):
```
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
```

**`backend/.env`** (server-only, legacy until replaced):
```
DATABASE_URL=
DIRECT_URL=
JWT_SECRET=
REFRESH_TOKEN_SECRET=
BACKEND_PORT=5000
SMTP_USER=
SMTP_PASS=
```

**Never** put a server secret behind a `VITE_` prefix, in `.env.example`, in the bundle, or in public logs. Use the Supabase publishable key in the browser and keep secret keys server-side only. Remove provider keys (`VITE_PAYSTACK_PUBLIC_KEY`, `VITE_FLUTTERWAVE_PUBLIC_KEY`, `VITE_GEMINI_API_KEY`) as their modules are removed — do not keep them for compatibility.

**Runtime:** Node 24 LTS, pinned to `24.21.0` in `.nvmrc` / `.node-version` and `package.json` `engines`. CI and the Dockerfile read the same pin. Do not revert to Node 20 or 22 — `AsyncLocalStorage` propagation changed between Node 20 and 24, and the RLS tenant context depends on it.

---

## Architecture (current, transitional)

The app currently runs as two processes:
1. **Frontend** — Vite + React SPA, port 3000, proxies `/api/*` to `:5000`.
2. **Backend** — Express on port 5000 (`backend/src/server.ts`), Prisma + custom JWT.

**Target architecture:** React + Vite + TypeScript frontend, TanStack Query, Tailwind, React Router; backend entirely on **Supabase** (Auth, PostgreSQL, Data API, RLS, RPC, Storage, Realtime, selective Edge Functions/Cron). No Express, Prisma, custom JWT, Socket.io, Redis or BullMQ in the target.

Target layout:
```text
src/app/  src/components/  src/lib/supabase/  src/types/
src/features/{auth,students,teachers,guardians,classes,subjects,
              timetable,attendance,assessments,reports,finance}/
supabase/{config.toml,migrations,functions,tests,seed.sql}
docs/srik/
```

### Data and authorization rules (apply to all new work)

- **Database authorization is authoritative.** Frontend checks improve UX only. **Deny by default.**
- Every table exposed through the Data API must enable RLS with explicit grants and tested policies. Operations that are not permitted must remain denied — never add permissive CRUD policies just to complete a checklist.
- Use SQL migrations as the schema source of truth. No untracked production dashboard changes.
- Multi-row business operations must be atomic RPC / database transactions. Privileged or external operations belong in authenticated, authorized Edge Functions.
- Money uses exact `NUMERIC`/Decimal, never Float. Never compute authoritative totals with JavaScript floating-point.
- Academic years, classes and subjects are relational: class derives from enrollment, subjects are referenced by ID (never subject-name strings as FK substitutes).
- Published report cards are immutable snapshots with explicit revisions. PBD TP is not auto-derived from exam score.
- Audit sensitive mutations at the authoritative backend; clients cannot edit audit history.
- Remove dead legacy code only **after** the replacement works, and never delete real data, secrets or live migrations without verifying scope and authorization.

### Migration discipline

- Cut over in stages and never leave **two auth sources** or two write paths for a feature already migrated.
- Before removing legacy, record what the replacement validates. Inspect actual code before claiming a dependency is gone.
- Legacy RLS is **tenant** RLS (school/branch) with a blanket `bypass_rls`. It is not permission RLS and it is not a security baseline to preserve. Replace it before removing Prisma, or the authorization layer goes with it.

---

## Legacy Architecture (reference only — do not extend)

Everything below describes the **Oliskey** code being replaced. Read it to understand existing code, never to plan new work.

- **Multi-tenancy:** every record scoped by `school_id` and often `branch_id`; `Branch`, `SchoolMembership`, `BranchUserIdentity`, `Plan` models; `middleware/tenant.middleware.ts`; `lib/tenantContext.ts` (`AsyncLocalStorage`); RLS via `app.current_school_id` / `app.current_branch_ids` / `app.bypass_rls`. **All of this is to be removed.**
- **Auth:** custom `bcrypt` + `jsonwebtoken` HS256 + refresh tokens + MFA (`otplib`), CSRF middleware, demo tokens that bypass JWT verification, sessions in `sessionStorage`. Replaced by Supabase Auth.
- **Roles:** `types.ts` `DashboardType` — `admin`, `superadmin`, `teacher`, `parent`, `student`, `proprietor`, `inspector`, `examofficer`, `complianceofficer`, `counselor`. Reduced to `ADMIN`, `TEACHER` + permissions.
- **API client:** `lib/api.ts` (`HybridApiClient`, ~3,900 lines, ~600 domain methods) plus `lib/api/core.ts`. This is a singular shared node — it cannot be cut per-folder; it must be split per feature with parity verified.
- **Backend shape:** `routes/index.ts` mounts 98 paths across ~93 route files, ~94 controllers and ~115 services.
- **Schema:** `backend/prisma/schema.prisma` — 198 models, 57 migrations.
- **Realtime/queues:** Socket.io + Redis adapter, BullMQ, cron services, PM2, `cluster.ts`. Replaced by Supabase Realtime and selective Cron/Edge Functions.
- **Storage:** AWS S3 SDK + `fileStorage.service.ts`. Replaced by Supabase Storage.
- **PWA:** `vite-plugin-pwa`, `public/sw.ts`, IndexedDB (`dexie`/`idb-keyval`), in-app `syncEngine`. v1 keeps app-shell + read-only reference-data cache only.
- **Removed modules and their routes/components** — see `docs/srik/AUDIT.md` §5 for the full inventory with file counts.
- **PostGIS:** declared in `init-db/init-extensions.sql` but **never used** — zero geometry/geography columns in the Prisma schema and zero spatial queries. Do not add PostGIS to new schema; audit dependency before removing the extension from a legacy database.

### Known baseline failures (recorded, not regressions)

- `npx vitest run` — 1 failure, in the SaaS-subscription/Paystack test, i.e. a module scheduled for removal. Do not fix it.
- `npx vitest run --config backend/vitest.config.ts` — fails without a live database (fixtures cannot connect, so most tests skip). The legacy suite is **not** required to be green before its replacement is built; the **new Supabase tests must pass**.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
