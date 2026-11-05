# Week 4 · Challenge 4 — The Migration That Passed Staging

The AI's claims do not hold. A quiet 500k-row staging run is not a 120M-row, 800 inserts/s, six-pod rolling deploy. All evidence below comes from a local Docker Postgres 16.15 lab with synthetic rows (50k, 200k, 500k). Production: NOT RUN. Staging: NOT RUN. Replica lag: NOT RUN.

## 1) VERDICT

**NO.** "Tested on staging: 1.8 s, no errors. Zero downtime. Fully reversible. Safe during business hours." is not proven, and the local harness contradicts three of the four parts.

- **Zero downtime: false.** The RENAME (line 6) breaks every old pod, the plain index build (line 5) blocks writers, and the plain CHECK (line 7) takes ACCESS EXCLUSIVE.
- **Fully reversible: false.** `down()` leaves `amount_nonneg` behind and destroys the currency data.
- **Safe during business hours: false** for this `up()`, which also changes data correctness (old pods write the wrong currency during the rollout).
- **"1.8 s on staging"** has no raw log, no runner, no data description, and is the wrong class of evidence anyway: it describes ~500k rows, one pod, no traffic.

Trustworthy evidence for this challenge is lock mode and old-pod compatibility under concurrency, plus an honest rollback story, with raw logs saying who ran what on which data. Staging wall-clock alone is not that evidence.

## 2) ISSUES FOUND

**All lines (runner / transaction wrapper)**
- Problem: If the runner wraps `up()` in one transaction, the lock from line 2 is held until COMMIT. Reads and writes stall for the whole UPDATE + index + CHECK. If it does not, a failure at line 5 or 7 leaves a half-applied schema and the re-run fails ("column already exists"). Runner mode is unknown.
- Evidence: **VERIFIED (T9):** 200k rows, `up()` in `BEGIN…COMMIT` took 2027 ms; a plain SELECT was blocked 2024 ms; 8 old-pod INSERTs errored. Runner mode on staging: NOT RUN.

**Line 2**
- Problem: `ADD COLUMN … NOT NULL DEFAULT 'USD'` is metadata-only on PG 11+ (prod version unknown). It still needs a brief ACCESS EXCLUSIVE lock. Without `lock_timeout`, one long transaction makes this DDL wait and every later query queues behind it: the "app hangs" mechanism.
- Evidence: **VERIFIED (T4, lab PG 16.15):** 5 ms, heap/WAL unchanged. **VERIFIED (T8):** without `lock_timeout`, a plain SELECT arriving 200 ms later waited 1512 ms; with `lock_timeout=300ms` the DDL failed at 304 ms and the SELECT waited 93 ms. **NOT RUN:** production `server_version` (so the fast path on prod is REASONED from docs + lab, not verified on prod).

**Line 3–4**
- Problem: Full-table UPDATE rewrites every row version: ~2× heap, large WAL, replica lag, row locks against any app UPDATE. Old pods never write `currency`, so rows they insert during the ~5-minute rollout silently default to `'USD'` even for DE/ID. Finance invoices in EUR/IDR only from the 1st, so relabelling historical rows as EUR/IDR also rewrites history (needs finance confirmation). `ELSE 'USD'` is wrong for other eurozone countries.
- Evidence: **VERIFIED (T5, 500k rows):** UPDATE 2942 ms, heap ×2.13, WAL 116.9 MB (~4× the original 28.7 MB heap). **VERIFIED (T4):** a row inserted by an old pod for `country='DE'` got `currency='USD'`. **REASONED:** `ELSE 'USD'` mishandles non-DE eurozone countries (mapping incomplete; not measured). **NOT RUN:** finance confirmation that historical invoices stay USD.

**Line 5**
- Problem: Plain `CREATE INDEX` takes SHARE lock: writers wait, readers continue. At ~800 inserts/s, every second of build time queues ~800 writes; once the connection pool fills with waiting writers, reads hang too.
- Evidence: **VERIFIED (T6, 500k rows, 4 writers):** lock `ShareLock`; only **4** INSERTs completed during the build (max 310 ms) vs **134** (max 90 ms) with `CONCURRENTLY`; SELECTs unaffected. The 50k `prove-migration.js` Test 2 was **WEAK** (insert waited only 6 ms); do not use that run as index-blocking proof — use T6.

