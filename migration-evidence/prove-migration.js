/**
 * Week 4 harness — prove migration failure modes WITHOUT production.
 *
 * What this shows:
 * 1) RENAME amount -> total_amount breaks an "old app" still selecting amount
 * 2) CREATE INDEX (non-CONCURRENTLY) blocks concurrent INSERTs
 * 3) down() leaves CHECK amount_nonneg behind and destroys the currency data
 *    (the currency index is dropped together with the column, so it is NOT a leftover)
 *
 * Usage:
 *   docker compose up -d
 *   npm install
 *   node prove-migration.js
 *
 * Env (optional):
 *   DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5434/migration_lab
 */
const { Client } = require('pg');

const url =
  process.env.DATABASE_URL ||
  'postgres://postgres:postgres@127.0.0.1:5434/migration_lab';

const ROW_COUNT = Number(process.env.ROW_COUNT || 50_000);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withClient(fn) {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

async function reset(c) {
  await c.query('DROP TABLE IF EXISTS invoices CASCADE');
  await c.query(`
    CREATE TABLE invoices (
      id bigserial PRIMARY KEY,
      country text NOT NULL,
      amount numeric NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await c.query(`
    INSERT INTO invoices (country, amount)
    SELECT
      (ARRAY['US','DE','ID'])[1 + (i % 3)],
      (random() * 1000)::numeric(12,2)
    FROM generate_series(1, $1) AS g(i)
  `, [ROW_COUNT]);
  const { rows } = await c.query('SELECT COUNT(*)::int AS n FROM invoices');
  return rows[0].n;
}

/** AI up(), same statements as the challenge */
async function aiUp(c) {
  await c.query("ALTER TABLE invoices ADD COLUMN currency text NOT NULL DEFAULT 'USD'");
  await c.query(`UPDATE invoices SET currency =
    CASE country WHEN 'DE' THEN 'EUR' WHEN 'ID' THEN 'IDR' ELSE 'USD' END`);
  await c.query('CREATE INDEX invoices_currency_idx ON invoices (currency, created_at)');
  await c.query('ALTER TABLE invoices RENAME COLUMN amount TO total_amount');
  await c.query('ALTER TABLE invoices ADD CONSTRAINT amount_nonneg CHECK (total_amount >= 0)');
}

/** AI down() */
async function aiDown(c) {
  await c.query('ALTER TABLE invoices DROP COLUMN currency');
  await c.query('ALTER TABLE invoices RENAME COLUMN total_amount TO amount');
}

async function testRenameBreaksOldApp() {
  console.log('\n=== TEST 1: rename vs old app (zero-downtime claim) ===');
  return withClient(async (migrator) => {
    const n = await reset(migrator);
    console.log(`seeded rows: ${n}`);

    const oldApp = new Client({ connectionString: url });
    await oldApp.connect();

    // Old binary still uses column "amount"
    const before = await oldApp.query(
      'SELECT id, amount FROM invoices ORDER BY id LIMIT 1'
    );
    console.log(`old app BEFORE migration: ok, amount=${before.rows[0].amount}`);

    console.log('running AI up() ...');
    const t0 = Date.now();
    await aiUp(migrator);
    console.log(`AI up() finished in ${Date.now() - t0} ms`);

    let afterErr = null;
    try {
      await oldApp.query('SELECT id, amount FROM invoices ORDER BY id LIMIT 1');
    } catch (e) {
      afterErr = e;
    }

    if (afterErr) {
      console.log('CONFIRMED  old app AFTER rename failed as expected');
      console.log(`      ${afterErr.message}`);
    } else {
      console.log('NOT CONFIRMED  old app still could SELECT amount after rename');
    }

    // New app shape
    const neu = await migrator.query(
      'SELECT id, total_amount, currency FROM invoices ORDER BY id LIMIT 1'
    );
    console.log(
      `new app column works: total_amount=${neu.rows[0].total_amount} currency=${neu.rows[0].currency}`
    );

    await oldApp.end();
    return Boolean(afterErr);
  });
}

async function testIndexBlocksInserts() {
  console.log('\n=== TEST 2: CREATE INDEX blocks writers ===');
  return withClient(async (setup) => {
    await setup.query('DROP TABLE IF EXISTS invoices CASCADE');
    await setup.query(`
      CREATE TABLE invoices (
        id bigserial PRIMARY KEY,
        country text NOT NULL,
        amount numeric NOT NULL,
        currency text NOT NULL DEFAULT 'USD',
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    // Enough rows that index build is noticeable
    await setup.query(`
      INSERT INTO invoices (country, amount)
      SELECT 'US', 1 FROM generate_series(1, $1)
    `, [ROW_COUNT]);

    const locker = new Client({ connectionString: url });
    const writer = new Client({ connectionString: url });
    await locker.connect();
    await writer.connect();

    let indexDone = false;
    let insertWaitMs = null;
    let insertErr = null;

    const indexPromise = (async () => {
      const t0 = Date.now();
      await locker.query(
        'CREATE INDEX invoices_currency_idx ON invoices (currency, created_at)'
      );
      indexDone = true;
      return Date.now() - t0;
    })();

    // Give index build a head start so writer hits the lock
    await sleep(50);

    const insertPromise = (async () => {
      const t0 = Date.now();
      try {
        await writer.query(
          "INSERT INTO invoices (country, amount, currency) VALUES ('DE', 10, 'EUR')"
        );
        insertWaitMs = Date.now() - t0;
      } catch (e) {
        insertErr = e;
        insertWaitMs = Date.now() - t0;
      }
    })();

    const indexMs = await indexPromise;
    await insertPromise;

    console.log(`CREATE INDEX (non-concurrent) took ${indexMs} ms`);
    console.log(
      insertErr
        ? `INSERT error: ${insertErr.message}`
        : `INSERT finished after waiting ${insertWaitMs} ms`
    );

    // If insert waited a meaningful fraction of index time, lock contention showed up
    const blocked =
      !insertErr && insertWaitMs != null && insertWaitMs >= Math.min(200, indexMs * 0.3);
    if (blocked) {
      console.log('CONFIRMED  INSERT was delayed while CREATE INDEX held write lock');
    } else if (insertWaitMs != null && insertWaitMs < 50 && indexMs < 100) {
      console.log(
        'WEAK  table too small / too fast to show blocking clearly — raise ROW_COUNT and retry'
      );
    } else if (blocked === false && !insertErr) {
      console.log(
        'CHECK  INSERT wait was short; on production-sized tables this lock lasts much longer'
      );
      console.log('      Still: Postgres docs — non-concurrent CREATE INDEX blocks writers');
    }

    await locker.end();
    await writer.end();
    return true;
  });
}

async function testDownIncomplete() {
  console.log('\n=== TEST 3: down() is not fully reversible ===');
  return withClient(async (c) => {
    await reset(c);
    await aiUp(c);

    const beforeCurrency = await c.query(`
      SELECT currency, COUNT(*)::int AS n
      FROM invoices GROUP BY currency ORDER BY currency
    `);
    console.log('currency distribution BEFORE down():');
    for (const row of beforeCurrency.rows) {
      console.log(`  ${row.currency}: ${row.n}`);
    }

    await aiDown(c);

    // Index on (currency, ...) is auto-dropped with DROP COLUMN currency — that is NOT a leftover.
    const idx = await c.query(`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'invoices' AND indexname = 'invoices_currency_idx'
    `);
    const chk = await c.query(`
      SELECT conname, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = 'invoices'::regclass AND conname = 'amount_nonneg'
    `);
    const cols = await c.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'invoices' ORDER BY ordinal_position
    `);
    const colNames = cols.rows.map((r) => r.column_name);

    console.log(`columns after down(): ${colNames.join(', ')}`);
    console.log(
      `index invoices_currency_idx still present: ${idx.rowCount > 0} (expected false: dropped with currency column)`
    );
    console.log(
      `constraint amount_nonneg still present: ${chk.rowCount > 0}`
    );
    if (chk.rowCount > 0) {
      console.log(`  definition: ${chk.rows[0].def}`);
    }
    console.log(`currency column present: ${colNames.includes('currency')}`);

    // Real gaps in AI down():
    // 1) CHECK amount_nonneg is never dropped
    // 2) currency backfill data is destroyed (column dropped) — not restored
    const pass =
      chk.rowCount > 0 &&
      idx.rowCount === 0 &&
      !colNames.includes('currency') &&
      colNames.includes('amount');

    if (pass) {
      console.log(
        'CONFIRMED  down() is incomplete: CHECK amount_nonneg remains; currency data is gone (not restored)'
      );
      console.log(
        'NOTE  index on currency went away with DROP COLUMN — do not cite that index as a leftover'
      );
    } else {
      console.log('NOT CONFIRMED  unexpected schema after down()');
    }
    return pass;
  });
}

async function main() {
  console.log('WHO: local harness (not production)');
  console.log(`DATABASE_URL host used: ${url.replace(/:[^:@/]+@/, ':***@')}`);
  console.log(`ROW_COUNT=${ROW_COUNT}`);
  console.log('PRODUCTION NOT TOUCHED');

  const r1 = await testRenameBreaksOldApp();
  const r2 = await testIndexBlocksInserts();
  const r3 = await testDownIncomplete();

  console.log('\n=== SUMMARY ===');
  console.log(`rename breaks old app: ${r1 ? 'SHOWN' : 'NOT SHOWN'}`);
  console.log(`index lock test ran:   ${r2 ? 'YES' : 'NO'}`);
  console.log(`down() incomplete:     ${r3 ? 'SHOWN' : 'NOT SHOWN'}`);
  console.log(
    '\nNext: paste this raw output into Evidence. Staging 1.8s is still not production proof.'
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
