/**
 * Week 4 harness, part 2: evidence for the SAFE plan and the Plan B claims.
 * Local lab only. Production NOT touched.
 *
 * T4  expand-only step: old SELECT/INSERT on amount keep working; old-pod rows default to USD
 * T5  UPDATE cost at scale vs the constant-default ADD COLUMN (heap growth, WAL)
 * T6  lock modes + writer/reader latency: plain CREATE INDEX vs CONCURRENTLY
 * T7  lock modes + latency: plain ADD CHECK vs NOT VALID + VALIDATE
 * T8  lock queue: queued DDL without lock_timeout stalls plain SELECTs; with it, fails fast
 * T9  AI up() inside ONE transaction (runner wrapper): readers blocked until commit
 * T10 Plan B claims: what a cancelled plain index / CIC / VALIDATE leaves behind
 *
 * Usage (same lab as prove-migration.js):
 *   docker compose up -d
 *   node prove-safe-plan.js
 *
 * Env (optional): DATABASE_URL, ROW_COUNT (default 2000000), TX_ROW_COUNT (default 200000),
 *                 WRITERS (default 4)
 *
 * Limits, stated up front: the writers are N tight-loop clients, NOT a calibrated
 * 800 inserts/s generator. No replica is involved, so replica lag is NOT measured.
 */
const { Client } = require('pg');

const url =
  process.env.DATABASE_URL ||
  'postgres://postgres:postgres@127.0.0.1:5434/migration_lab';
const ROWS = Number(process.env.ROW_COUNT || 2_000_000);
const TX_ROWS = Number(process.env.TX_ROW_COUNT || 200_000);
const WRITERS = Number(process.env.WRITERS || 4);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  const c = new Client({ connectionString: url });
  await c.connect();
  return c;
}