**Line 6**
- Problem: RENAME is a 1 ms metadata change, which is exactly why timing is the wrong metric. It breaks every old pod (SELECT and INSERT) from commit until each is replaced, makes an app rollback impossible, and breaks dashboards/views on the replica that use `amount`. It is not needed for EUR/IDR at all.
- Evidence: **VERIFIED:** `column "amount" does not exist` (prove-migration, Test 1); RENAME took 1 ms inside T9; old-pod INSERTs errored (T9).

**Line 7**
- Problem: `ADD CONSTRAINT CHECK` without `NOT VALID` takes ACCESS EXCLUSIVE and scans every row: reads and writes blocked. If negative amounts exist (credit notes), line 7 fails. With a non-transactional runner, lines 2–6 stay applied (half-applied schema, old pods already broken by the rename). With a transactional runner, everything rolls back, but only after the table was locked for the whole run.
- Evidence: **VERIFIED (T7):** lock `AccessExclusiveLock`; during the scan SELECT max 59 ms and only 4 INSERTs completed (500k rows; duration scales with row count, not measured at scale). **NOT RUN:** negative-amount count in production.

**Line 10–13**
- Problem: `down()` never drops `amount_nonneg`, and `DROP COLUMN currency` destroys the backfilled data. After the first EUR/IDR invoice, `down()` is data loss.
- Evidence: **VERIFIED (prove-migration, Test 3):** `CHECK ((amount >= (0)::numeric))` still present; EUR 16667 / IDR 16667 / USD 16666 distribution gone.

**The "1.8 s on staging" claim**
- Problem: "1.8 s on staging" cannot be reproduced and says nothing about locks, rolling deploy or traffic.
- Evidence: **REASONED + anecdotal:** an earlier run of this same harness on this machine reported `up()` = 10072 ms for 50k rows; the re-run after freeing disk reported **576 ms** (same code, same data; the 576 ms run is raw output 1, the 10072 ms log is not attached). The earlier run was probably under disk pressure, which is the point: duration depends on the environment, not just the migration. The AI's 1.8 s comes with no log at all.


Note: the index on `currency` is dropped together with the column, so it is **not** a leftover after `down()`.

## 3) FOLLOW-UP PROMPT

```
Your safety claims are rejected as proof: "1.8 s on staging", "zero downtime",
"fully reversible", "safe during business hours". Staging: ~500k rows, no traffic,
1 pod. Production: ~120M rows (~180 GB), ~800 inserts/s at peak, a read replica used
by dashboards, 6 pods on a rolling deploy where the migration runs BEFORE new pods and
old pods keep serving ~5 more minutes. Business goal: invoice in EUR/IDR from the 1st
of next month with no visible downtime. Constraints: I cannot touch production, no
production data leaves it, local Postgres + staging only, no paid tools, Node stays,
no new dependencies unless justified, placeholders only, must ship this release.

Step 0 - before any SQL, list every assumption you cannot verify and the exact
read-only check that resolves it: Postgres version; whether the runner wraps up() in
a transaction; PgBouncer mode; whether the app UPDATEs invoices; whether amount can
be negative; whether old binaries or the replica's dashboards reference `amount`;
whether historical invoices were issued in USD. Do not guess any of them.

Hard rules (reject your own draft if it breaks one):
- No RENAME or DROP of amount while any old binary may run, and no app rollback path
  may depend on it. Rename is not needed for EUR/IDR; leave it out of this release.
- Every DDL step sets lock_timeout (e.g. 3s) and statement_timeout, with
  retry/backoff. This includes NOT VALID, which still takes a brief ACCESS EXCLUSIVE.
- CREATE INDEX CONCURRENTLY, in its own non-transactional migration; say how you
  detect and drop an INVALID index.
- CHECK only as NOT VALID, then VALIDATE CONSTRAINT separately; give the read-only
  pre-check for violating rows.
- No single-statement full-table UPDATE. If a backfill is needed at all, it is
  batched by id range, one commit per batch, idempotent, throttled on replica lag,
  with a final sweep after the last old pod is gone. Say whether a backfill is needed
  or whether the constant DEFAULT is enough; do not relabel historical invoices unless
  I confirm finance wants it.
- Rows inserted by old pods must end up with the correct currency.
- Each step is its own migration file and is safe to re-run (IF NOT EXISTS).

Deliver:
1. Ordered steps: SQL, lock level, and app requirement per step.
2. Plain-text table: step | lock | old-pod compatible? | replica impact | pass/fail
   vs "no visible downtime".
3. down()/rollback per step: exact objects removed, what data is lost, and what is
   NOT reversible after the first EUR/IDR invoice. Say it plainly.
4. Plan B: how to detect the blocker (pg_blocking_pids), what to cancel first, how to
   avoid a half-applied schema, how to pause the rollout.
5. A local harness (Node + pg, or pgbench from the postgres image) proving: old
   SELECT/INSERT on amount survives the expand step; INSERTs keep completing during
   CIC; a queued DDL without lock_timeout blocks plain SELECTs while one with
   lock_timeout fails fast.
For every claim, label it VERIFIED (paste raw output + who ran it + on what data),
REASONED (cite the doc), or NOT RUN. Never claim "zero downtime", "fully reversible"
or "safe in business hours" without VERIFIED support. State what you cannot know.
```

