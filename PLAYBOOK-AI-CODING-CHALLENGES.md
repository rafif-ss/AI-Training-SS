# Playbook v2 — AI Coding Challenges (Week 5 dst.)

> v2, 5 Nov 2026. Disusun ulang setelah membaca laporan + kunci jawaban Week 1–4.
> Skor Rafif: W1 9 · W2 9 · W3 10 · W4 10. Skor tertinggi tiap week: 11 · 11 · 11 · 12.
> Critical thinking sudah 3 hampir selalu. Selisihnya ada di **Exploration, Grit, Creativity**. v2 menargetkan tiga itu.

Pakai tiap week: `@PLAYBOOK-AI-CODING-CHALLENGES.md` (Claude Code maupun Cursor).

---

## 0. Kartu cepat (baca ini dulu, 1 menit)

1. **Aku yang menjalankan harness.** AI menulis skrip, aku run dengan `Tee-Object`, aku tempel log. Run oleh AI memotong nilai Exploration dan wajib dilabeli.
2. **Setiap angka punya label:** `RUN by Rafif on <mesin, versi, data>` · `DERIVED (rumus)` · `NOT RUN`. Angka tanpa label dianggap belum terbukti.
3. **Hitung budget dari fakta soal** sebelum membuka tool apa pun. Sering itu saja sudah mendiskualifikasi desain AI.
4. **Kode lama harus GAGAL** di harness (kriteria tertulis). Run kontrol harus lulus. Tiap bug yang dikembalikan menyalakan gate-nya sendiri, lalu positive control hijau.
5. **Ulang run kunci ≥3 kali** (timing: 1 warm-up + ≥5 run). Statistik dihitung skrip, bukan diketik tangan. Laporkan run yang gagal atau dibuang.
6. **Kalibrasi beban:** cetak laju yang benar-benar tercapai dan RTT yang terukur. Beban yang tidak tercapai bukan bukti.
7. **Cek tetangga kode:** replica, kode lama saat rollout, prepared statement, transaksi panjang, pembaca/penulis lain. Jalankan satu, atau tulis `NOT RUN` plus perintahnya.
8. **Tulis prediksi sebelum run**, lalu laporkan yang meleset.
9. **Uji follow-up prompt di sesi AI baru** (tanpa konteks), jalankan hasilnya melawan gate-ku, catat koreksinya. Prediksi juga balasan AI yang cacat.
10. **Prompt bergerbang:** Round 1 = budget + harness saja → STOP. Aturan lulus = hitungan pasti. Ada BANNED, AUTOMATIC REJECTION, dan slot "other defects".
11. **Jawaban final:** English, tanpa tabel (tidak bisa disalin ke chat), suaraku sendiri, tanpa secret atau data produksi di prompt.
12. **Plan B berurutan:** ada angka pemicu, ada keadaan aman ("feature off", bukan `down()`), ada prosedur cancel konkret.

---

## 1. Diagnosis: kenapa belum tertinggi

Dari kolom "Improve" laporan dan rubrik di kunci jawaban:

- **Exploration** 2, 2, 2, 3.
  - W1: "observed on PostgreSQL 17.6" tanpa output.
  - W2: stand-in; baris "HTTP status: 401" datang dari skrip yang tidak menyalakan Express.
  - W3: semua run dilakukan AI dan percobaan konkurensi hang.
  - W4 sudah 3.
- **Grit** 2, 2, 2, 2.
  - Run tunggal, 4 writer tight-loop, baris 57 byte.
  - Plan B W2 hanya empat kalimat.
  - W1: tidak ada rencana setelah fix gagal.
  - Tidak ada repeat, drill, atau audit harness sendiri.
- **Creativity** 2, 2, 3, 2.
  - W3 dapat 3 karena daftar shortcut yang akan dicoba AI.
  - W4 hanya 2: tidak ada mutan, tidak ada tes prompt di AI baru, tidak ada prediksi.
