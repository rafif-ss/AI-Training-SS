const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SECRET = 'whsec_test_sample_only';
const rawText = '{"type":"payment.succeeded","data":{"order_id":"ord_42","url":"https:\\/\\/pay.example\\/r\\/ord_42"}}';
const rawBody = Buffer.from(rawText, 'utf8');

function hmacHex(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

const providerHex = hmacHex(SECRET, rawBody);
const sample = {
  rawBody: rawText,
  headers: {
    'x-webhook-signature': `sha256=${providerHex}`,
    'x-webhook-timestamp': '1710000000',
    'content-type': 'application/json',
  },
  secret: SECRET,
};

const parsed = JSON.parse(rawText);
const restring = JSON.stringify(parsed);
const aiHex = hmacHex(SECRET, restring);
const lines = [];
function log(line = '') {
  lines.push(line);
  console.log(line);
}

log('SAMPLE FROM THE PROVIDER DASHBOARD');
log(`raw body: ${rawText}`);
log(`header X-Webhook-Signature: sha256=${providerHex}`);
log('');
log('WHAT THE AI SIGNS');
log(`JSON.stringify(req.body): ${restring}`);
log(`strings are identical: ${rawText === restring}`);
log(`AI hex: ${aiHex}`);
log('');
log('1. AI handler against the real sample');
const aiHeader = sample.headers['x-signature'];
const aiRejects = aiHeader !== aiHex;
log(`req.headers['x-signature'] = ${String(aiHeader)}`);
log(`comparison sig !== expected is ${aiHeader !== aiHex}`);
log(`HTTP status: ${aiRejects ? '401 bad signature' : '200 ok'}`);
log(`result: ${aiRejects ? 'FAIL as in staging. Every real event is rejected.' : 'unexpected match'}`);
log('');
log('2. Which recipe matches the sample?');
const recipes = [
  ['AI: JSON.stringify, bare hex, header x-signature', sample.headers['x-signature'] === aiHex],
  ['raw body, bare hex, compared to the whole header', sample.headers['x-webhook-signature'] === providerHex],
  ['raw body, prefix sha256=, header X-Webhook-Signature', sample.headers['x-webhook-signature'] === `sha256=${providerHex}`],
  ['timestamp + "." + raw body', sample.headers['x-webhook-signature'] === `sha256=${hmacHex(SECRET, `1710000000.${rawText}`)}`],
];
for (const [name, matched] of recipes) {
  log(`${matched ? 'MATCH' : 'no   '}  ${name}`);
}
log('');
log('3. Temporary bypass');
const forged = '{"type":"payment.succeeded","data":{"order_id":"ord_hacked"}}';
const forgedHeader = 'not-a-signature';
const bypassAccepts = true;
log(`forged order_id ord_hacked, signature "${forgedHeader}"`);
log(`strict AI check would answer 401`);
log(`temporary bypass answers 200 and marks ord_hacked paid: ${bypassAccepts}`);
log('');
log('4. markOrderPaid throws');
log('AI catch block answers 200, so the provider does not retry');
log('fixed handler answers 500, so the provider retries');
log('');
const matchedRecipe = recipes.filter((item) => item[1]).map((item) => item[0]);
log(`MATCHED RECIPE: ${matchedRecipe.join(' | ') || 'none'}`);

const html = `<!doctype html>
<meta charset="utf-8">
<title>Webhook sample check</title>
<style>
  body { font-family: Georgia, serif; background: #f6f5f2; color: #1c1b19; margin: 32px auto; max-width: 920px; }
  h1 { font-size: 28px; margin-bottom: 4px; }
  p { color: #444; }
  pre { background: #1c1b19; color: #f4f1ea; padding: 20px; border-radius: 8px; overflow: auto; font-family: Consolas, monospace; font-size: 13px; line-height: 1.45; }
  .fail { color: #ffb4a8; }
  .ok { color: #b7e4c7; }
</style>
<h1>Webhook sample check</h1>
<p>One saved provider event. No call to the provider. The AI handler rejects it. One recipe matches.</p>
<pre>${lines.map((line) => {
  if (line.startsWith('FAIL') || line.startsWith('result: FAIL') || line.includes('401')) return `<span class="fail">${line}</span>`;
  if (line.startsWith('MATCH') || line.startsWith('MATCHED')) return `<span class="ok">${line}</span>`;
  return line;
}).join('\n')}</pre>`;

fs.writeFileSync(path.join(__dirname, 'result.html'), html);
if (!matchedRecipe.length || aiRejects !== true) process.exit(1);
