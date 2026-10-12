# F33 — Triage dependency: apa yang benar-benar sampai ke produksi

**Tarikh:** 12 Oktober 2026
**Penemuan audit:** F33 (P2) — "Dependency legacy membesarkan permukaan audit dan advisory"

## Apa yang audit minta

Kriteria penerimaan F33: **advisory kritikal/tinggi yang boleh dicapai (reachable) ditutup, atau
mempunyai pengecualian bersebab**; lockfile stabil.

Kunci perkataan di situ ialah **boleh dicapai**. Repositori ini mengandungi tiga perkara
berbeza, dan nasihat keselamatan mereka tidak sama:

## Keadaan sebenar (disemak 12 Oktober 2026)

```
npm audit --omit=dev   → 0 kerentanan (0 kritikal, 0 tinggi, 0 sederhana, 0 rendah)
npm audit              → 23 (2 kritikal, 14 tinggi, 3 sederhana, 4 rendah) — SEMUA dev tooling
```

**Kesimpulan: tidak ada satu pun advisory kritikal atau tinggi yang boleh dicapai oleh laman
produksi.** Kesemua 23 datang daripada alat pembangunan yang tidak pernah dijalankan pada
pelayan.

## Tiga runtime, dan apa yang setiap satu jalankan

| Runtime | Dilaksanakan? | Perintah | Dependency |
|---|---|---|---|
| **Laman awam (Vercel)** | **YA** | `vite build` sahaja | hanya `dependencies` frontend |
| Ujian CI | ya | `vitest`, `tsc` | dev tooling, dalam CI sahaja |
| Backend Express (`backend/`) | **TIDAK** | `npx tsx backend/src/server.ts` | legacy, tiada di produksi |

Vercel hanya menjalankan `npm run build` → `vite build`. Ia tidak menjalankan
`npm run start`, jadi `backend/` dan kesemua alat pembangunan **tidak dimuatkan**.

## Triase setiap advisory kritikal/tinggi

| Pakej | Tahap | Dicapai produksi? | Keputusan |
|---|---|---|---|
| `concurrently` | kritikal | Tidak — dev | **Diterima.** Alat pembangunan sahaja. |
| `shell-quote` | kritikal | Tidak — dev (tak langsung) | **Diterima.** Tidak dijalankan. |
| `@pm2/agent` | tinggi | Tidak — dev (tak langsung) | **Diterima.** Alat proses. |
| `braces`, `micromatch`, `chokidar`, `fast-glob` | tinggi | Tidak — dev (tak langsung) | **Diterima.** Kebergantungan `nodemon`/`concurrently`. |
| `ip`, `pac-proxy-agent` | tinggi | Tidak — dev (tak langsung) | **Diterima.** Alat rangkaian dev. |
| `js-yaml` | tinggi | Tidak — dev (tak langsung) | **Diterima.** Alat pembangunan. |
| `nodemon` | tinggi | Tidak — dev | **Diterima.** Pemantau fail dev. |

**Tiada satu pun yang berjalan pada laman awam.** Yang tinggal ialah tooling pembangunan
tempatan, dan satu backend Express yang **tidak pernah digunakan**.

## Mengapa backend Express masih ada

`backend/` ialah sisa seni bina lama. Ia tidak digunakan ke produksi, dan `api/` sudah dibuang
daripada Vercel. Membuang `express`/`express-rate-limit` daripada `package.json` sekarang akan
memecahkan `npm run start` yang masih dirujuk oleh pembangunan, jadi ia dikekalkan **dengan
alasan** dan diaudit oleh workflow `Dependency audit` setiap kali.

## Bila keputusan ini mesti disemak semula

- Jika `backend/` dibuang sepenuhnya, buang `express`, `express-rate-limit` dan `@types/express`
  daripada `package.json` — maka bilangan advisory akan turun lagi.
- Jika mana-mana alat dev dipindahkan ke runtime produksi.
- Jika `npm audit --omit=dev` bukan lagi **0**.

## Peraturan untuk pekerjaan seterusnya

**`npm audit --omit=dev` mesti kekal 0.** Angka itu mengukur apa yang sekolah benar-benar
gunakan. Jumlah penuh `npm audit` mengukur juga alat yang hanya pembangun gunakan, dan ia tidak
sepatutnya menjadi penghalang untuk melancarkan laman.