- **Cakupan temuan** (✓ penuh dari total): W2 7/14, W3 12/18, W4 14/19. Yang paling tinggi 13/14, 16/18, 17/19.
- **Label siapa-yang-run** adalah titik lemah terbesar tim di W4 ("the developer" tidak menyebut siapa).
- **Kesalahan kecil yang dicatat:** median ditulis 9,61 padahal dari sepuluh nilai hasilnya 9,555; meminta test secret ditempel ke prompt; prompt "include only"; `IF NOT EXISTS` yang melewatkan INVALID index; teks yang terlihat seperti output AI mentah.

Yang dilakukan peserta bernilai 12/12 (W4):
- **Faza:** menambah hot standby + query dashboard + prepared statement ke rig; 36 prediksi sebelum run; lock-queue dijalankan 5× dan 7×.
- **Amirul:** menjalankan semuanya sendiri; mutan masing-masing merah di gate-nya; mengirim prompt ke chat baru lalu menjalankan hasilnya; 8 exit path.
- **Andre:** tangga versi v0–v5; memprediksi balasan AI yang salah dan menulis prompt ronde 2 untuknya; audit harness sendiri; reviewer sesi baru menemukan leak.

---

## 2. Rubrik: apa yang membuat nilai 3

- **Critical thinking 3** — tolak semua klaim dengan *mekanisme*; pisahkan fakta soal / fakta rig / turunan / tebakan; sebut yang tidak diketahui beserta pemiliknya.
- **Exploration 3** — harness dengan traffic realistis; kode asli terbukti gagal di dalamnya; output mentah ditempel; lebih dari satu hipotesis diuji; *aku yang menjalankan*.
- **Grit 3** — repeat; run gagal tetap dilaporkan; aturan lulus berupa hitungan pasti; Plan B berurutan dan di-drill; cacat harness sendiri dicari dan diperbaiki.
- **Creativity 3** — mutan + positive control; prediksi balasan AI yang cacat; prompt diuji di AI baru; prediksi sebelum run; jalur lain (misal tabel samping tanpa DDL); minta fakta ke pemilik tanpa data.

Jangan lupa satu hal: **angka boleh diekstrapolasi** asal berlabel `DERIVED` dengan rumus dan rentang dari ≥2 basis (contoh Tsaqib: 60× baris vs 148× ukuran → 170–420 GB). Jangan pernah ditulis sebagai hasil run.

---

## 3. Format jawaban (wajib, English)

1. **VERDICT**
   - Baris pertama: `SIMULATED` atau `REAL` + siapa yang run + rig singkat (versi, ukuran data).
   - Baris kedua: satu kata `NO` atau `YES`. Jangan campur dengan "conditional approval".
   - Lalu tolak klaim AI dengan kutipan exact dan mekanisme.
2. **ISSUES FOUND** — bullet bernomor, urut P1 → P3. Format: `Line N — problem — impact — evidence label`. Kelompokkan, jangan tabel.
3. **FOLLOW-UP PROMPT** — pakai skeleton di bagian 5.
4. **EVIDENCE REQUIRED** — apa yang diminta dari AI *dan* apa yang sudah aku jalankan (log mentah, siapa, data apa) atau `NOT RUN`. Sertakan skrip (bukan "attached").
5. **VERIFICATION PLAN** — reproduksi gagal → bukti fix → Plan B (template bagian 6).
6. **CONFIDENCE** — per klaim. High hanya untuk yang aku run. Low untuk produksi.
7. **What I accepted / changed / rejected** — paragraf atau bullet, termasuk koreksi atas diriku sendiri.

Aturan format: tanpa tabel di jawaban final; blok kode boleh; satu ide per bullet; baca ulang dengan suara sendiri dan buang frasa yang terasa seperti AI.

---

## 4. Alur kerja

Estimasi waktu (sesuaikan dengan deadline): A 20 mnt · B+C 40 mnt · D+E 90–120 mnt · F 30 mnt · G 30 mnt · H 20 mnt.

### Step 0 — Pre-flight (5 mnt, sekali tiap week)

Kegagalan lab W4 terjadi di sini: disk C: 0 GB → Postgres crash saat fdatasync → run pertama 10 detik tidak bisa direproduksi.

```powershell
Get-PSDrive C,E | Select Name,@{n='FreeGB';e={[math]::Round($_.Free/1GB,1)}}   # sisakan ≥ 20 GB
docker ps                      # harus langsung menjawab; kalau menggantung: restart Docker Desktop, lalu `wsl --shutdown`
docker compose up -d
```