## 4) EVIDENCE REQUIRED

**Who ran it / on what:** the developer, on a local Docker Postgres 16.15 (`docker compose`, port 5434), synthetic rows only, scripts `prove-migration.js` (50k rows) and `prove-safe-plan.js` (500k rows; T9 uses 200k). Production was not touched. Staging exists in the challenge constraints but was **NOT RUN** here: local lab was enough to show failure modes (rename, locks, incomplete `down()`); staging is still required before launch for `SHOW server_version`, runner transaction behaviour, and a rehearsal of M1–M3 — not for treating wall-clock as proof.

**Disclosure:** a first attempt of `prove-safe-plan.js` at `ROW_COUNT=2000000` crashed Postgres (`PANIC: could not fdatasync … Input/output error`) because the host disk was full. It produced no results and is not used as evidence. After freeing disk and recreating the lab, the runs below were made.

- Rename breaks old app; `down()` leaves CHECK and loses currency data: RUN (raw output 1). Index write-blocking in raw output 1 Test 2 is WEAK — use T6 below instead.
- Expand-only keeps old SELECT/INSERT working; old-pod rows default to USD: RUN (raw output 2, T4)
- UPDATE cost: heap ×2.13, WAL 116.9 MB vs ~0 for expand: RUN (T5)
- Plain index vs CONCURRENTLY: lock mode + insert throughput: RUN (T6)
- Plain CHECK vs NOT VALID + VALIDATE: lock mode + latency: RUN (T7)
- Lock queue with/without `lock_timeout`: RUN (T8)
- `up()` inside one transaction: RUN (T9)
- Cancel behaviour for plain index / CONCURRENTLY / VALIDATE: RUN (T10)
- Postgres version and runner transaction mode **on staging**: NOT RUN
- Replica lag and replay conflicts with dashboard queries: NOT RUN
- Calibrated 800 inserts/s load, production-width rows (~1.5 KB/row incl. indexes): NOT RUN
- Negative-amount count in production (production owner, count only): NOT RUN
- Finance confirmation that historical invoices stay USD: NOT RUN (open question)
- Automated CI lint gate for forbidden migration patterns: NOT BUILT (proposal only)

**Limits of this evidence:** writers are 4 tight-loop clients, not a calibrated 800 inserts/s; baseline INSERT latency (~40 ms) is inflated by Docker-on-Windows fsync, so compare ratios, not absolute milliseconds; the lab row is narrow (~57 B/row, one index), so production would be heavier. Do not read the lab numbers as production estimates. The transferable facts are lock modes, blocking behaviour, and ratios (heap ×2.1, WAL ≈ 4× original heap).

Docs used for mechanism only (not as production proof): PostgreSQL ALTER TABLE (constant DEFAULT fast path, NOT VALID / VALIDATE), CREATE INDEX / CONCURRENTLY, explicit locking.

