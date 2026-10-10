# 01 — Keputusan dan precedence

## LOCKED — Identiti dan skop

SRIK ialah single-school system. `school_id` dan `branch_id` **REMOVE**. Profil sekolah boleh disimpan sebagai konfigurasi tunggal, tanpa FK tenant pada domain table.

| Perkara | Keputusan |
|---|---|
| Role asas | ADMIN, TEACHER + permission |
| Tanggungjawab khas | Permission tambahan; jangan cipta role Guru Data/Jadual/Peperiksaan |
| Login murid | Optional, bukan syarat MVP; student.user_id nullable |
| Penjaga | Schema sekarang; guardian.user_id nullable; portal kemudian |
| Finance | Masuk selepas academic core |
| PBD | Sokongan architecture sekarang; modul penuh selepas basic assessment |
| Attendance | Daily dahulu; period-level kemudian |
| Report card | Snapshot ketika publish; tidak berubah senyap apabila sumber berubah |

## LOCKED — Architecture akhir

Frontend React + Vite + TypeScript, TanStack Query, Tailwind dan React Router. Frontend di sekolah, backend Supabase Cloud. Desktop, Chromebook, mobile browser dan PWA ialah sasaran awal.

CRUD biasa melalui supabase-js/Data API + RLS. Business transaction melalui Postgres function/RPC. Secret/external operation melalui Edge Functions. Storage melalui Supabase Storage; realtime melalui Supabase Realtime. Cron digunakan jika ada keperluan sebenar.

**Precedence:** keputusan ini menggantikan cadangan terdahulu untuk KEEP Express, Prisma, Socket.io, optional Redis, BullMQ dan S3 SDK. RLS kini wajib untuk exposed tables, menggantikan cadangan lama untuk defer RLS.

| Legacy | Tindakan akhir |
|---|---|
| Express, REST controllers, custom JWT | Ganti dengan Supabase; hapus selepas parity disahkan |
| Prisma dan migrasi legacy | Ganti dengan SQL migrations baseline SRIK |
| Redis, BullMQ, Socket.io, PM2 backend | Remove daripada production target |
| S3 SDK / self-managed storage | Ganti dengan Supabase Storage |
| Backend Docker production stack | Remove; local Supabase tooling untuk development dibenarkan |
| PostGIS, tenant RLS/middleware/headers | Remove |
| Redux | Audit; remove jika server/UI state sudah diliputi Query + Context atau state kecil |
| Formik + Yup | Boleh retain sementara; RHF + Zod dicadang untuk code baru |
| Capacitor | Defer native release; retain compatibility jika murah |

## REMOVE daripada core

Hostel; scholarship marketplace; sponsorship; Nigerian compliance; TRCN; British curriculum assumptions; inspector/proprietor workflows; Paystack; Flutterwave; complex SaaS subscriptions; multi-branch; cross-school tenant admin; advanced transport; gamification XP/levels; student marketplace; AI auto-translation crawler; demo reset infrastructure.

Buang kod, routes, menu, seeds, konfigurasi dan package yang hanya menyokong feature ini setelah audit dependensi. Jangan sekadar hide menu. Konsep transport masa depan masuk roadmap, bukan MVP.

## KEEP / ADAPT

Auth; user/role/permission; guru; murid; penjaga; academic year/term; kelas/enrollment; subject/ClassSubject; teaching assignment; timetable; attendance guru/murid; assessment; report card; finance; announcements; documents; audit log.

## PROPOSED defaults yang belum dikunci dalam perbincangan

Field profil terperinci, permission scope setiap guru, polisi retention/cache, lifecycle status, grading/ranking, struktur penggal sebenar, singleton SchoolProfile dan aturan allocation/refund. Fail fasa mencadangkan aturan teknikal untuk mengelakkan ambiguity; rekod keputusan akhir sebelum implementasi.

Nama source repository dieja berbeza dalam perbincangan. Sahkan nama/revision sebenar semasa audit; jangan mendakwa telah mengaudit source hanya berdasarkan nama.