- Mulai dari ukuran kecil, naikkan bertahap (50k → 500k → ...). Jangan langsung ukuran penuh.
- Catat run yang crash. Itu *dilaporkan*, bukan disembunyikan.
- Satu folder per week: `weekN-evidence/` berisi `prove-*.js`, `run-*.log`, `README.md`, `FINAL-ANSWER.md`.

### Step A — Baca soal tanpa AI (20 mnt)

Tulis di notes:

1. **Kalimat exact klaim AI** yang aku tolak.
2. **Jebakan:** benchmark kecil? tes hijau buatan AI? "temporary" bypass? "atomic"? "zero downtime"?
3. **Constraint:** no prod, no paid tools, sample apa yang ada, siapa pemilik fakta yang tidak ada.
4. **Tabel dunia-vs-produksi** (bullet): dunia klaim AI vs dunia nyata (ukuran data, traffic, versi kode, replica, versi framework). Ini inti W3 dan W4.
5. **Budget dari fakta soal:** rumus → angka → lulus/gagal. Contoh: baris × ukuran vs memori; 1 + distinct × RTT vs batas gateway; rate × durasi vs gagal.
6. **Daftar UNKNOWN + pemilik** (Step 0 Rafif W4 yang dipuji). Contoh: versi PostgreSQL, mode runner, versi Express, aturan login, aturan finance, settings replica.
7. **Temuan awalku**, bullet kasar.
8. **Jalankan 10 pertanyaan tetangga** di bawah ini.

**10 pertanyaan tetangga** (isu yang berulang tiap week dan paling sering kulewatkan):

1. **Exit path:** apakah setiap jalur mengakhiri transaksi/respons? Error sebelum vs sesudah byte pertama? Async error di Express 4 mematikan proses, di Express 5 jadi 500.
2. **Resource:** pool habis? klien putus menghentikan kerja? ada batas paralel? ada `statement_timeout`/`lock_timeout`/timeout pool? Retry memperburuk beban?
3. **Bentuk memori:** baris × lebar di memori, buffering vs streaming, backpressure (`drain` *dan* `close`).
4. **Kebenaran data:** escaping, formula injection, NULL/orphan, default yang salah arti, lebar `numeric`, aturan bisnis yang belum diputuskan.
5. **Konkurensi:** race, snapshot/read skew di paging, baris yang ditulis kode lama saat backfill, idempotency lewat UNIQUE di database.
6. **Deploy/tetangga:** kode lama saat rollout, replica/standby (cancel query, lag), prepared statement bernama, dashboard/BI pembaca kolom, penulis lain.
7. **Gagal di tengah:** apa yang tersisa di tiap langkah? `down()` membuang data? bisa di-run ulang? cancel meninggalkan INVALID index?
8. **Keamanan:** fallback secret fail-open, auth di rute, 404 vs 409 membocorkan kode, rate limit, secret di prompt, bypass "sementara".
9. **Proses:** tes ditulis AI yang sama (melingkar)? benchmark di sistem yang salah? ada kontrol yang bisa gagal? ada pemilik untuk tiap unknown?
10. **Validasi input:** parameter dari query (`since`), field yang tidak dijaga (`order_id`), tipe event.

### Step B — Prompt pembuka ke AI

```text
@PLAYBOOK-AI-CODING-CHALLENGES.md

WEEK N — <paste soal lengkap>

Temuan awalku (validate / attack / extend. Jangan tulis jawaban final):
- ...

GIVEN (tag tiap baris):
[CHALLENGE FACT] ...
[UNKNOWN - owner: ...] ...
[MY RIG - not production] ...

Yang aku mau sekarang (hanya ini):
1. Serang temuanku: mana kuat, mana lemah/overclaim, mana kurang.
2. Tambah isu yang aku miss (grouped, singkat). Pakai 10 pertanyaan tetangga di playbook.
3. Sebut docs yang harus dibuka.
4. Rencana harness: bug lama gagal, run kontrol lulus, tetangga yang perlu ada. Tulis skripnya, tapi JANGAN jalankan. Aku yang run.
5. Prediksi: tulis 5–10 hasil yang kamu harapkan (angka/outcome) sebelum aku run.
```

