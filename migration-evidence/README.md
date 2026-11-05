# Week 4 — Migration evidence harness

Bukti lokal untuk tiga temuan (bukan produksi):

1. Rename `amount` → `total_amount` mematahkan query app lama  
2. `CREATE INDEX` (tanpa `CONCURRENTLY`) menahan `INSERT`  
3. `down()` tidak fully reversible (CHECK `amount_nonneg` tertinggal dan data `currency` hilang; index currency ikut terhapus bersama kolomnya, jadi bukan sisa)

Bagian 2 (`prove-safe-plan.js`) mengukur sisi rencana aman: expand-only dengan klien lama,
biaya UPDATE vs default konstan, lock mode index biasa vs `CONCURRENTLY`, CHECK biasa vs
`NOT VALID` + `VALIDATE`, lock queue dengan/tanpa `lock_timeout`, `up()` dalam satu
transaksi, dan apa yang tertinggal saat step di-cancel (klaim Plan B).
Tidak mengukur replica lag, dan writer-nya bukan generator 800 insert/s yang terkalibrasi.

```powershell
node prove-safe-plan.js            # default ROW_COUNT=2000000 (butuh beberapa GB disk Docker)
$env:ROW_COUNT=500000; node prove-safe-plan.js   # kalau disk terbatas
```

## Jalankan

```powershell
cd "E:\Projectq\AI Project\AI Training Mas Simon\migration-evidence"
docker compose up -d
npm install
node prove-migration.js
```

Kalau Docker belum nyala, start Docker Desktop dulu. Port Postgres lab: **5434**.

Opsional, tabel lebih besar supaya lock index lebih kelihatan:

```powershell
$env:ROW_COUNT=200000; node prove-migration.js
```

## Yang kamu lakukan setelah run

1. Copy **seluruh** output terminal.  
2. Tempel ke chat: “ini raw log harness”.  
3. Baru minta jawaban final 1–7.

## Bukan bukti

- Staging 1.8 s  
- Smoke test di cloud tanpa raw log  
- Klaim durasi pasti di 120M rows dari lab kecil ini
