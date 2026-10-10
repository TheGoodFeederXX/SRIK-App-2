# SRI Al-Khairiah

**Sistem pengurusan Sekolah Rendah Islam Al-Khairiah (SRIK).**

Aplikasi ini untuk satu sekolah di Kuala Nerang, Kedah: guru, ibu bapa dan
pejabat sekolah. Ia menguruskan kehadiran, markah dan kad laporan, yuran,
pengumuman sekolah, dan rekod audit.

## Untuk sesiapa yang membuka projek ini

Dokumen kerja ada dalam `docs/srik/`:

- `IMPLEMENTATION_STATUS.md` — keadaan setiap fasa, dan had yang diketahui
- `OPERATIONS.md` — sandaran, pemulihan, dan siapa boleh akses apa
- `AGENTS.md` — kontrak kerja untuk pembangun

Sila baca `docs/srik/IMPLEMENTATION_STATUS.md` dahulu. Ia menyenaraikan apa yang
sudah siap, apa yang belum, dan sebab bagi setiap keputusan yang tidak jelas.

## Menjalankan projek

```bash
npm install
npm run dev      # pembangunan
npm run build    # binaan pengeluaran
npx vitest run   # ujian
```

Log masuk menggunakan emel dan kata laluan sahaja. Tiada pilihan log masuk lain.