### Step C — Docs dulu, baru teori

Buka docs sesuai versi yang dipakai, kutip 3–5 bullet yang mengubah verdict atau fix. Jangan mengarang nama header/API dari ingatan. Kalau perlu kutipan docs provider, **tempel teksnya sendiri ke prompt** (Tsaqib). Jangan minta AI "quote docs" yang tidak ia punya.

- **Transaksi / race / kuota:** PostgreSQL *Transaction Isolation* (Read Committed), *Explicit Locking* (row-level), `UPDATE … WHERE … RETURNING`, unique violation `23505`.
- **Migrasi / DDL:** *ALTER TABLE* (default konstan, `NOT VALID` / `VALIDATE`), *CREATE INDEX* (`CONCURRENTLY`, INVALID index), *Explicit Locking* (lock mode apa memblokir apa), `lock_timeout`, `pg_blocking_pids`. Replica: *Hot Standby* query conflicts, `max_standby_streaming_delay`, `hot_standby_feedback`.
- **Webhook / signature:** docs provider (ditempel manusia), `express.raw` + urutan middleware, `crypto.timingSafeEqual` (cek panjang), error body-parser.
- **Performa / export:** `EXPLAIN (ANALYZE, BUFFERS)`, cursor (`DECLARE`/`FETCH`), `COPY` (tidak menerima bind parameter), backpressure stream, RFC 4180, CSV/formula injection.
- **Pool / timeout:** node-postgres Pool (`connectionTimeoutMillis`, `client.release(err)`), `statement_timeout`, `idle_in_transaction_session_timeout`.
- **Express 4 vs 5:** perilaku error di handler async.

### Step D — Harness: aku yang run

Aturan harness:

- **D1. Header provenance** dicetak skrip: `RUN by`, host, versi (Node, Postgres, framework), tanggal, ukuran data, beban target *dan tercapai*.
- **D2. Aku yang run, AI hanya membaca log yang kutempel.**
  - Simpan: `node prove-x.js | Tee-Object run-x-<ukuran>.log`
  - Kalau AI ikut menjalankan sesuatu: tulis `RUN by <AI> under my approval`, lalu jalankan ulang skenario kunci sendiri.
- **D3. Kontrol:** kode lama harus gagal dengan kriteria tertulis. Run kontrol (no-op / tanpa migrasi) harus lulus.
- **D4. Kalibrasi:** cetak laju tercapai dan RTT terukur. Kalau laju < target (contoh Tsaqib 383/s vs 800/s), perbaiki lab dulu dan tulis jujur.
- **D5. Tangga ukuran:** minimal 3 ukuran supaya bentuk kegagalan terlihat (W3: crash mulai ±110k baris).
- **D6. Repeat:** ≥3 per klaim kunci. Timing: 1 warm-up + ≥5, lapor min/median/max. Lapor run yang dibuang dan alasannya.
- **D7. Verifier independen:** SQL `SUM/COUNT`, parser CSV terpisah, `pg_locks`, `pg_stat_activity`, `pg_blocking_pids`, `EXPLAIN`. Jangan memverifikasi dengan logika kode yang sama.
- **D8. Tetangga:** minimal satu run dengan tetangga (hot standby + query panjang, prepared statement, kode lama, transaksi panjang). Atau `NOT RUN` + perintah persisnya.
- **D9. Eksekusi nyata:** tes harus menyentuh route/kode asli (nyalakan Express), bukan salinan logikanya.
- **D10. Statistik oleh skrip**, jangan diketik tangan.
- **D11. Simpan log mentah dan sertakan skripnya** di jawaban.

```js
// evidence.js — tempel di tiap harness
const os = require('os');
function header(extra = {}) {
  console.log(`RUN by: <nama> | host: ${os.hostname()} | node ${process.version} | ${new Date().toISOString()}`);
  console.log(JSON.stringify(extra)); // versi PG, ROW_COUNT, beban target, beban tercapai
}
function stats(xs) { // median genap = rata-rata dua nilai tengah (bug W3: 9,61 vs 9,555)
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return { n: s.length, min: s[0], median: s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2, max: s[s.length - 1] };
}
module.exports = { header, stats };
```

