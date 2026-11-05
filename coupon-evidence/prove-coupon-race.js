/**
 * Concrete evidence for the coupon-redeem claim.
 *
 * This does not mock the database. Two real PostgreSQL sessions run the AI's
 * check-then-insert pattern. A barrier holds both of them after COUNT(*) and
 * before INSERT, so the result does not depend on lucky timing.
 *
 * Run (throwaway server on port 5433, trust auth, no password):
 *   node prove-coupon-race.js
 *
 * The process exits 0 only if the observed rows match the claims.
 */
import pg from 'pg';

const { Pool, Client } = pg;
const url = process.env.DATABASE_URL ?? 'postgres://postgres@127.0.0.1:5433/postgres';

let failures = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function barrier(parties) {
  let arrived = 0;
  let open;
  const gate = new Promise((resolve) => {
    open = resolve;
  });
  return () => {
    arrived += 1;
    if (arrived === parties) open();
    return gate;
  };
}

function check(label, actual, expected) {
  const pass = actual === expected;
  if (!pass) failures += 1;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}`);
  console.log(`      expected: ${expected}`);
  console.log(`      actual:   ${actual}`);
}

async function reset(pool) {
  await pool.query('TRUNCATE redemptions RESTART IDENTITY');
  await pool.query('UPDATE coupons SET redemption_count = 0 WHERE code = $1', ['FLASH']);
}

async function redemptionCount(pool) {
  const { rows } = await pool.query(
    'SELECT COUNT(*)::int AS n FROM redemptions WHERE coupon_id = 1'
  );
  return rows[0].n;
}

/**
 * Same order as the AI handler: BEGIN, count, compare, insert, COMMIT.
 * No row lock. Default isolation is READ COMMITTED.
 * `afterCount` lets the test pause both sessions before either insert.
 */
async function aiRedeem(client, userId, afterCount) {
  await client.query('BEGIN');
  const { rows: [coupon] } = await client.query(
    'SELECT id, max_redemptions FROM coupons WHERE code = $1',
    ['FLASH']
  );
  if (!coupon) return { status: 404, saw: null };

  const { rows: [{ count }] } = await client.query(
    'SELECT COUNT(*)::int AS count FROM redemptions WHERE coupon_id = $1',
    [coupon.id]
  );
  if (afterCount) await afterCount(count);

  if (count >= coupon.max_redemptions) {
    await client.query('ROLLBACK');
    return { status: 409, saw: count };
  }

  await client.query(
    'INSERT INTO redemptions (coupon_id, user_id) VALUES ($1, $2)',
    [coupon.id, userId]
  );
  await client.query('COMMIT');
  return { status: 200, saw: count };
}

/** The tempting "one statement" fix. The sleep is inside the count, so both statements take a snapshot before either insert commits. */
async function singleStatementRedeem(client, userId) {
  const result = await client.query(
    `INSERT INTO redemptions (coupon_id, user_id)
     SELECT id, $1::int
     FROM coupons
     WHERE code = 'FLASH'
       AND pause_then_count(id) < max_redemptions
     RETURNING id`,
    [userId]
  );
  return { status: result.rowCount === 1 ? 200 : 409 };
}

/**
 * Safe pattern under READ COMMITTED:
 * lock the single coupon row first, then count and insert.
 * The unique key stops a second redeem by the same user.
 */
async function fixedRedeem(client, userId) {
  await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
  try {
    const { rows: [coupon] } = await client.query(
      `SELECT id, max_redemptions, redemption_count
       FROM coupons
       WHERE code = $1
       FOR UPDATE`,
      ['FLASH']
    );
    if (!coupon) {
      await client.query('ROLLBACK');
      return { status: 404 };
    }

    await sleep(300);

    if (coupon.redemption_count >= coupon.max_redemptions) {
      await client.query('ROLLBACK');
      return { status: 409, reason: 'exhausted' };
    }

    const existing = await client.query(
      'SELECT 1 FROM redemptions WHERE coupon_id = $1 AND user_id = $2',
      [coupon.id, userId]
    );
    if (existing.rowCount > 0) {
      await client.query('ROLLBACK');
      return { status: 409, reason: 'already redeemed' };
    }

    await client.query(
      'INSERT INTO redemptions (coupon_id, user_id) VALUES ($1, $2)',
      [coupon.id, userId]
    );
    const updated = await client.query(
      `UPDATE coupons
       SET redemption_count = redemption_count + 1
       WHERE id = $1 AND redemption_count < max_redemptions`,
      [coupon.id]
    );
    if (updated.rowCount !== 1) {
      await client.query('ROLLBACK');
      return { status: 409, reason: 'exhausted' };
    }

    await client.query('COMMIT');
    return { status: 200 };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function activity(pid) {
  const watcher = new Client({ connectionString: url });
  await watcher.connect();
  const { rows } = await watcher.query(
    `SELECT state, xact_start IS NOT NULL AS transaction_open
     FROM pg_stat_activity
     WHERE pid = $1`,
    [pid]
  );
  await watcher.end();
  return rows[0] ?? { state: 'backend gone', transaction_open: false };
}

async function main() {
  const pool = new Pool({ connectionString: url, max: 4 });
  pool.on('error', () => {});

  await pool.query('DROP TABLE IF EXISTS redemptions');
  await pool.query('DROP TABLE IF EXISTS coupons');
  await pool.query(`
    CREATE TABLE coupons (
      id int PRIMARY KEY,
      code text UNIQUE NOT NULL,
      max_redemptions int NOT NULL,
      redemption_count int NOT NULL DEFAULT 0
    )
  `);
  await pool.query(`
    CREATE TABLE redemptions (
      id serial PRIMARY KEY,
      coupon_id int NOT NULL REFERENCES coupons (id),
      user_id int NOT NULL
    )
  `);
  await pool.query(
    `INSERT INTO coupons (id, code, max_redemptions) VALUES (1, 'FLASH', 1)`
  );
  await pool.query(`
    CREATE OR REPLACE FUNCTION pause_then_count(coupon_id int)
    RETURNS bigint
    LANGUAGE plpgsql
    AS $$
    DECLARE
      n bigint;
    BEGIN
      PERFORM pg_sleep(0.5);
      SELECT COUNT(*) INTO n FROM redemptions r WHERE r.coupon_id = pause_then_count.coupon_id;
      RETURN n;
    END;
    $$
  `);

  const version = await pool.query('SHOW server_version');
  const isolation = await pool.query('SHOW default_transaction_isolation');
  console.log(`server_version: ${version.rows[0].server_version}`);
  console.log(`default_transaction_isolation: ${isolation.rows[0].default_transaction_isolation}`);
  console.log('coupon FLASH max_redemptions = 1\n');

  console.log('--- 1. AI pattern, two different users, both paused after COUNT ---');
  {
    await reset(pool);
    const wait = barrier(2);
    const a = await pool.connect();
    const b = await pool.connect();
    try {
      const [first, second] = await Promise.all([
        aiRedeem(a, 101, async (saw) => {
          console.log(`user 101 read count = ${saw}, then waits`);
          await wait();
        }),
        aiRedeem(b, 102, async (saw) => {
          console.log(`user 102 read count = ${saw}, then waits`);
          await wait();
        }),
      ]);
      console.log(`user 101 status ${first.status}, user 102 status ${second.status}`);
      check('both sessions saw count 0', `${first.saw},${second.saw}`, '0,0');
      check('both sessions committed', `${first.status},${second.status}`, '200,200');
      check('rows saved (quota was 1)', String(await redemptionCount(pool)), '2');
    } finally {
      a.release();
      b.release();
    }
  }

  console.log('\n--- 2. AI pattern, same user, two parallel requests ---');
  {
    await reset(pool);
    const wait = barrier(2);
    const a = await pool.connect();
    const b = await pool.connect();
    try {
      const [first, second] = await Promise.all([
        aiRedeem(a, 101, () => wait()),
        aiRedeem(b, 101, () => wait()),
      ]);
      console.log(`status ${first.status} and ${second.status}`);
      check('same user got two committed redeems', `${first.status},${second.status}`, '200,200');
      check('rows for that user', String(await redemptionCount(pool)), '2');
    } finally {
      a.release();
      b.release();
    }
  }

  console.log('\n--- 3. Fake fix: one INSERT ... WHERE COUNT(*) < max ---');
  {
    await reset(pool);
    const a = await pool.connect();
    const b = await pool.connect();
    try {
      const [first, second] = await Promise.all([
        singleStatementRedeem(a, 201),
        singleStatementRedeem(b, 202),
      ]);
      console.log(`status ${first.status} and ${second.status}`);
      check('both single statements inserted', `${first.status},${second.status}`, '200,200');
      check('rows saved by the fake fix', String(await redemptionCount(pool)), '2');
    } finally {
      a.release();
      b.release();
    }
  }

  await pool.query(`
    ALTER TABLE redemptions
    ADD CONSTRAINT redemptions_one_per_user UNIQUE (coupon_id, user_id)
  `);

  console.log('\n--- 4. Real fix: FOR UPDATE on the coupon row, two users ---');
  {
    await reset(pool);
    const a = await pool.connect();
    const b = await pool.connect();
    const started = Date.now();
    try {
      const [first, second] = await Promise.all([
        fixedRedeem(a, 301).then((result) => ({ ...result, ms: Date.now() - started })),
        fixedRedeem(b, 302).then((result) => ({ ...result, ms: Date.now() - started })),
      ]);
      console.log(`user 301 finished in ${first.ms}ms with ${first.status} ${first.reason ?? ''}`.trim());
      console.log(`user 302 finished in ${second.ms}ms with ${second.status} ${second.reason ?? ''}`.trim());
      const statuses = [first.status, second.status].sort().join(',');
      check('one winner and one rejection', statuses, '200,409');
      check('rows saved by the real fix', String(await redemptionCount(pool)), '1');
    } finally {
      a.release();
      b.release();
    }
  }

  console.log('\n--- 5. Real fix: same user, two parallel requests ---');
  {
    await reset(pool);
    const a = await pool.connect();
    const b = await pool.connect();
    try {
      const [first, second] = await Promise.all([
        fixedRedeem(a, 401),
        fixedRedeem(b, 401),
      ]);
      const statuses = [first.status, second.status].sort().join(',');
      check('second redeem by the same user is rejected', statuses, '200,409');
      check('rows for that user after the fix', String(await redemptionCount(pool)), '1');
    } finally {
      a.release();
      b.release();
    }
  }

  console.log('\n--- 6. AI 404 path: BEGIN, return, release, no ROLLBACK ---');
  {
    const leaky = new Pool({ connectionString: url, max: 1 });
    leaky.on('error', () => {});
    const client = await leaky.connect();
    const { rows } = await client.query('SELECT pg_backend_pid() AS pid');
    const pid = rows[0].pid;
    await client.query('BEGIN');
    const coupon = await client.query(
      'SELECT id FROM coupons WHERE code = $1',
      ['MISSING']
    );
    if (coupon.rowCount === 0) {
      client.release();
    }
    await sleep(100);
    const after = await activity(pid);
    console.log(`after release: state=${after.state}, transaction_open=${after.transaction_open}`);
    check('connection returned to the pool still inside a transaction', String(after.transaction_open), 'true');

    const again = await leaky.connect();
    await again.query('ROLLBACK');
    again.release();
    await sleep(100);
    const clean = await activity(pid);
    console.log(`after ROLLBACK and release: state=${clean.state}, transaction_open=${clean.transaction_open}`);
    check('ROLLBACK before release closes the transaction', String(clean.transaction_open), 'false');
    await leaky.end();
  }

  await pool.end();

  console.log(`\n${failures === 0 ? 'EVIDENCE HOLDS' : 'EVIDENCE FAILED'}: ${failures} mismatched checks`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
