# 03 — Fasa 1: Supabase, auth dan authorization

Prasyarat: audit selesai. Foundation authorization mesti wujud sebelum domain API dibuka.

## Model

`auth.users → profiles`; `roles`, `permissions`, `user_roles`, `role_permissions`.

**PROPOSED tambahan:** `user_permissions` untuk grant per-user. Ini melengkapkan keperluan Guru Data yang masih TEACHER tetapi mempunyai permission tambahan; rantai role sahaja tidak menyokong pengecualian individu. V1 guna grant tambahan sahaja, tanpa deny override. Permission berkesan ialah union role grants dan individual grants. Hanya pengurus user berautoriti boleh mengubahnya; lindungi admin terakhir daripada lockout.

ADMIN menerima permissions melalui table, bukan bypass semua policy. TEACHER mempunyai baseline minimum. PARENT/STUDENT roles ditambah bila portal dibina.

## Permission contract

Gunakan satu registry konsisten: `users.view/manage`, `students.view/create/update/archive`, `teachers.view/manage`, `guardians.view/manage`, `academic_years.view/manage`, `classes.view/manage`, `subjects.view/manage`, `teaching_assignments.view/manage`, `timetable.view/manage`, `attendance.view/record/manage`, `assessments.view/create/enter_scores/publish`, `reports.view/generate/publish`, `finance.view/manage/record_payment`, `documents.view/manage`, `announcements.view/manage`, `settings.manage`, `audit.view`.

Nama tambahan dalam registry ialah PROPOSED. Jangan gunakan `students.manage` dalam satu tempat dan granular names di tempat lain tanpa pemetaan jelas.

**PROPOSED scope:** guru biasa melihat rekod akademik yang diperlukan untuk kelas ditugaskan, merekod attendance kelas dibenarkan, dan mengisi markah subjek/kelas yang diajar. Permission pengurusan boleh memberi scope lebih luas secara explicit. Permission sahaja tidak bermaksud akses semua rekod. Lindungi IC, alamat, maklumat keluarga dan dokumen sensitif daripada akses guru yang tidak perlu.

## Implementasi

- Gunakan session Supabase Auth; tiada custom password/JWT store.
- DB ialah sumber permission semasa; jangan simpan semua grants dalam JWT dan bergantung pada token stale.
- Bina authorization helper terhad dan diuji. Jika SECURITY DEFINER diperlukan, tetapkan search_path selamat, qualified object names dan EXECUTE grants minimum; revoke default PUBLIC execute untuk privileged RPC.
- Enable RLS dan grants explicit pada exposed tables. Polisi hanya bagi operasi yang diperlukan; operasi lain kekal deny.
- Pisahkan data profil biasa daripada management fields untuk mencegah self-escalation. RLS row checks tidak melindungi setiap column secara automatik.
- Uji SELECT/INSERT/UPDATE/DELETE, WITH CHECK, scope assignment, sesi tiada login dan cubaan menaikkan privilege.
- Edge Functions yang guna secret mesti verify caller dan permission sendiri; secret bypass RLS tidak membenarkan caller bebas memilih target user.
- Audit mutation role/grant dan activation user. Disabled profiles mesti ditolak walaupun JWT masih valid.

## Env

Browser: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`.

Server-only bila diperlukan: `SUPABASE_SECRET_KEY`. Semak konfigurasi runtime/CLI sebenar ketika implementasi; jangan assume variable ini disuntik automatik. Jangan masukkan secret dalam VITE prefix atau .env.example sebenar.

## Syarat siap

Login/logout/session restore berjalan; ADMIN/TEACHER bootstrap selamat; direct API calls tidak dapat memintas authorization; tiada secret dalam build; RLS allow/deny tests lulus. Rekod policy matrix dan permission defaults yang dipilih.
