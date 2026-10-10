# 07 — Fasa 5: Finance selepas academic core

Prasyarat: model akademik stabil; assessment/report workflow siap sebelum finance menjadi fokus.

## LOCKED model

`FeeType → StudentCharge → PaymentAllocation ← Payment`.

Semua monetary columns NUMERIC(12,2) atau precision exact yang dipersetujui. Tiada Float. Payment RM500 boleh diagih kepada sekolah RM300, buku RM100, aktiviti RM100.

## PROPOSED field minimum

| Entity | Field |
|---|---|
| FeeType | code, name, status |
| StudentCharge | student_id, fee_type_id, academic_year_id, amount, due_date, description, status |
| Payment | payer_guardian_id optional, reference, amount, paid_at, method, recorded_by, status, idempotency_key |
| PaymentAllocation | payment_id, student_charge_id, amount |

Sahkan skop bayaran keluarga/berbilang adik-beradik, wang belum diagih, diskaun, refund, pembatalan dan nombor resit sebelum implementasi. Jangan tambah payment gateway dahulu.

## Integriti dan workflow

- `record_payment` dan `allocate_payment` ialah RPC atomic, authorized, diaudit dan idempotent.
- Allocation positif, jumlah tidak melebihi bayaran atau outstanding charge. Enforce bersama locking yang sesuai agar dua transaksi serentak tidak over-allocate.
- Outstanding/paid total berasal daripada allocation sah; elakkan counter authoritative yang boleh drift.
- **PROPOSED:** pembetulan posted transaction melalui reversal/void dengan sebab dan trace; bukan hard delete atau edit amount tanpa audit.
- Reports/resit guna nilai exact; frontend formatting tidak menjadi sumber baki kewangan.
- Finance permissions berasingan; guru biasa tidak mendapat akses automatik.

## Syarat siap

Split payment contoh berfungsi; duplicate submission tidak double-charge; concurrency allocation diuji; finance RLS deny tests lulus; baki/resit/reversal reconcile; tiada floating-point monetary path authoritative.
