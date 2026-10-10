# SRIK — Pelan refactor berperingkat

Versi 1.0 · 7 Oktober 2026 · Bahasa arahan: Bahasa Melayu / English

Pakej ini menyatukan keputusan perbincangan untuk menukar projek sumber Oliskey/Othiskey kepada sistem pengurusan **Sekolah Rendah Islam Al-Khairiah (SRIK)**. Sasaran sekitar 250 pengguna. Ini spesifikasi pelaksanaan, bukan laporan audit repository: kod sumber belum diperiksa dalam tugasan ini.

## Cara guna dengan DeepSeek Harness

1. Letakkan `AGENTS.md` di root repository. Jika sudah ada, gabungkan aturan yang masih relevan; jangan menimpa arahan projek lain secara membuta tuli.
2. Letakkan fail lain dalam `docs/srik/`. Kekalkan nama fail supaya pautan relatif terus sah.
3. Baca `01_DECISIONS.md`, kemudian jalankan satu fail fasa pada satu masa mengikut jadual di bawah.
4. Minta agent merekod perubahan, keputusan tambahan, ujian dan baki kerja sebelum fasa seterusnya.
5. Jangan masukkan keseluruhan pakej dalam `AGENTS.md`; gunakan fail fasa sebagai konteks ketika diperlukan.

| Urutan | Fail | Hasil |
|---|---|---|
| Sentiasa | `AGENTS.md` | Kontrak ringkas untuk coding agent |
| Rujukan | [01_DECISIONS.md](01_DECISIONS.md) | Keputusan terkini dan skop |
| Fasa 0 | [02_PHASE_0_AUDIT.md](02_PHASE_0_AUDIT.md) | Audit sumber, pelan potong dan peta dependensi |
| Fasa 1 | [03_PHASE_1_SUPABASE_AUTH.md](03_PHASE_1_SUPABASE_AUTH.md) | Supabase, auth, permission, RLS |
| Fasa 2 | [04_PHASE_2_ACADEMIC_CORE.md](04_PHASE_2_ACADEMIC_CORE.md) | Profil dan model akademik relational |
| Fasa 3 | [05_PHASE_3_TIMETABLE_ATTENDANCE.md](05_PHASE_3_TIMETABLE_ATTENDANCE.md) | Jadual serta kehadiran harian |
| Fasa 4 | [06_PHASE_4_ASSESSMENTS_REPORTS.md](06_PHASE_4_ASSESSMENTS_REPORTS.md) | Assessment dan report card snapshot |
| Fasa 5 | [07_PHASE_5_FINANCE.md](07_PHASE_5_FINANCE.md) | Caj, bayaran dan allocation |
| Fasa 6 | [08_PHASE_6_OPERATIONS_RELEASE.md](08_PHASE_6_OPERATIONS_RELEASE.md) | Dokumen, pengumuman, PWA, backup dan release |
| Kemudian | [09_DEFERRED_ROADMAP.md](09_DEFERRED_ROADMAP.md) | PBD penuh, portal, offline write dan modul tambahan |

## Status arahan

- **LOCKED**: keputusan pengguna atau hala akhir yang telah dipersetujui dalam perbincangan.
- **PROPOSED**: detail pelaksanaan yang melengkapkan keputusan, bukan keputusan pengguna terdahulu. Sahkan dalam reka bentuk fasa sebelum menjadikannya kontrak kekal.
- **DEFERRED**: jangan bina sekarang; kekalkan laluan pengembangan yang munasabah.

Fail bernombor ialah urutan pembangunan, bukan arahan menjalankan semua fasa serentak. Jangan deploy, memadam production data atau menganggap akses Supabase tersedia hanya kerana pakej ini wujud. Pakej ini menyediakan arahan; ia tidak menjalankan refactor.

## Prompt untuk memulakan

> Read AGENTS.md and docs/srik/01_DECISIONS.md. Execute only docs/srik/02_PHASE_0_AUDIT.md. Inspect the actual repository before changing architecture. Record dependency findings, conflicts, proposed defaults and acceptance evidence. Do not implement later phases yet.

Untuk fasa seterusnya, tukar nama fail dalam prompt dan pastikan syarat siap fasa sebelumnya dipenuhi.