### Step E — Mutan, prediksi, balasan AI yang cacat

- **E1. Prediksi dulu.** Tulis `predictions.md` *sebelum* run: 5–10 baris "kalau X maka Y (angka)". Setelah run: berapa tepat, berapa meleset, kenapa (Faza 36/2 meleset; Nabiel 11 tepat, 2 gagal, 1 sebagian).
- **E2. Mutan:** kembalikan tiap bug satu per satu. Hanya gate yang terkait yang merah, dan setelahnya positive control hijau. Kalau gate kunci mutan tidak merah, yang rusak adalah tesnya.
- **E3. Prediksi balasan AI yang salah** (Andre). Tulis versi v1 yang akan dibuat AI setelah follow-up-ku. Buktikan v1 lolos tes lama tapi gagal di hal lain (contoh W4: lock test hijau tapi 9.640/9.640 insert gagal). Siapkan prompt ronde 2 untuknya.
- **E4. Audit harness sendiri:** daftar cacat rig (beban tidak tercapai, lebar baris, run tak terjelaskan, siapa yang run). Menulisnya mendapat kredit, menyembunyikannya tidak.

### Step F — Uji prompt di AI baru

1. Buka sesi **baru tanpa konteks**, idealnya model/tool berbeda dari yang dipakai menyusun prompt.
2. Berikan **hanya**: soal + follow-up prompt + file gate/harness. Jangan berikan solusi referensiku.
3. Jalankan kode yang dikembalikan **melawan gate-ku** (aku yang run).
4. Catat koreksi yang harus kuberikan (Amirul: 5 koreksi). Itu masuk bagian 7.
5. Kalau waktu mepet: minimal minta sesi baru "break R1–Rn" pada kode akhir. Reviewer sesi baru menemukan leak yang tidak ditemukan suite Andre.

### Step G — Draft jawaban final

```text
Tulis jawaban final format 1–7 dalam English, tanpa tabel.
Pakai HANYA angka dari log yang kutempel. Jangan menghitung ulang angka dari ingatan.
Baris pertama Verdict: SIMULATED/REAL + siapa run + rig. Baris kedua: NO/YES saja.
Tiap klaim berlabel RUN by Rafif / DERIVED (rumus) / NOT RUN.
Tolak fake fix week ini: <sebutkan>. Sertakan Plan B bergerbang dan What I do not know.
```

### Step H — Serang draft, lalu checklist

```text
Attack draft ini. Cari: overclaim, pass rule keliru ("at most N", "count < max"), prompt "include only",
bukti yang hanya print statement, angka yang tidak cocok dengan log (hitung ulang), label siapa-yang-run yang kabur,
frasa yang terdengar seperti output AI. Beri patch kalimat saja.
```

Checklist akhir ada di bagian 11.

---

## 5. Follow-up prompt skeleton v2 (isi lalu tempel)

```text
You said: "<exact AI claims, verbatim>".
I reject all of them. <One-sentence principle: judged by what it does to the real traffic, data and code, not by a run on a small idle system.>
Do not defend it with another small run.

GIVEN (tagged; tell me before you continue if anything contradicts it):
[CHALLENGE FACT] <numbers only; do not soften them>
[BUSINESS] <deadline, what must not break>
[UNKNOWN - name who can answer] <version, runner mode, auth, replica settings, ...>
[MY RIG - not production] <versions, rows, load actually reached, who ran it, on what data>
Constraints: <from the task>. Placeholders only (<DB_URL>, <SECRET>). Never ask me for real data or credentials.
Any new dependency needs one line of justification and a no-dependency alternative.

ROUND 1 - budget and harness only. NO fix. Then STOP and wait for my OK.
 1. Budget from the facts above: formula, number, pass/fail against each limit.
 2. For every step/line: mechanism, what it blocks or breaks, O(1) or O(rows), effect on old code and on neighbours, what is left if it fails there.
 3. Harness: <local setup>; realistic traffic; neighbours (<replica / old code / prepared statements / long transaction>); per-operation log; measured RTT and achieved load printed.
 4. Run the CURRENT code and a control run with nothing changed. Report per step: time, failed operations, max wait, resource.
 5. Pass rules, exact counts (never "at most N"): <list>.
 6. Controls: the SAME harness must FAIL the current code. Put each bug back: only its gate goes red, each followed by a passing positive control, so a harness that rejects everything cannot pass.
BANNED: <run it at night | bigger timeout | raise memory/heap | one big transaction | LOCK TABLE | small-sample timing as proof | temporary bypass>.
AUTOMATIC REJECTION: a rule written "at most N"; a test that cannot fail; a pass without traffic; "safe", "atomic" or "zero downtime" without the mechanism and the worst case; a test that copies the code's own logic.
Other defects: after the main work, list other defects you noticed in at most 5 lines. Do not widen scope.
Label every number RUN by <who> on <data>, DERIVED (formula) or NOT RUN, your own claims included.
End with "What I do not know". Paste real output. STOP.

ROUND 2 (after my OK) - the smallest safe change only, one step per file, re-runnable, with timeouts and a retry path. <rules specific to this week>.
ROUND 3 - mutants, rollback/cancel behaviour, and a Plan B drill: show what is left behind after a cancel.
```