### Raw output 1 — `node prove-migration.js` (ROW_COUNT=50000)

```
WHO: local harness (not production)
DATABASE_URL host used: postgres://postgres:***@127.0.0.1:5434/migration_lab
ROW_COUNT=50000
PRODUCTION NOT TOUCHED

=== TEST 1: rename vs old app (zero-downtime claim) ===
seeded rows: 50000
old app BEFORE migration: ok, amount=748.34
running AI up() ...
AI up() finished in 576 ms
CONFIRMED  old app AFTER rename failed as expected
      column "amount" does not exist
new app column works: total_amount=748.34 currency=EUR

=== TEST 2: CREATE INDEX blocks writers ===
CREATE INDEX (non-concurrent) took 44 ms
INSERT finished after waiting 6 ms
WEAK  table too small / too fast to show blocking clearly — raise ROW_COUNT and retry

=== TEST 3: down() is not fully reversible ===
currency distribution BEFORE down():
  EUR: 16667
  IDR: 16667
  USD: 16666
columns after down(): id, country, amount, created_at
index invoices_currency_idx still present: false (expected false: dropped with currency column)
constraint amount_nonneg still present: true
  definition: CHECK ((amount >= (0)::numeric))
currency column present: false
CONFIRMED  down() is incomplete: CHECK amount_nonneg remains; currency data is gone (not restored)
NOTE  index on currency went away with DROP COLUMN — do not cite that index as a leftover

=== SUMMARY ===
rename breaks old app: SHOWN
index lock test ran:   YES
down() incomplete:     SHOWN

Next: paste this raw output into Evidence. Staging 1.8s is still not production proof.
```

### Raw output 2 — `ROW_COUNT=500000 node prove-safe-plan.js` (T9 uses 200k rows)

