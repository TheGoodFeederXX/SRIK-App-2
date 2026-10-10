# 02 — Fasa 0: Audit dan pelan refactor

## Tujuan

Peta architecture sebenar sebelum memotong legacy. Belum bina feature baru.

## Kerja

1. Semak AGENTS sedia ada, README, package manifests/lockfile, routes, schema/migrations, auth, storage, workers, PWA dan deployment.
2. Rekod branch/commit sumber, cara run, env names tanpa nilai secret, baseline typecheck/build/test dan kegagalan sedia ada.
3. Bina peta KEEP / ADAPT / REMOVE / DEFER berdasarkan 01_DECISIONS.md. Cari references school_id, branch_id, tenant headers, JWT, Prisma, Socket.io dan removed modules.
4. Peta data dan UI legacy kepada target. Kenal pasti fungsi utiliti yang dikongsi supaya penghapusan tidak mematahkan modul KEEP.
5. Tentukan boundary cutover setiap fasa. Elakkan dua auth sources atau dua write paths untuk feature yang sudah dipindah.
6. Bezakan sample/dev data daripada data production. Clean baseline ialah target; jangan reset database live atau padam migration history aktif secara automatik.

## Struktur target

```text
src/app/
src/components/
src/features/{auth,students,teachers,guardians,classes,subjects,timetable,attendance,assessments,reports,finance}/
src/lib/supabase/
src/types/
supabase/config.toml
supabase/migrations/
supabase/functions/
supabase/tests/
supabase/seed.sql
docs/srik/
```

Folder backend/modules cadangan lama tidak lagi target. Untuk feature frontend, asingkan UI, queries/hooks, schemas dan types apabila perlu; jangan wajibkan lapisan kosong. Generate database types daripada schema.

## Syarat siap

- `docs/srik/AUDIT.md` menyatakan findings sebenar dan dependency map.
- `docs/srik/IMPLEMENTATION_STATUS.md` memuatkan fasa, status, blocker dan bukti validation.
- Pelan migrasi/cutover boleh diikuti tanpa memadam data sebenar.
- Proposed decisions disenaraikan; tiada claim source feature telah dibuang sebelum kod diperiksa.
