# SRIK-App-2 — status sebenar

**Dokumen ini menggantikan satu dokumen lama yang tidak lagi benar.**

## Mengapa dokumen lama dibuang

Dokumen itu mendakwa ratusan jadual, sebahagian besar daripadanya tanpa RLS, berpuluh-puluh
fail route dengan ratusan endpoint, mempunyai medan pelbagai-sekolah, dan mencadangkan setiap
sekolah ditambah penanda pengenalnya sendiri. Kesemuanya menerangkan **backend Express + Prisma
yang sudah tidak wujud dan tidak pernah digunakan**. Laman yang berjalan hari ini tidak mempunyai `api/` langsung di Vercel —
setiap panggilan ke `/api` memulangkan `index.html`, bukan JSON.

Dokumen itu juga bertajuk "Oliskey School App" dan membawa tarikh 2026-05-27, jadi ia bukan
sekadar lapuk — ia menerangkan projek yang berbeza. Menyimpannya bersama dakwaan "fasa selesai"
adalah tepat apa yang dilarang oleh audit (F34): bukti lama bercampur dengan dakwaan selesai,
sehingga pembaca tidak dapat membezakan mana yang masih benar.

## Keadaan sebenar hari ini

- **Pangkalan data:** 37 jadual dalam Postgres (Supabase), bukan 196.
- **RLS:** 37 daripada 37 jadual mempunyai RLS **dipaksa** (`relforcerowsecurity`). Bukan 99%
  terdedah.
- **Pelbagai sekolah:** sistem ini untuk **satu sekolah sahaja**. Tiada `school_id`, tiada
  `branch_id`, tiada `tenant`. Satu baris `school_profile` menyimpan konfigurasi sekolah.
- **Backend:** hanya Supabase Postgres + RLS + fungsi RPC. Tiada pelayan Express yang digunakan.
- **Senarai menu:** lihat `docs/SCREEN_INVENTORY.md`. Skrin yang belum dilaksanakan memaparkan
  `ComingSoonScreen` dengan penjelasan dalam Bahasa Melayu — bukan data palsu.
- **Ujian:** suite SQL di bawah `supabase/tests/` dijalankan dalam CI oleh job "Database rules";
  ujian paparan dijalankan oleh job "Check, test and build".

## Baki kerja yang diketahui dan benar

- Perlindungan kata laluan bocor (HaveIBeenPwned) **tidak dapat dihidupkan** pada pelan
  Supabase semasa — ia memerlukan pelan Pro. Bukan pepijat dalam kod.
- Dua fungsi Edge (`provision-teacher-account`, `provision-guardian-account`) belum digunakan
  ke produksi.
- Data orang sebenar belum dimuatkan: pelajar, penjaga dan akaun log masuk guru masih kosong.
- `AttendanceRegisterScreen.tsx` masih dalam Bahasa Inggeris sepenuhnya.
- Tiada eksport PDF; kedudukan kelas tidak dilaksanakan.

## Peraturan untuk dokumen ini

Sesiapa yang menulis di sini mesti menyatakan **apa yang benar sekarang**, dan menandakan
sebarang bukti lama sebagai lama. Dakwaan "selesai" tanpa jalan untuk menyemaknya adalah
lebih buruk daripada tiada dokumen, kerana ia menghentikan pembaca daripada memeriksa.
