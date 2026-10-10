# 08 — Fasa 6: Operasi, PWA dan release

Foundation audit bermula Fasa 1 dan dipakai sepanjang pembangunan. Fasa ini melengkapkan operasi; jangan tangguhkan authorization/audit sehingga release.

## Documents dan announcements

Document: owner_type, owner_id, category, storage_key, mime_type, size, uploaded_by. Supabase Storage sebagai backend. **PROPOSED:** typed link tables atau explicit owner FKs untuk integriti kerana polymorphic owner_id tiada FK automatik.

Gunakan private buckets untuk dokumen guru/murid. Storage policies dan metadata policies mesti konsisten; download menggunakan authorization/signed URL jangka pendek. Validate saiz/type/owner, urus orphan upload dan cleanup apabila DB transaction gagal. Metadata delete tidak bermaksud object telah terpadam.

Announcement: audience, content, publish status/date dan author sebagai PROPOSED model. Realtime hanya untuk refresh/notifikasi diperlukan; private channel dan permission scope diuji. Jangan broadcast IC, markah atau dokumen sensitif kepada semua client.

## Audit

AuditLog: user_id, action, entity_type, entity_id, before, after, ip jika tersedia, timestamp. Fokus users/grants, markah, attendance dan finance. DB trigger/RPC atau server path authoritative; frontend bukan penulis tunggal log. Gunakan actor ID yang verified, bukan client-supplied user_id. Audit private, append-only bagi client; redact secrets dan hadkan PII snapshot mengikut keperluan. Jangan reka IP jika konteks DB tidak memilikinya.

## Frontend sekolah / PWA

Build static frontend di sekolah. Gunakan HTTPS dengan certificate dipercayai untuk LAN clients; HTTP LAN biasa bukan secure context untuk service worker/PWA. Allowlist origin/CORS/auth redirect URL yang digunakan.

V1 cache app shell dan reference data read-only terpilih. Jangan cache semua data peribadi pada shared PCs. Scope cache ikut pengguna, clear saat logout dan tunjuk stale/offline state. Internet putus: shell/cached data mungkin boleh dibuka, tetapi login baharu/data terkini/write Supabase memerlukan connectivity.

Retry bacaan dibenarkan; retry mutation mesti bounded dan idempotent apabila sudah disokong. Jangan tambah generic offline write queue secara tersembunyi. External access ke frontend LAN/portal dari rumah ialah keputusan hosting kemudian.

## Backup dan recovery

Semak plan Supabase sebenar untuk retention/backup/PITR/limits ketika production provisioning. Jangan assume Free menyediakan recovery setara paid. DB backup tidak merangkumi bytes Storage objects: backup database dan objects secara berasingan, termasuk metadata/manifest untuk restore konsisten.

Sediakan jadual external dump/export dan object copy ke destinasi berasingan, retention, access controls dan restore drill. Sasaran RPO/RTO ialah PROPOSED dan mesti dipilih sekolah. Backup berjaya bukan bukti restore berjaya. Jangan gunakan production secrets dalam repo/script log.

## Clean-up akhir dan syarat release

- Fresh database boleh dibina daripada SQL migrations + synthetic seed; generated types sepadan.
- Legacy Express/Prisma/Redis/BullMQ/Socket.io/tenant production paths dan removed-module references tidak lagi aktif; packages/config/scripts dibersihkan.
- Typecheck/build, ujian integriti/RLS/RPC dan smoke workflows utama lulus.
- Verify student/class history, attendance, markah, snapshot revision dan finance reconciliation.
- Shared-PC cache, HTTPS/PWA update, auth redirects dan network-failure UX disemak.
- Backup DB + Storage dan restore ke persekitaran terasing dibuktikan.
- `IMPLEMENTATION_STATUS.md` mencatat migration/release steps, known limitations dan rollback plan.

Deployment sebenar memerlukan target project/env yang sah dan authorization pengguna; jangan melaksanakannya berdasarkan spesifikasi sahaja.