```
WHO: local harness (not production), prove-safe-plan.js
DATABASE_URL host used: postgres://postgres:***@127.0.0.1:5434/migration_lab
ROW_COUNT=500000 TX_ROW_COUNT=200000 WRITERS=4
PRODUCTION NOT TOUCHED. Replica lag NOT measured. Writers are not a calibrated 800 inserts/s.

=== TEST 4: expand-only step keeps old pods working (ROW_COUNT=500000) ===
server_version: 16.15 (Debian 16.15-1.pgdg13+2)
expand ADD COLUMN ... DEFAULT 'USD' took 5 ms
  heap 28.7 MB -> 28.7 MB, total 39.5 MB -> 39.5 MB, WAL written 0.0 MB
CONFIRMED     old pod SELECT amount works after expand
CONFIRMED     old pod INSERT (no currency column) works after expand
row inserted by an OLD pod for country=DE got currency='USD'
CONFIRMED     old-pod rows silently default to USD even for DE (so the AI's one-off UPDATE cannot cover them)

=== TEST 5: UPDATE cost vs constant-default ADD COLUMN ===
full-table UPDATE (AI line 3-4) took 2942 ms on 500000 rows
  heap 28.7 MB -> 61.3 MB (x2.13), total 39.5 MB -> 82.8 MB (x2.10)
  WAL written: expand 0.0 MB vs UPDATE 116.9 MB (x82841)
  naive linear extrapolation to 120M rows (x240): UPDATE WAL ~ 28061.9 MB, heap growth ~ 7813.1 MB. Back-of-envelope ONLY, not evidence of production behaviour.
CONFIRMED     UPDATE roughly doubles the heap and writes orders of magnitude more WAL than the expand step

=== TEST 6: plain CREATE INDEX vs CONCURRENTLY under load (ROW_COUNT=500000, 4 writers) ===
--- plain CREATE INDEX
    op took 305 ms
    lock modes seen on invoices for the DDL backend: ShareLock
    INSERT baseline: n=129 errors=0 p99=41ms max=41ms
    INSERT during  : n=4 errors=0 p99=310ms max=310ms
    SELECT baseline: n=279 errors=0 p99=3ms max=7ms
    SELECT during  : n=165 errors=0 p99=5ms max=7ms
--- CREATE INDEX CONCURRENTLY (no transaction block)
    op took 555 ms
    lock modes seen on invoices for the DDL backend: ShareUpdateExclusiveLock
    INSERT baseline: n=131 errors=0 p99=41ms max=42ms
    INSERT during  : n=134 errors=0 p99=66ms max=90ms
    SELECT baseline: n=210 errors=0 p99=7ms max=12ms
    SELECT during  : n=239 errors=0 p99=5ms max=6ms
CONCURRENTLY index valid: true
CONFIRMED     plain CREATE INDEX held ShareLock (conflicts with INSERT/UPDATE/DELETE)
CONFIRMED     CONCURRENTLY held only ShareUpdateExclusiveLock (does not conflict with writes)
latency comparison, worst INSERT during build: plain 310 ms vs concurrent 90 ms (inserts completed during build: plain 4 vs concurrent 134)

=== TEST 7: plain ADD CHECK vs NOT VALID + VALIDATE under load (ROW_COUNT=500000) ===
--- plain ADD CONSTRAINT CHECK (AI line 7 shape)
    op took 59 ms
    lock modes seen on invoices for the DDL backend: AccessExclusiveLock
    INSERT baseline: n=132 errors=0 p99=37ms max=38ms
    INSERT during  : n=4 errors=0 p99=67ms max=67ms
    SELECT baseline: n=301 errors=0 p99=3ms max=4ms
    SELECT during  : n=2 errors=0 p99=59ms max=59ms
--- ADD CONSTRAINT ... NOT VALID
    op took 14 ms
    lock modes seen on invoices for the DDL backend: AccessExclusiveLock
    INSERT baseline: n=153 errors=0 p99=15ms max=15ms
    INSERT during  : n=4 errors=0 p99=49ms max=49ms
    SELECT baseline: n=275 errors=0 p99=3ms max=3ms
    SELECT during  : n=3 errors=0 p99=13ms max=13ms
  convalidated after NOT VALID: false
--- VALIDATE CONSTRAINT
    op took 77 ms
    lock modes seen on invoices for the DDL backend: ShareUpdateExclusiveLock
    INSERT baseline: n=148 errors=0 p99=26ms max=26ms
    INSERT during  : n=29 errors=0 p99=16ms max=16ms
    SELECT baseline: n=309 errors=0 p99=2ms max=3ms
    SELECT during  : n=44 errors=0 p99=3ms max=3ms
  convalidated after VALIDATE: true
CONFIRMED     plain ADD CHECK held AccessExclusiveLock while scanning (blocks reads AND writes)
CONFIRMED     VALIDATE held only ShareUpdateExclusiveLock (reads and writes continue)
latency comparison, worst SELECT during op: plain CHECK 59 ms vs VALIDATE 3 ms; worst INSERT: plain 67 ms vs VALIDATE 16 ms
  note: NOT VALID itself briefly needs AccessExclusiveLock but does no scan (took 14 ms here)

=== TEST 8: lock queue - queued DDL stalls plain SELECTs (the "app hangs" mechanism) ===
NO lock_timeout: DDL succeeded after 1721 ms; plain SELECT that arrived 200 ms later waited 1512 ms
lock_timeout=300ms: DDL FAILED fast (canceling statement due to lock timeout) after 304 ms; plain SELECT that arrived 200 ms later waited 93 ms
CONFIRMED     without lock_timeout a trivial SELECT stalled behind the queued DDL for as long as the long transaction lived
CONFIRMED     with lock_timeout the DDL failed fast and the SELECT stall was bounded (retry with backoff instead)

=== TEST 9: AI up() wrapped in ONE transaction (runner behaviour), ROW_COUNT=200000 ===
--- AI up() inside BEGIN ... COMMIT, load running
    op took 2027 ms
    lock modes seen on invoices for the DDL backend: AccessExclusiveLock, RowExclusiveLock, ShareLock
    INSERT baseline: n=148 errors=0 p99=18ms max=18ms
    INSERT during  : n=8 errors=8 p99=2023ms max=2023ms
    SELECT baseline: n=299 errors=0 p99=2ms max=3ms
    SELECT during  : n=4 errors=0 p99=2024ms max=2024ms
    per-statement: line 2: 8 ms | line 3: 1399 ms | line 5: 313 ms | line 6: 1 ms | line 7: 22 ms
    note: the old-pod writers/readers here use column "amount", so after the RENAME commits they error; look at "during ... errors" for that, and at max for the stall.
CONFIRMED     a plain SELECT was blocked for ~2024 ms of a 2027 ms transaction (line 2 lock held until COMMIT)

=== TEST 10: Plan B claims - what a cancelled step leaves behind (ROW_COUNT=500000) ===
plain CREATE INDEX cancelled: finished=false err=canceling statement due to user request index row present=false
CONFIRMED     cancelled plain CREATE INDEX rolls back cleanly: NO invalid index remains
CREATE INDEX CONCURRENTLY cancelled: finished=false err=canceling statement due to user request index present=true indisvalid=false
CONFIRMED     cancelled CONCURRENTLY build leaves an INVALID index that must be dropped
after DROP INDEX CONCURRENTLY: index present=false
VALIDATE CONSTRAINT cancelled: finished=false err=canceling statement due to user request convalidated=false
CONFIRMED     cancelled VALIDATE leaves the constraint NOT VALID (still enforced on new writes), safe to retry

=== SUMMARY ===
T4/T5 expand compatible + UPDATE cost : CONFIRMED
T6    index plain vs CONCURRENTLY      : CONFIRMED
T7    CHECK plain vs NOT VALID/VALIDATE: CONFIRMED
T8    lock queue / lock_timeout        : CONFIRMED
T9    up() in one transaction          : CONFIRMED
T10   Plan B cancel behaviour          : CONFIRMED
```

