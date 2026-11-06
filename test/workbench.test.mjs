import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startWorkbench } from '../src/workbench.mjs';
import { digitPacket } from '../src/demo.mjs';

async function fixture(t, workspace) {
  workspace ??= await mkdtemp(join(tmpdir(), 'proofsprint-web-'));
  const app = await startWorkbench({ workspace, port: 0 });
  t.after(() => app.close());
  const bootstrap = await (await fetch(`${app.url}/api/bootstrap`)).json();
  const post = (path, value, extra = {}) => fetch(`${app.url}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: app.url, 'X-ProofSprint-Token': bootstrap.token, ...extra }, body: JSON.stringify(value) });
  return { ...app, workspace, bootstrap, post };
}

test('workbench serves real assets and blocks cross-origin or tokenless mutations', async t => {
  const app = await fixture(t);
  const home = await fetch(app.url);
  assert.equal(home.status, 200); assert.match(home.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(await home.text(), /Keep the proof/);
  assert.equal((await fetch(`${app.url}/app.js`)).status, 200);
  assert.equal((await fetch(`${app.url}/styles.css`)).status, 200);
  assert.equal((await app.post('/api/practice', { kind: 'unique' }, { Origin: 'https://untrusted.example' })).status, 403);
  assert.equal((await app.post('/api/practice', { kind: 'unique' }, { 'X-ProofSprint-Token': 'wrong' })).status, 403);
  assert.deepEqual(await (await fetch(`${app.url}/api/sessions`)).json(), []);
});

test('workbench creates persistent practice and gates draft previews and downloads', async t => {
  const app = await fixture(t);
  for (const kind of ['unique', 'ambiguous']) {
    const created = await app.post('/api/practice', { kind }); assert.equal(created.status, 201);
    const { sessionId } = await created.json();
    const loaded = await (await fetch(`${app.url}/api/sessions/${sessionId}`)).json();
    assert.ok(loaded.state.revision > 0);
    const candidateId = loaded.state.candidates[0].id;
    const draft = await fetch(`${app.url}/api/sessions/${sessionId}/draft/${candidateId}`);
    assert.equal(draft.status, kind === 'unique' ? 200 : 409);
    if (kind === 'unique') {
      assert.match((await draft.json()).draft, /7,3/);
      const download = await fetch(`${app.url}/api/sessions/${sessionId}/draft/${candidateId}?download=1`);
      assert.match(download.headers.get('content-disposition'), /attachment/);
      assert.match(await download.text(), /PRACTICE.*NOT SUBMITTED/);
    }
  }
  assert.equal((await (await fetch(`${app.url}/api/sessions`)).json()).length, 2);
  const second = await fixture(t, app.workspace);
  assert.equal((await (await fetch(`${second.url}/api/sessions`)).json()).length, 2);
});

test('imports are validated, remain literal data, and never turn malformed bodies into sessions', async t => {
  const app = await fixture(t);
  assert.equal((await app.post('/api/sessions', { packet: {} })).status, 400);
  assert.equal((await app.post('/api/sessions', null)).status, 400);
  assert.equal((await app.post('/api/sessions', { packet: { text: 'x'.repeat(1100001) } })).status, 413);
  assert.deepEqual(await (await fetch(`${app.url}/api/sessions`)).json(), []);
  const packet = { ...digitPacket(), title: '<img src=x onerror="alert(1)">' };
  const response = await app.post('/api/sessions', { packet });
  assert.equal(response.status, 201);
  const { sessionId } = await response.json();
  const detail = await (await fetch(`${app.url}/api/sessions/${sessionId}`)).json();
  assert.equal(detail.state.packet.title, packet.title);
  assert.equal((await fetch(`${app.url}/api/sessions/not-a-session`)).status, 404);
  assert.equal((await fetch(`${app.url}/api/submit`)).status, 404);
});

test('published practice runs through the API without live inference and preserves rejected controls', async t => {
  const app = await fixture(t);
  const response = await app.post('/api/practice', { kind: 'public' });
  assert.equal(response.status, 201);
  const report = await response.json();
  assert.equal(report.answer, 233168); assert.equal(report.reportKind, 'deterministic');
  const loaded = await (await fetch(`${app.url}/api/sessions/${report.sessionId}`)).json();
  assert.equal(loaded.state.revision, 8);
  assert.equal(loaded.assessment.filter(a => a.status === 'rejected').length, 2);
});

test('the browser cannot trigger disabled model usage or submit external actions', async t => {
  const previous = process.env.PROOFSPRINT_ENABLE_MODEL_CALLS;
  process.env.PROOFSPRINT_ENABLE_MODEL_CALLS = '0';
  t.after(() => { if (previous === undefined) delete process.env.PROOFSPRINT_ENABLE_MODEL_CALLS; else process.env.PROOFSPRINT_ENABLE_MODEL_CALLS = previous; });
  const app = await fixture(t);
  assert.equal(app.bootstrap.models.ready, false);
  const { sessionId } = await (await app.post('/api/practice', { kind: 'unique' })).json();
  const result = await app.post(`/api/sessions/${sessionId}/run`, { expectedRevision: 4, confirmModelUsage: true });
  assert.equal(result.status, 409);
  assert.match((await result.json()).error, /not configured and enabled/);
  assert.equal((await app.post('/api/submit', { sessionId })).status, 404);
});