Catatan: tempelkan teks docs provider *sendiri* bila AI harus mengutipnya. Jangan taruh secret atau data nyata di prompt.

---

## 6. Plan B (template, urut)

1. **Deteksi** — query/metrik + ambang angka (contoh: ≥5 waiter lebih dari 5 s; p99 insert > 2 s; 5xx > 1%).
2. **Tahan** — jeda rollout / matikan fitur lewat flag. Target rollback adalah **"feature off"**, bukan `down()` atau kode lama yang mungkin sudah rusak.
3. **Hentikan penyebab** — prosedur cancel konkret: cari pemblokir (`pg_blocking_pids`), batalkan sesi *migrasi/job* dulu (`pg_cancel_backend`, baru `pg_terminate_backend` bila diabaikan). Jangan sesi aplikasi. Kalau laporan yang memblokir, hentikan laporan itu.
4. **Periksa sisa** — apa yang sudah ter-commit, apa yang tertinggal (INVALID index, constraint NOT VALID, kolom yang sudah dibuat, data yang sudah berubah).
5. **Keadaan aman** — definisikan: skema/data yang kompatibel dengan kode lama *dan* baru, fitur baru mati.
6. **Kalau fix AI gagal dua kali** — ubah pertanyaannya, bukan susunan katanya. Tulis inti ±30–40 baris dari docs sendiri; harness yang sama menjadi hakim; sesi baru mencoba mematahkannya. **Potong cakupan, bukan keselamatan.**
7. **Kalau deadline mepet** — kirim subset minimal di balik flag. Jangan kirim versi asli.
8. **Eskalasi** — tempel keluaran (`pg_stat_activity`, `pg_locks`, log) ke pemilik; sebut siapa pemilik tiap unknown.
9. **Drill terukur** — ukur waktu cancel, backlog habis berapa lama, skema berubah atau tidak. Angkanya masuk jawaban.

---

## 7. Aturan bukti (non-negotiable)

1. `RUN by Rafif on <data>` — ada perintah, output, lingkungan.
2. `RUN by <AI> under my approval` — boleh, tapi sebut apa yang kuperiksa sendiri.
3. `DERIVED (rumus)` — hitungan dari fakta atau hasil run; beri rentang dari ≥2 basis.
4. `REASONED` — kesimpulan dari kode/docs; tulis begitu.
5. `NOT RUN` — belum dijalankan; tulis perintah yang akan menjalankannya.
6. Jangan menulis output yang tidak kujalankan.
7. Skrip stand-in / provider tiruan / loop in-memory = demo, bukan produksi. Tulis `SIMULATED` di baris pertama Verdict.
8. Kontrak buatan sendiri tidak boleh disebut "real".
9. Kalau estimasi meleset setelah run nyata, **koreksi angkanya di jawaban** dan sebut koreksinya.
10. Kalau run crash atau dibuang (disk penuh, noise), laporkan dan sebut kenapa.
11. Jangan klaim *High* untuk hal yang `NOT RUN`.

---

## 8. Larangan (hal yang memotong nilai di W1–W4)

