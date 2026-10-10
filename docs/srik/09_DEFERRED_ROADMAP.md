# 09 — Roadmap selepas core

Fail ini bukan backlog yang mesti disiapkan sebelum release v1.

| Modul | Sokongan sekarang | Pelaksanaan kemudian |
|---|---|---|
| PBD penuh | AssessmentResult.tp/comment; boundary academic term | LearningStandard, PBDRecord, evidence dan professional judgment workflow |
| Parent portal | Guardian + StudentGuardian; user_id nullable | Linked-child scope, report/download dan baki yuran; PARENT role |
| Student login | Student.user_id nullable | Akaun optional dan STUDENT role, scope diri sendiri |
| Offline attendance/marks | PWA shell + read-only cache | IndexedDB pending ops, operation IDs, reconnect/re-auth, conflict handling dan audit |
| Discipline | Tiada table wajib dalam v1 | student, category, severity, description, action_taken, recorded_by, date |
| SEGAK | Jangan campur field dalam Student | SegakAssessment: student, academic_year, height, weight, bmi, step_test, push_up, sit_and_reach, score; sahkan ujian/norma sekolah rendah semasa |
| Transport | Tiada advanced transport core | Vehicle, Route, Driver, StudentTransport bila diminta |
| Native app | Retain Capacitor compatibility jika mudah | Android/iOS build dan distribution |
| Timetable generation | Manual editor + validation | Solver selepas requirements, combined classes, teacher availability dan room rules lengkap |
| Heavy background work | RPC/Edge/Cron hanya bila perlu | Queue/worker dipilih apabila workload melebihi platform limits |

## Aturan pengembangan

Jangan memulihkan tenant/school_id/branch_id atau legacy hostel/gamification hanya untuk future-proofing. Keputusan skop baharu memerlukan design revision.

PBD perlu evidence dan pertimbangan guru; jangan menggantikan TP dengan formula markah. Norma SEGAK dan dasar sekolah perlu disahkan daripada rujukan semasa ketika modul itu dibina.

Offline write memerlukan konflik yang explicit: tentukan siapa menang, concurrency/version checks, status sync per-operation, payload minimum dan retention pada shared devices. Jangan menganggap last-write-wins sentiasa sesuai untuk markah/bayaran.

Portal penjaga bukan sekadar menu tambahan: uji linked-child access, consent/contact changes dan user link verification. Data profil penjaga sudah wujud tidak bermaksud semua penjaga boleh login secara automatik.