async function buildTable(c, n, withCurrency) {
  await c.query('DROP TABLE IF EXISTS invoices CASCADE');
  await c.query(`
    CREATE TABLE invoices (
      id bigserial PRIMARY KEY,
      country text NOT NULL,
      amount numeric NOT NULL,
      ${withCurrency ? "currency text NOT NULL DEFAULT 'USD'," : ''}
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
  await c.query(
    `INSERT INTO invoices (country, amount)
     SELECT (ARRAY['US','DE','ID'])[1 + (i % 3)], (random() * 1000)::numeric(12,2)
     FROM generate_series(1, $1) AS g(i)`,
    [n]
  );
  await c.query('ANALYZE invoices');
}

async function sizes(c) {
  const r = await c.query(`
    SELECT pg_total_relation_size('invoices')::bigint AS total,
           pg_relation_size('invoices')::bigint AS heap,
           pg_current_wal_lsn()::text AS lsn`);
  return r.rows[0];
}

async function walBytes(c, fromLsn, toLsn) {
  const r = await c.query('SELECT pg_wal_lsn_diff($1::pg_lsn, $2::pg_lsn)::bigint AS b', [
    toLsn,
    fromLsn,
  ]);
  return Number(r.rows[0].b);
}

const mb = (b) => (Number(b) / 1024 / 1024).toFixed(1) + ' MB';

function pct(arr, p) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

function stat(samples) {
  const ms = samples.map((s) => s.ms);
  return {
    n: samples.length,
    errors: samples.filter((s) => s.err).length,
    p99: pct(ms, 99),
    max: ms.length ? Math.max(...ms) : null,
  };
}

/**
 * Run `op(ddlClient)` while WRITERS clients insert and one client reads in tight loops.
 * Optionally samples pg_locks for the DDL backend to record which lock modes it held.
 */
async function runWithLoad(op) {
  const ddl = await connect();
  const pid = (await ddl.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  const samples = [];
  const modes = new Set();
  let stop = false;

  const loop = async (kind, fn) => {
    const c = await connect();
    while (!stop) {
      const t0 = Date.now();
      let err = null;
      try {
        await fn(c);
      } catch (e) {
        err = e.message;
      }
      samples.push({ kind, t0, ms: Date.now() - t0, err });
    }
    await c.end();
  };

  const sampler = async () => {
    const c = await connect();
    while (!stop) {
      try {
        const r = await c.query(
          `SELECT mode FROM pg_locks
           WHERE locktype = 'relation' AND relation = 'invoices'::regclass
             AND pid = $1 AND granted`,
          [pid]
        );
        r.rows.forEach((x) => modes.add(x.mode));
      } catch (_) {
        /* table may be mid-DDL */
      }
      await sleep(3);
    }
    await c.end();
  };

  const tasks = [];
  for (let i = 0; i < WRITERS; i++) {
    tasks.push(
      loop('write', (c) =>
        c.query("INSERT INTO invoices (country, amount) VALUES ('DE', 10)")
      )
    );
  }
  tasks.push(loop('read', (c) => c.query('SELECT id FROM invoices WHERE id = 1')));
  tasks.push(sampler());

  await sleep(400); // baseline window
  const opStart = Date.now();
  let opResult = null;
  let opErr = null;
  try {
    opResult = await op(ddl);
  } catch (e) {
    opErr = e.message;
  }
  const opEnd = Date.now();
  await sleep(200);
  stop = true;
  await Promise.all(tasks);
  await ddl.end();

  const pick = (kind, win) =>
    samples.filter(
      (s) =>
        s.kind === kind &&
        (win === 'base' ? s.t0 < opStart : s.t0 >= opStart && s.t0 <= opEnd)
    );
  return {
    opMs: opEnd - opStart,
    opResult,
    opErr,
    modes: [...modes].sort(),
    write: { base: stat(pick('write', 'base')), during: stat(pick('write', 'during')) },
    read: { base: stat(pick('read', 'base')), during: stat(pick('read', 'during')) },
  };
}

function printLoad(label, r) {
  console.log(`--- ${label}`);
  console.log(`    op took ${r.opMs} ms${r.opErr ? `  ERROR: ${r.opErr}` : ''}`);
  console.log(`    lock modes seen on invoices for the DDL backend: ${r.modes.join(', ') || '(none sampled)'}`);
  const f = (s) => `n=${s.n} errors=${s.errors} p99=${s.p99}ms max=${s.max}ms`;
  console.log(`    INSERT baseline: ${f(r.write.base)}`);
  console.log(`    INSERT during  : ${f(r.write.during)}`);
  console.log(`    SELECT baseline: ${f(r.read.base)}`);
  console.log(`    SELECT during  : ${f(r.read.during)}`);
}

const verdict = (ok, text) => console.log(`${ok ? 'CONFIRMED    ' : 'NOT CONFIRMED'} ${text}`);

/* ---------------------------------------------------------------- T4 + T5 */
async function testExpandAndUpdateCost() {
  console.log(`\n=== TEST 4: expand-only step keeps old pods working (ROW_COUNT=${ROWS}) ===`);
  const c = await connect();
  await buildTable(c, ROWS, false);
  const ver = (await c.query('SHOW server_version')).rows[0].server_version;
  console.log(`server_version: ${ver}`);
  const s0 = await sizes(c);

  const oldApp = await connect();
  await c.query("SET lock_timeout = '3s'");
  await c.query("SET statement_timeout = '30s'");
  const t0 = Date.now();
  await c.query(
    "ALTER TABLE invoices ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'USD'"
  );
  const expandMs = Date.now() - t0;
  const s1 = await sizes(c);
  const walExpand = await walBytes(c, s0.lsn, s1.lsn);
  console.log(`expand ADD COLUMN ... DEFAULT 'USD' took ${expandMs} ms`);
  console.log(
    `  heap ${mb(s0.heap)} -> ${mb(s1.heap)}, total ${mb(s0.total)} -> ${mb(s1.total)}, WAL written ${mb(walExpand)}`
  );

  let okSelect = false;
  let okInsert = false;
  let oldRowCurrency = null;
  try {
    await oldApp.query('SELECT id, amount FROM invoices ORDER BY id LIMIT 1');
    okSelect = true;
    const ins = await oldApp.query(
      "INSERT INTO invoices (country, amount) VALUES ('DE', 99.5) RETURNING id, currency"
    );
    okInsert = true;
    oldRowCurrency = ins.rows[0].currency;
  } catch (e) {
    console.log(`old-pod SQL failed: ${e.message}`);
  }
  verdict(okSelect, 'old pod SELECT amount works after expand');
  verdict(okInsert, 'old pod INSERT (no currency column) works after expand');
  console.log(`row inserted by an OLD pod for country=DE got currency='${oldRowCurrency}'`);
  verdict(
    oldRowCurrency === 'USD',
    "old-pod rows silently default to USD even for DE (so the AI's one-off UPDATE cannot cover them)"
  );

  console.log(`\n=== TEST 5: UPDATE cost vs constant-default ADD COLUMN ===`);
  const t1 = Date.now();
  await c.query(`UPDATE invoices SET currency =
    CASE country WHEN 'DE' THEN 'EUR' WHEN 'ID' THEN 'IDR' ELSE 'USD' END`);
  const updMs = Date.now() - t1;
  const s2 = await sizes(c);
  const walUpd = await walBytes(c, s1.lsn, s2.lsn);
  console.log(`full-table UPDATE (AI line 3-4) took ${updMs} ms on ${ROWS} rows`);
  console.log(
    `  heap ${mb(s1.heap)} -> ${mb(s2.heap)} (x${(s2.heap / s1.heap).toFixed(2)}), ` +
      `total ${mb(s1.total)} -> ${mb(s2.total)} (x${(s2.total / s1.total).toFixed(2)})`
  );
  console.log(
    `  WAL written: expand ${mb(walExpand)} vs UPDATE ${mb(walUpd)} ` +
      `(x${walExpand > 0 ? (walUpd / walExpand).toFixed(0) : 'n/a'})`
  );
  const scale = 120_000_000 / ROWS;
  console.log(
    `  naive linear extrapolation to 120M rows (x${scale.toFixed(0)}): UPDATE WAL ~ ${mb(walUpd * scale)}, ` +
      `heap growth ~ ${mb((s2.heap - s1.heap) * scale)}. Back-of-envelope ONLY, not evidence of production behaviour.`
  );
  verdict(
    s2.heap > s1.heap * 1.5 && walUpd > walExpand * 100,
    'UPDATE roughly doubles the heap and writes orders of magnitude more WAL than the expand step'
  );
  await oldApp.end();
  await c.end();
  return okSelect && okInsert && oldRowCurrency === 'USD';
}

/* ---------------------------------------------------------------- T6 */
async function testIndexModes() {
  console.log(`\n=== TEST 6: plain CREATE INDEX vs CONCURRENTLY under load (ROW_COUNT=${ROWS}, ${WRITERS} writers) ===`);
  const c = await connect();
  await buildTable(c, ROWS, true);

  const plain = await runWithLoad((d) =>
    d.query('CREATE INDEX invoices_currency_idx ON invoices (currency, created_at)')
  );
  printLoad('plain CREATE INDEX', plain);
  await c.query('DROP INDEX IF EXISTS invoices_currency_idx');

  const conc = await runWithLoad((d) =>
    d.query(
      'CREATE INDEX CONCURRENTLY invoices_currency_idx ON invoices (currency, created_at)'
    )
  );
  printLoad('CREATE INDEX CONCURRENTLY (no transaction block)', conc);

  const valid = await c.query(`
    SELECT i.indisvalid FROM pg_index i JOIN pg_class x ON x.oid = i.indexrelid
    WHERE x.relname = 'invoices_currency_idx'`);
  console.log(`CONCURRENTLY index valid: ${valid.rows[0] && valid.rows[0].indisvalid}`);

  verdict(
    plain.modes.includes('ShareLock'),
    'plain CREATE INDEX held ShareLock (conflicts with INSERT/UPDATE/DELETE)'
  );
  verdict(
    conc.modes.includes('ShareUpdateExclusiveLock') && !conc.modes.includes('ShareLock'),
    'CONCURRENTLY held only ShareUpdateExclusiveLock (does not conflict with writes)'
  );
  console.log(
    `latency comparison, worst INSERT during build: plain ${plain.write.during.max} ms vs concurrent ${conc.write.during.max} ms ` +
      `(inserts completed during build: plain ${plain.write.during.n} vs concurrent ${conc.write.during.n})`
  );
  await c.end();
  return plain.modes.includes('ShareLock') && conc.opErr === null;
}

/* ---------------------------------------------------------------- T7 */
async function testCheckModes() {
  console.log(`\n=== TEST 7: plain ADD CHECK vs NOT VALID + VALIDATE under load (ROW_COUNT=${ROWS}) ===`);
  const c = await connect();
  await buildTable(c, ROWS, true);

  const plain = await runWithLoad((d) =>
    d.query('ALTER TABLE invoices ADD CONSTRAINT amount_nonneg CHECK (amount >= 0)')
  );
  printLoad('plain ADD CONSTRAINT CHECK (AI line 7 shape)', plain);
  await c.query('ALTER TABLE invoices DROP CONSTRAINT IF EXISTS amount_nonneg');

  const nv = await runWithLoad((d) =>
    d.query('ALTER TABLE invoices ADD CONSTRAINT amount_nonneg CHECK (amount >= 0) NOT VALID')
  );
  printLoad('ADD CONSTRAINT ... NOT VALID', nv);
  const state1 = (
    await c.query("SELECT convalidated FROM pg_constraint WHERE conname = 'amount_nonneg'")
  ).rows[0];
  console.log(`  convalidated after NOT VALID: ${state1 && state1.convalidated}`);

  const val = await runWithLoad((d) =>
    d.query('ALTER TABLE invoices VALIDATE CONSTRAINT amount_nonneg')
  );
  printLoad('VALIDATE CONSTRAINT', val);
  const state2 = (
    await c.query("SELECT convalidated FROM pg_constraint WHERE conname = 'amount_nonneg'")
  ).rows[0];
  console.log(`  convalidated after VALIDATE: ${state2 && state2.convalidated}`);

  verdict(
    plain.modes.includes('AccessExclusiveLock'),
    'plain ADD CHECK held AccessExclusiveLock while scanning (blocks reads AND writes)'
  );
  verdict(
    val.modes.includes('ShareUpdateExclusiveLock') && !val.modes.includes('AccessExclusiveLock'),
    'VALIDATE held only ShareUpdateExclusiveLock (reads and writes continue)'
  );
  console.log(
    `latency comparison, worst SELECT during op: plain CHECK ${plain.read.during.max} ms vs VALIDATE ${val.read.during.max} ms; ` +
      `worst INSERT: plain ${plain.write.during.max} ms vs VALIDATE ${val.write.during.max} ms`
  );
  console.log(
    `  note: NOT VALID itself briefly needs AccessExclusiveLock but does no scan (took ${nv.opMs} ms here)`
  );
  await c.end();
  return plain.modes.includes('AccessExclusiveLock') && state2 && state2.convalidated === true;
}

/* ---------------------------------------------------------------- T8 */
async function testLockQueue() {
  console.log('\n=== TEST 8: lock queue - queued DDL stalls plain SELECTs (the "app hangs" mechanism) ===');
  const setup = await connect();
  const ddlSql =
    "ALTER TABLE invoices ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'USD'";
  const results = {};

  for (const lockTimeoutMs of [0, 300]) {
    await buildTable(setup, 1000, false);
    const a = await connect(); // long-running transaction holding ACCESS SHARE
    const b = await connect(); // the migration
    const reader = await connect(); // a normal app SELECT arriving after the DDL queued
    await a.query('BEGIN');
    await a.query('SELECT 1 FROM invoices LIMIT 1');
    if (lockTimeoutMs) await b.query(`SET lock_timeout = '${lockTimeoutMs}ms'`);

    const tb = Date.now();
    const bP = b.query(ddlSql).then(
      () => ({ ok: true, ms: Date.now() - tb }),
      (e) => ({ ok: false, ms: Date.now() - tb, err: e.message })
    );
    await sleep(200);
    const tr = Date.now();
    const rP = reader.query('SELECT 1 FROM invoices LIMIT 1').then(() => Date.now() - tr);
    await sleep(1500); // transaction A keeps holding its lock
    await a.query('ROLLBACK');
    const [bR, readerMs] = await Promise.all([bP, rP]);

    const label = lockTimeoutMs ? `lock_timeout=${lockTimeoutMs}ms` : 'NO lock_timeout';
    console.log(
      `${label}: DDL ${bR.ok ? 'succeeded' : 'FAILED fast (' + bR.err + ')'} after ${bR.ms} ms; ` +
        `plain SELECT that arrived 200 ms later waited ${readerMs} ms`
    );
    results[lockTimeoutMs] = { bR, readerMs };
    await a.end();
    await b.end();
    await reader.end();
  }
  await setup.end();

  verdict(
    results[0].readerMs >= 1200,
    'without lock_timeout a trivial SELECT stalled behind the queued DDL for as long as the long transaction lived'
  );
  verdict(
    results[300].bR.ok === false && results[300].readerMs < 700,
    'with lock_timeout the DDL failed fast and the SELECT stall was bounded (retry with backoff instead)'
  );
  return results[0].readerMs >= 1200 && results[300].bR.ok === false;
}

/* ---------------------------------------------------------------- T9 */
async function testSingleTransactionUp() {
  console.log(`\n=== TEST 9: AI up() wrapped in ONE transaction (runner behaviour), ROW_COUNT=${TX_ROWS} ===`);
  const c = await connect();
  await buildTable(c, TX_ROWS, false);
  await c.end();

  const stmts = [
    "ALTER TABLE invoices ADD COLUMN currency text NOT NULL DEFAULT 'USD'",
    `UPDATE invoices SET currency = CASE country WHEN 'DE' THEN 'EUR' WHEN 'ID' THEN 'IDR' ELSE 'USD' END`,
    'CREATE INDEX invoices_currency_idx ON invoices (currency, created_at)',
    'ALTER TABLE invoices RENAME COLUMN amount TO total_amount',
    'ALTER TABLE invoices ADD CONSTRAINT amount_nonneg CHECK (total_amount >= 0)',
  ];
  const timings = [];
  const r = await runWithLoad(async (d) => {
    await d.query('BEGIN');
    for (let i = 0; i < stmts.length; i++) {
      const t0 = Date.now();
      await d.query(stmts[i]);
      timings.push(`line ${[2, 3, 5, 6, 7][i]}: ${Date.now() - t0} ms`);
    }
    await d.query('COMMIT');
  });
  printLoad('AI up() inside BEGIN ... COMMIT, load running', r);
  console.log(`    per-statement: ${timings.join(' | ')}`);
  console.log(
    '    note: the old-pod writers/readers here use column "amount", so after the RENAME commits they error; ' +
      'look at "during ... errors" for that, and at max for the stall.'
  );
  verdict(
    r.read.during.max !== null && r.read.during.max >= r.opMs * 0.5,
    `a plain SELECT was blocked for ~${r.read.during.max} ms of a ${r.opMs} ms transaction (line 2 lock held until COMMIT)`
  );
  return r.read.during.max >= r.opMs * 0.5;
}

/* ---------------------------------------------------------------- T10 */
async function cancelAfter(sql, ms) {
  const w = await connect();
  const k = await connect();
  const pid = (await w.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  const p = w.query(sql).then(
    () => ({ finished: true }),
    (e) => ({ finished: false, err: e.message })
  );
  await sleep(ms);
  await k.query('SELECT pg_cancel_backend($1)', [pid]);
  const res = await p;
  await w.end();
  await k.end();
  return res;
}

async function testPlanB() {
  console.log(`\n=== TEST 10: Plan B claims - what a cancelled step leaves behind (ROW_COUNT=${ROWS}) ===`);
  const c = await connect();
  await buildTable(c, ROWS, true);
  const idxState = async () =>
    (
      await c.query(`
        SELECT i.indisvalid FROM pg_index i JOIN pg_class x ON x.oid = i.indexrelid
        WHERE x.relname = 'invoices_currency_idx'`)
    ).rows[0];
  let ok = true;

  // a) plain CREATE INDEX cancelled
  let r = await cancelAfter(
    'CREATE INDEX invoices_currency_idx ON invoices (currency, created_at)',
    150
  );
  let st = await idxState();
  console.log(`plain CREATE INDEX cancelled: finished=${r.finished} err=${r.err || '-'} index row present=${Boolean(st)}`);
  verdict(!r.finished && !st, 'cancelled plain CREATE INDEX rolls back cleanly: NO invalid index remains');
  ok = ok && !r.finished && !st;

  // b) CIC cancelled
  r = await cancelAfter(
    'CREATE INDEX CONCURRENTLY invoices_currency_idx ON invoices (currency, created_at)',
    300
  );
  st = await idxState();
  console.log(
    `CREATE INDEX CONCURRENTLY cancelled: finished=${r.finished} err=${r.err || '-'} index present=${Boolean(st)} indisvalid=${st && st.indisvalid}`
  );
  verdict(
    !r.finished && st && st.indisvalid === false,
    'cancelled CONCURRENTLY build leaves an INVALID index that must be dropped'
  );
  ok = ok && !r.finished && st && st.indisvalid === false;
  await c.query('DROP INDEX CONCURRENTLY IF EXISTS invoices_currency_idx');
  console.log(`after DROP INDEX CONCURRENTLY: index present=${Boolean(await idxState())}`);

  // c) VALIDATE cancelled
  await c.query('ALTER TABLE invoices ADD CONSTRAINT amount_nonneg CHECK (amount >= 0) NOT VALID');
  r = await cancelAfter('ALTER TABLE invoices VALIDATE CONSTRAINT amount_nonneg', 20);
  const cv = (
    await c.query("SELECT convalidated FROM pg_constraint WHERE conname = 'amount_nonneg'")
  ).rows[0];
  console.log(
    `VALIDATE CONSTRAINT cancelled: finished=${r.finished} err=${r.err || '-'} convalidated=${cv && cv.convalidated}`
  );
  if (r.finished) {
    console.log('NOTE  VALIDATE finished before the cancel landed (race). Raise ROW_COUNT and re-run for this one.');
  } else {
    verdict(cv && cv.convalidated === false, 'cancelled VALIDATE leaves the constraint NOT VALID (still enforced on new writes), safe to retry');
    ok = ok && cv && cv.convalidated === false;
  }
  await c.end();
  return Boolean(ok);
}

async function main() {
  console.log('WHO: local harness (not production), prove-safe-plan.js');
  console.log(`DATABASE_URL host used: ${url.replace(/:[^:@/]+@/, ':***@')}`);
  console.log(`ROW_COUNT=${ROWS} TX_ROW_COUNT=${TX_ROWS} WRITERS=${WRITERS}`);
  console.log('PRODUCTION NOT TOUCHED. Replica lag NOT measured. Writers are not a calibrated 800 inserts/s.');

  const r = {};
  r.t4t5 = await testExpandAndUpdateCost();
  r.t6 = await testIndexModes();
  r.t7 = await testCheckModes();
  r.t8 = await testLockQueue();
  r.t9 = await testSingleTransactionUp();
  r.t10 = await testPlanB();

  console.log('\n=== SUMMARY ===');
  console.log(`T4/T5 expand compatible + UPDATE cost : ${r.t4t5 ? 'CONFIRMED' : 'NOT CONFIRMED'}`);
  console.log(`T6    index plain vs CONCURRENTLY      : ${r.t6 ? 'CONFIRMED' : 'NOT CONFIRMED'}`);
  console.log(`T7    CHECK plain vs NOT VALID/VALIDATE: ${r.t7 ? 'CONFIRMED' : 'NOT CONFIRMED'}`);
  console.log(`T8    lock queue / lock_timeout        : ${r.t8 ? 'CONFIRMED' : 'NOT CONFIRMED'}`);
  console.log(`T9    up() in one transaction          : ${r.t9 ? 'CONFIRMED' : 'NOT CONFIRMED'}`);
  console.log(`T10   Plan B cancel behaviour          : ${r.t10 ? 'CONFIRMED' : 'NOT CONFIRMED'}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
