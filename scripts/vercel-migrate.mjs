/**
 * NO LONGER PART OF THE VERCEL BUILD.
 *
 * ── WHY IT WAS REMOVED (2026-10-10) ──────────────────────────────────────────
 * `build:vercel` used to begin with this script. On the school's real database it
 * failed every deployment with:
 *
 *   Error: P3005 — The database schema is not empty.
 *
 * The reason is a mismatch of two different schemas:
 *
 *   - The school's schema is the Supabase SQL under `supabase/migrations/`
 *     (10 files, 36 tables). That is the source of truth per AGENTS.md, and those
 *     migrations are applied deliberately.
 *   - This script runs `prisma migrate deploy`, which reads
 *     `backend/prisma/schema.prisma` — 198 models inherited from Oliskey — and
 *     keeps its own history in a `_prisma_migrations` table.
 *
 * The school's database has no `_prisma_migrations` table, so Prisma sees a
 * populated schema it did not create and refuses to continue. It cannot be
 * baselined into agreement either: doing so would let Prisma reconcile 198 foreign
 * models against the school's real tables.
 *
 * The build now builds and ships the app and nothing else. If the database ever
 * needs a change, it is a Supabase SQL migration applied on purpose — not a side
 * effect of someone pushing a commit.
 *
 * The file is kept rather than deleted, because the reasoning above is the useful
 * part and deleting it would erase the record of why the step is gone.
 *
 * ── ORIGINAL NOTES ───────────────────────────────────────────────────────────
 * Apply Prisma migrations during a Vercel build — for PRODUCTION deployments only.
 *
 * `build:vercel` used to begin with a bare `npx prisma migrate deploy`, which ran
 * on every deployment Vercel makes, preview builds included. That is wrong in
 * both of the ways it can go:
 *
 *   - If a preview environment has no database credentials, the very first step
 *     of the build fails and the whole deployment is marked failed. Every recent
 *     preview did fail this way while production kept succeeding, including on
 *     commits that touch no backend code at all.
 *
 *   - If a preview environment *does* carry the production credentials, which is
 *     the common default, then every push to any branch ran `migrate deploy`
 *     against the live production database. A feature branch could migrate
 *     production before anyone reviewed it.
 *
 * Gating on VERCEL_ENV fixes both without changing what production does. Vercel
 * sets it to 'production', 'preview' or 'development'.
 *
 * The check is deliberately positive — migrate only when the value is exactly
 * 'production' — so an unset or unexpected value skips rather than guesses. A
 * skipped migration leaves the database untouched and is trivially recoverable;
 * a wrongly-applied one is not.
 */
import { spawnSync } from 'node:child_process';

const env = process.env.VERCEL_ENV;

if (env !== 'production') {
    console.log(`[migrate] VERCEL_ENV=${env ?? '(unset)'} — skipping "prisma migrate deploy". Migrations run on production deployments only.`);
    process.exit(0);
}

console.log('[migrate] VERCEL_ENV=production — applying pending migrations.');

const result = spawnSync(
    'npx',
    ['prisma', 'migrate', 'deploy', '--schema=backend/prisma/schema.prisma'],
    { stdio: 'inherit', shell: process.platform === 'win32' },
);

if (result.error) {
    console.error('[migrate] failed to start prisma:', result.error.message);
    process.exit(1);
}

// A non-zero exit must fail the build. A deployment whose migrations did not
// apply would otherwise serve new code against an older schema.
process.exit(result.status ?? 1);
