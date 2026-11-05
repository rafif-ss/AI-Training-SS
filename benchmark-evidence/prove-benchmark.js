/**
 * Week 3 evidence: why "40% faster on 1,000 rows" does not prove production fitness.
 * This script does not touch production. It measures a tiny local loop and prints
 * production-scale arithmetic from the challenge facts.
 */
const crypto = require('crypto');

const FACTS = {
  matchRows: 1_200_000,
  distinctCustomers: 40_000,
  avgRowBytes: 2_048,
  rttMs: 1.5,
  containerMb: 512,
  gatewaySec: 30,
  sampleRows: 1_000,
  sampleCustomers: 50,
};

function estimate() {
  const payloadMb = (FACTS.matchRows * FACTS.avgRowBytes) / (1024 * 1024);
  const customerQueries = FACTS.distinctCustomers; // with per-request name cache
  const minRoundTrips = 1 + customerQueries;
  const minNetworkSec = (minRoundTrips * FACTS.rttMs) / 1000;
  const csvCharsRough = FACTS.matchRows * 40; // id,name,total rough
  const csvMb = (csvCharsRough * 2) / (1024 * 1024); // JS strings ~2 bytes/code unit rough

  return {
    payloadMb: payloadMb.toFixed(1),
    fitsInContainer: payloadMb < FACTS.containerMb,
    minRoundTrips,
    minNetworkSec: minNetworkSec.toFixed(1),
    beatsGateway: minNetworkSec < FACTS.gatewaySec,
    csvMb: csvMb.toFixed(1),
    sampleQueriesIf50Customers: 1 + FACTS.sampleCustomers,
  };
}

function localMicrobench() {
  // Tiny in-process stand-in: sequential "queries" at 0 ms RTT, 1000 rows, 50 customers.
  // This is the kind of warm localhost number the AI's claim resembles — not production.
  const rows = Array.from({ length: FACTS.sampleRows }, (_, i) => ({
    id: i + 1,
    customer_id: (i % FACTS.sampleCustomers) + 1,
    total: 10,
  }));
  const namesDb = Object.fromEntries(
    Array.from({ length: FACTS.sampleCustomers }, (_, i) => [i + 1, `Customer ${i + 1}`])
  );

  const t0 = process.hrtime.bigint();
  const names = {};
  let csv = 'id,customer,total\n';
  let lookups = 0;
  for (const o of rows) {
    if (names[o.customer_id] === undefined) {
      names[o.customer_id] = namesDb[o.customer_id];
      lookups += 1;
    }
    csv += `${o.id},${names[o.customer_id]},${o.total}\n`;
  }
  const t1 = process.hrtime.bigint();
  const ms = Number(t1 - t0) / 1e6;
  return { ms: ms.toFixed(2), lookups, csvBytes: Buffer.byteLength(csv) };
}

const est = estimate();
const local = localMicrobench();

console.log('WHO RAN THIS: local Node script on developer machine');
console.log('DATA: challenge production facts + synthetic 1,000-row in-memory stand-in');
console.log('PRODUCTION NOT TOUCHED');
console.log('');
console.log('--- Production arithmetic from stated facts ---');
console.log(`matched rows: ${FACTS.matchRows}`);
console.log(`avg row size if SELECT * (~2 KB): ${FACTS.avgRowBytes} bytes`);
console.log(`estimated orders payload: ${est.payloadMb} MB`);
console.log(`container RAM: ${FACTS.containerMb} MB`);
console.log(`payload fits in container alone: ${est.fitsInContainer}`);
console.log(`distinct customers (cached name lookups): ${FACTS.distinctCustomers}`);
console.log(`minimum DB round-trips (1 orders + N customers): ${est.minRoundTrips}`);
console.log(`DB RTT: ${FACTS.rttMs} ms`);
console.log(`minimum network time ignoring query work: ${est.minNetworkSec} s`);
console.log(`under 30 s gateway on network alone: ${est.beatsGateway}`);
console.log(`rough CSV string size at ~40 chars/row: ${est.csvMb} MB (extra heap on top of rows)`);
console.log('');
console.log('--- Why the 1,000-row claim is a different system ---');
console.log(`sample rows: ${FACTS.sampleRows}, sample distinct customers assumed: ${FACTS.sampleCustomers}`);
console.log(`sample round-trips with cache: ${est.sampleQueriesIf50Customers}`);
console.log(`sample network floor at 1.5 ms RTT: ${((1 + FACTS.sampleCustomers) * FACTS.rttMs).toFixed(1)} ms`);
console.log(`local zero-RTT microbench: ${local.ms} ms, lookups=${local.lookups}, csvBytes=${local.csvBytes}`);
console.log('That localhost number does not include SELECT *, jsonb, 1.5 ms RTT, or 512 MB limit.');
console.log('');
console.log('--- Linear scaling claim check ---');
const sampleNetwork = (1 + FACTS.sampleCustomers) * FACTS.rttMs;
const prodNetwork = (1 + FACTS.distinctCustomers) * FACTS.rttMs;
const rowScale = FACTS.matchRows / FACTS.sampleRows;
const networkScale = prodNetwork / sampleNetwork;
console.log(`row count scale 1.2M/1000: ${rowScale}x`);
console.log(`customer-lookup network scale: ${networkScale.toFixed(1)}x`);
console.log('If AI measured 70 ms on sample, naive linear-by-rows would predict');
console.log(`  70 ms * ${rowScale} = ${(70 * rowScale / 1000).toFixed(1)} s of fantasy`);
console.log('Network floor alone at production distinct customers:');
console.log(`  ${prodNetwork.toFixed(0)} ms = ${(prodNetwork / 1000).toFixed(1)} s (> 30 s gateway)`);
console.log('');
console.log('VERDICT FROM ARITHMETIC: AI claims cannot hold under stated production facts.');