## 5) VERIFICATION PLAN (including Plan B)

**Safe shape I will accept** (expected from the AI; the lock behaviour of each piece is measured above, the plan as a whole is not yet rehearsed on staging):

```sql
-- M1 (expand, runs at deploy start; old pods stay compatible)
SET lock_timeout = '3s'; SET statement_timeout = '30s';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'USD';

-- M2 (own non-transactional migration, off-peak)
-- bound the lock wait, not the build: CIC on 120M rows legitimately runs long
SET lock_timeout = '3s'; SET statement_timeout = 0;
CREATE INDEX CONCURRENTLY IF NOT EXISTS invoices_currency_idx ON invoices (currency, created_at);

-- M3 (optional, later)
ALTER TABLE invoices ADD CONSTRAINT amount_nonneg CHECK (amount >= 0) NOT VALID;
ALTER TABLE invoices VALIDATE CONSTRAINT amount_nonneg;

-- Backfill: only if finance wants country-based currency on history.
--   batched by id range, one commit per batch, idempotent, throttled on replica lag,
--   plus a final sweep after the last old pod is gone.
-- RENAME amount -> total_amount: removed from this release (not needed for EUR/IDR).
```

If finance confirms historical invoices were USD, the constant default **is** the backfill and no UPDATE runs at all. The new app writes `currency` explicitly, with EUR/IDR gated by the cutover date. M1 and the rollout must finish **before** the 1st: old pods then only run before the cutover, so the `'USD'` default they get (T4) is correct for them, and EUR/IDR rows are written only by new pods. Release rollback is "roll back the app and leave the column". `DROP COLUMN currency` is acceptable only before the first EUR/IDR invoice; after that the story is roll-forward and it must be said plainly.

**What was proven without production:** expand compatibility with old SQL (T4), UPDATE cost ratios (T5), lock modes and write throughput for index and CHECK variants (T6, T7), the lock-queue stall and its `lock_timeout` bound (T8), the single-transaction stall (T9), and cancel behaviour (T10).

**Still to prove before launch (NOT RUN):**
1. On staging: `SHOW server_version`, the runner's transaction behaviour, and a rehearsal of M1–M3 with a traffic generator. Staging is for behaviour, not timing.
2. A local streaming replica to measure lag and replay conflicts with long dashboard queries.
3. A calibrated ~800 inserts/s load (for example pgbench from the postgres image, no new dependency) with production-width rows.
4. Production-owner read-only checks, returning counts only: negative amounts, old binaries or views that reference `amount`.
5. A CI gate (a small Node script, no new dependency) that fails a migration containing `RENAME`, `CREATE INDEX` without `CONCURRENTLY`, `ADD CONSTRAINT … CHECK` without `NOT VALID`, a bare full-table `UPDATE`, or no `lock_timeout`. Not built yet.

