# AGENTS.md

Kontrak kerja untuk repository ini.

> **Berkaitan fail lain.** `CLAUDE.md` (root) mengawal **cara bekerja dengan pemilik** — soal sebelum kod, jelaskan dalam bahasa pengguna, uji sebelum lapor, dan **polisi pemuliharaan UI** (jangan ubah UI tanpa kelulusan eksplisit). Ia kini selaras dengan skop SRIK. Fail ini mengawal **arah architecture dan skop**; jika berlaku percanggahan yang tidak disengajakan, `01_DECISIONS.md` + fail fasa ialah autoriti.

Sasaran: aplikasi pengurusan **satu sekolah** untuk Sekolah Rendah Islam Al-Khairiah (SRIK). Projek sumber Oliskey/Othiskey ialah **kod rujukan, bukan architecture sasaran**.

## Peraturan wajib

- Baca `docs/srik/01_DECISIONS.md` dan fail fasa semasa. Jangan laksanakan feature deferred tanpa perubahan skop.
- Tiada `school_id`, `branch_id`, tenant routing, pentadbiran silang-sekolah atau architecture langganan SaaS. `SchoolProfile` ialah konfigurasi, bukan tenant.
- Backend production ialah Supabase Auth, PostgreSQL, Data API, RLS, RPC, Storage, Realtime dan Edge Functions/Cron secara terpilih. Ganti Express, Prisma, custom JWT, Socket.io, Redis dan BullMQ **secara berperingkat**.
- Kekalkan frontend React/Vite/TypeScript di mana berguna. Elakkan rewrite framework yang tidak berkaitan.
- Pemeriksaan frontend menambah baik UX; authorization pangkalan data/server ialah autoriti. **Deny by default.** Uji kedua-dua permission dan record scope.
- Setiap table yang terdedah melalui Data API mesti enable RLS dan mempunyai grants eksplisit serta policies yang diuji bagi operasi yang dibenarkan. Operasi yang tidak dibenarkan mesti kekal ditolak; jangan tambah policy CRUD permisif semata-mata untuk melengkapkan senarai semak.
- Secret key Supabase tidak boleh masuk ke source frontend, pemboleh ubah `VITE_`, bundle atau log awam. Guna publishable key dalam browser.
- SQL migration ialah sumber kebenaran schema. Tiada perubahan dashboard production yang tidak dijejaki.
- Operasi perniagaan berbilang baris mesti RPC/transaksi pangkalan data yang atomik. Operasi berprivilej/external tergolong dalam Edge Function yang diautentikasi dan berautoriti bila perlu.
- Tahun akademik, kelas dan subjek adalah relasional. Kelas semasa diperoleh daripada enrollment; tiada string nama subjek sebagai pengganti foreign key.
- Wang guna NUMERIC/Decimal tepat, **tidak pernah Float**. Jangan kira jumlah bayaran autoritatif dengan aritmetik floating-point JavaScript.
- Report card yang published ialah snapshot tak boleh ubah dengan revision eksplisit. TP PBD **bukan** ditentukan secara automatik daripada markah peperiksaan.
- Audit mutasi sensitif di backend autoritatif. Client tidak boleh mengedit sejarah audit.
- Buang kod legacy yang mati **selepas** pengganti berfungsi. Jangan padam data sebenar, secret atau migration aktif tanpa mengesahkan skop dan kebenaran.
- App shell caching ialah skop v1. Penulisan offline attendance/markah dan resolusi konflik adalah **deferred**.
- Kekalkan `AGENTS.md` ringkas. Letak spesifikasi terperinci dan bukti fasa dalam `docs/srik/`.

## Penyiapan fasa

Laporkan tingkah laku yang berubah, migration, validation yang bermakna, risiko yang tinggal dan keputusan yang dicadangkan. Jangan tandakan fasa selesai selagi kriteria penerimaannya gagal. Periksa kod sebenar sebelum mendakwa mana-mana feature atau dependensi legacy telah dibuang.

## Keadaan semasa

- **Fasa 0–6 selesai** — lihat `docs/srik/AUDIT.md` dan `docs/srik/IMPLEMENTATION_STATUS.md`. `IMPLEMENTATION_STATUS.md` menyenaraikan baki yang diketahui:
  22 skrin guru masih bergantung pada API lama, Edge Function belum dideploy, data
  orang sebenar belum dimasukkan. Baca senarai itu sebelum memulakan implementasi
  baharu — "fasa selesai" bermaksud kriteria penerimaannya lulus, bukan bahawa tiada
  kerja tinggal.
- **Skema SRIK ialah `supabase/migrations/*.sql`** (36 jadual). `db:migrate`,
  `db:push` dan `db:reset` menunjuk kepada Prisma warisan dan **tidak** membina skema
  SRIK — jangan jalankannya terhadap pangkalan data SRIK.
- Baseline: frontend typecheck + build **lulus**; suite frontend **438 lulus**;
  suite SQL **188 lulus** (`supabase/tests/run_phase5_tests.sh`, PostgreSQL sebenar).
  Suite backend warisan masih tidak hijau tanpa `DATABASE_URL` — itu diketahui dan
  tidak perlu dibaiki sebelum penggantinya siap. Jangan dakwa ujian lulus tanpa
  menjalankannya.