- Prompt "include only …" yang menutup isu lain. Beri slot "other defects, ≤5 lines".
- Pass rule keliru: `count < max` (harus tepat), "at most N" (server kosong ikut lulus).
- "Observed / reproduced" tanpa log.
- Meminta AI "quote docs" yang tidak ia punya. Tempel docs sendiri.
- Meminta AI "confirm" skema atau fakta yang tidak ia lihat. Jadikan UNKNOWN + pemilik.
- Menyebut kontrak buatan sendiri "real". GIVEN yang mencampur fakta soal dengan fakta rig.
- Menyetujui dependency tanpa satu baris justifikasi + alternatif tanpa dependency.
- Median/statistik diketik tangan.
- Test secret atau data nyata ditempel ke prompt.
- Delapan permintaan dalam satu langkah tanpa gerbang.
- Keyset paging di statement terpisah tanpa snapshot (atau tanpa tes read-while-writing).
- Menaikkan timeout / heap / memori sebagai "perbaikan".
- Mengisi data historis dengan aturan yang belum diputuskan (backfill country → currency).
- `IF NOT EXISTS` pada `CREATE INDEX CONCURRENTLY` tanpa cek `indisvalid`.
- Plan B yang hanya berkata "jangan cancel" tanpa prosedur.
- Skrip "attached" tapi tidak ada di jawaban.
- Verdict yang mencampur REJECT dengan "conditional approval".
- Teks mentah AI tanpa disunting. Reviewer bisa melihatnya.

---

## 9. Perpustakaan temuan (tanda **[R]** = Rafif terlewat atau hanya sebagian)

**W1 — Coupon / concurrency**
- Race `COUNT` lalu `INSERT` di READ COMMITTED; conditional `UPDATE … WHERE … RETURNING`; `UNIQUE(coupon_id,user_id)`; `23505 → 409`.
- 404 tanpa ROLLBACK dan `release()` mengembalikan koneksi dengan transaksi terbuka.
- Tes AI berjalan satu-satu (melingkar).
- **[R]** `pool.connect()` di luar `try`.
- **[R]** ROLLBACK bisa gagal; `release(err)`.
- **[R]** Semua error jadi 500, tidak ada log; status 503 untuk overload.
- **[R]** Pool dan timeout.
- **[R]** Transaksi panjang.
- **[R]** 404 vs 409 membocorkan kode.
- **[R]** Timeout setelah COMMIT (idempotency).
- **[R]** Unknown: `auth`, `coupons.code` UNIQUE.
- Pass kuota: tepat `max` baris.

**W2 — Webhook**
- HMAC atas `JSON.stringify` (byte asli hilang); header/encoding/prefix tebakan; fallback `dev-secret`; bypass; `catch` balas 200; tes melingkar; tidak idempotent.
- **[R]** Event type tidak dicek.
- **[R]** Amount dan currency tidak dicocokkan.
- **[R]** `order_id` tanpa guard (TypeError ditelan jadi 200).
- **[R]** 401 sama untuk semua sebab, tanpa log.
- Sebagian: `timingSafeEqual` tanpa cek panjang → RangeError → proses mati di Express 4; jendela timestamp; `express.raw` hanya `application/octet-stream`, urutan middleware, `verify` melempar 403.

**W3 — Benchmark / export**
- Benchmark salah dunia; "linear" menyembunyikan dua penggerak (customer vs baris); `SELECT *`; buffering; N+1 ≈ 60 s; tanpa escaping; formula injection; customer hilang; klien putus; kegagalan setelah byte pertama; index.
- **[R]** Snapshot tunggal (read skew).
- **[R]** `??=` memperlakukan NULL sebagai cache miss.
- **[R]** Tidak ada cek login.
- Sebagian: validasi `since`, cap paralel + `statement_timeout`, kontrol/mutan.

**W4 — Migrasi**
- Klaim staging; `lock_timeout` + antrean lock; mode runner; tidak atomik/re-runnable; UPDATE seluruh tabel; country ≠ currency; baris pod lama saat backfill tetap USD; plain index; RENAME; CHECK tanpa NOT VALID; `down()` bukan kebalikan; CIC butuh langkah sendiri; Plan B.
- **[R]** Prepared statement bernama → `0A000` setelah `ADD COLUMN`.
- **[R]** Laporan mencampur mata uang; lebar `numeric(12,2)`.
- Sebagian: DEFAULT `'USD'` permanen; replica membatalkan query dashboard; kontrol selain "kode asli gagal".