**Plan B — migration already running and the app hangs:**
1. **Pause the rollout.** After an expand-only step the old pods are still compatible. Do not start a second migration.
2. **Find the blocker:**
   ```sql
   SELECT pid, pg_blocking_pids(pid) AS blockers, wait_event_type,
          now() - query_start AS age, left(query, 80)
   FROM pg_stat_activity
   WHERE datname = current_database() AND state <> 'idle'
   ORDER BY query_start;
   ```
3. **Cancel the migration session first**, not the app's sessions: `pg_cancel_backend(pid)`, then `pg_terminate_backend(pid)` if ignored. A DDL waiting at the head of the lock queue is usually the culprit; sessions queued behind it resume once it is gone (T8).
4. **Per step, what a cancel leaves (measured in T10):**
   - plain `CREATE INDEX`: rolls back cleanly, no INVALID index;
   - `CREATE INDEX CONCURRENTLY`: leaves an INVALID index. Check `SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid`, then `DROP INDEX CONCURRENTLY`;
   - `VALIDATE CONSTRAINT`: the constraint stays `NOT VALID` (still enforced on new writes), safe to retry;
   - batched backfill: stop the job, committed batches stay, resume later.
5. **If the rename already committed:** while all pods are still old, the quickest mitigation is `ALTER TABLE invoices RENAME COLUMN total_amount TO amount` (metadata-only, with `lock_timeout`), and the runner's migration record must be corrected so its state matches the real schema. Rolling the new app forward is the alternative. `down()` is not a clean undo.
6. **Avoid a half-applied schema:** one migration per file, `IF NOT EXISTS` guards, and a deploy that aborts when a migration fails so the old pods keep serving.
7. **If the AI's next version is still unsafe:** reject it against the rules in the follow-up prompt. Ship only M1 plus app-side currency. Index, CHECK and any backfill move to separate out-of-band runs. Finance can invoice in EUR/IDR without them.

## 6) CONFIDENCE

- **High** that the claims are false on compatibility (rename), write blocking (index, CHECK), reversibility (`down()`), and the lock-queue / single-transaction hang. All were measured locally, with raw output above.
- **High** that the cancel behaviour in Plan B is as stated (measured on PG 16.15; prod version unknown).
- **Medium** on the safe plan as a whole: each piece is measured in isolation, but the plan has not been rehearsed on staging or under a calibrated load.
- **Low-Medium** on production duration, WAL volume and replica lag: the lab used narrow rows, no replica and a non-calibrated writer load. Only ratios transfer.
- **Open question, not a confidence level:** whether historical invoices should stay USD. Only finance can answer.

## 7) WHAT I ACCEPTED, CHANGED OR REJECTED FROM THE AI

**Accepted**
- The business goal: invoice in EUR/IDR from the 1st.
- The constant-default `ADD COLUMN` (measured: 5 ms, no heap or WAL growth on PG 16.15).
- `(currency, created_at)` as a candidate index, though its need is not proven.
- A country-to-currency mapping as a starting point, subject to finance.

**Changed**
- One `up()` becomes separate expand, index, check and optional backfill migrations, each with `lock_timeout`.
- Backfill goes from a one-shot UPDATE to "probably none, otherwise batched with a final sweep".
- The success bar goes from duration to lock behaviour, old-pod compatibility, replica impact and an honest rollback story.

**Rejected**
- Staging 1.8 s as evidence.
- Rename in this release.
- Plain index build on the hot table.
- CHECK without `NOT VALID`.
- A full-table UPDATE that relabels history.
- Running the migration in a transaction without knowing the runner's behaviour.
- All four safety claims.

**Self-corrections**
- The currency index is not a `down()` leftover; it is dropped with the column.
- Cancelling a plain index build leaves no INVALID index; only a cancelled `CONCURRENTLY` build does.
- `CHECK` without `NOT VALID` blocks reads as well as writes, not just updates.
- An earlier timing (`up()` = 10 s on 50k rows) was taken under disk pressure and is not reproducible (576 ms on re-run), so I no longer cite it.
