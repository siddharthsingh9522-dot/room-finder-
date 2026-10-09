// Black-box checks for the deployed Workers. Usage: STORAGE=https://... AI=https://... node tests/smoke.mjs
const S = process.env.STORAGE, A = process.env.AI;
let fail = 0;
const t = async (name, fn) => { try { await fn(); console.log('PASS', name); } catch (e) { fail++; console.log('FAIL', name, '-', e.message); } };
const eq = (a, b) => { if (a !== b) throw new Error(`expected ${b}, got ${a}`); };
if (S) {
  await t('storage: upload without token -> 401', async () => eq((await fetch(S + '/upload', { method: 'PUT', body: new Uint8Array([255, 216, 255]) })).status, 401));
  await t('storage: delete without token -> 401', async () => eq((await fetch(S + '/object?key=listings/x/y.jpg', { method: 'DELETE' })).status, 401));
  await t('storage: forged token -> 401', async () => eq((await fetch(S + '/upload', { method: 'PUT', headers: { Authorization: 'Bearer abc.def.ghi' }, body: new Uint8Array([255, 216, 255]) })).status, 401));
}
if (A) {
  await t('ai: no token -> 401', async () => eq((await fetch(A, { method: 'POST', body: '{"task":"parse","payload":{"q":"x"}}' })).status, 401));
}
if (!S && !A) console.log('Set STORAGE and/or AI env vars.');
console.log(fail ? `${fail} FAILED` : 'ALL PASSED'); process.exit(fail ? 1 : 0);