**Pola lintas week** (kemungkinan muncul lagi): klaim AI percaya diri + bukti dari sistem yang salah; kode lama berjalan berdampingan dengan yang baru; kegagalan diam-diam (status 200, data salah, label salah); tetangga yang tidak terlihat di soal (replica, dashboard, BI, retry provider).

---

## 10. Pernyataan "penggunaan AI" (template, singkat)

Dipakai tiap week. Tulis hanya yang benar, dari sudut pandangku.

```text
AI yang digunakan: <tool + model per tahap>.
1. Konteks & batasan: <apa yang kuberikan sejak awal: soal, folder kerja, playbook, batasan>.
2. Aku minta bukti yang bisa diulang, bukan klaim: <harness apa, di mana>.
3. Yang kujalankan sendiri: <perintah, mesin, ukuran data>. Log terlampir. <Bila AI yang run: sebut dan apa yang kucek sendiri.>
4. Yang meleset dan kukoreksi: <angka/klaim yang berubah setelah run>.
5. Review akhir: <model/sesi baru dan temuannya>.
6. NOT RUN: <daftar singkat>.
```

---

## 11. Checklist sebelum submit

- [ ] Verdict: baris 1 `SIMULATED/REAL` + siapa run; baris 2 satu kata; menolak klaim exact.
- [ ] Budget dari fakta soal ada dan menyebut angka.
- [ ] Issues bernomor baris, ada label bukti, tetangga dicek (10 pertanyaan).
- [ ] **Aku yang menjalankan** skenario kunci. Log asli ditempel. Skrip disertakan.
- [ ] Repeat ≥3 untuk klaim kunci; statistik dari skrip; angka di teks cocok dengan log (hitung ulang).
- [ ] Kode lama gagal; kontrol lulus; mutan masing-masing merah; positive control hijau.
- [ ] Beban tercapai tertulis; run yang crash/dibuang dilaporkan.
- [ ] Prediksi ditulis sebelum run, dan yang meleset dilaporkan.
- [ ] Follow-up prompt memakai skeleton: gerbang STOP, aturan lulus pasti, BANNED, AUTOMATIC REJECTION, slot other defects, tanpa secret.
- [ ] Prompt sudah diuji di sesi AI baru, atau `NOT RUN` dinyatakan jujur.
- [ ] Plan B: angka pemicu, keadaan aman, prosedur cancel, drill.
- [ ] Confidence: High hanya untuk yang kujalankan.
- [ ] Bagian 7 jelas, termasuk koreksi atas diriku sendiri.
- [ ] Tanpa tabel; suara sendiri; pernyataan penggunaan AI (bagian 10) akurat.

---

## 12. Template pesan singkat

**Serang temuan**
```text
Ini temuanku. Validate / attack / extend. Jangan final answer dulu.
[temuan]
```

**Docs**
```text
Buka docs [topik, versi X]. Ringkas perilaku yang mengubah verdict atau fix. Jangan dari ingatan.
```

**Harness**
```text
Tulis harness + predictions.md. Jangan jalankan. Aku yang run dan menempel log.
```

**Setelah log**
```text
Ini log mentahku. Koreksi estimasi yang meleset dan angka yang tidak cocok. Jangan menghitung dari ingatan.
```

**Final**
```text
Tulis jawaban 1–7 English tanpa tabel, hanya dari log ini. Serang draftmu sendiri dulu.
```

**Review**
```text
Attack draft ini. Patch kalimat yang cela saja.
```

---

## 13. Definition of done

Siap submit hanya jika:

- Temuan awalku sempat di-attack, bukan sekadar diganti AI.
- Skenario kunci kujalankan sendiri dengan log mentah dan label siapa-yang-run.
- Ada repeat, kontrol, dan setidaknya satu mutan dengan positive control.
- Ada satu "tetangga" yang diuji, atau `NOT RUN` dengan perintahnya.
- Prompt diuji di AI baru, atau `NOT RUN` dinyatakan.
- Plan B berurutan dengan drill.
- Checklist bagian 11 sudah kubaca ulang.
