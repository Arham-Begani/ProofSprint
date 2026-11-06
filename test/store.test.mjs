import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { SessionStore } from '../src/store.mjs';
import { digitPacket, practiceCandidate } from '../src/demo.mjs';
const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
const workspace = () => mkdtemp(join(tmpdir(), 'proofsprint-test-'));

test('state survives process-independent reloads with immutable audit events', async () => {
  const dir = await workspace(); const store = new SessionStore(dir);
  const created = await store.create(digitPacket());
  await store.append(created.id, { type: 'candidate', value: practiceCandidate(digitPacket(), [7, 3], 'solver-a', 'a') }, 0);
  const loaded = await new SessionStore(dir).load(created.id);
  assert.equal(loaded.state.revision, 1); assert.equal(loaded.eventCount, 2); assert.equal(loaded.state.candidates[0].answer, '7,3');
  await assert.rejects(store.append(created.id, { type: 'candidate', value: practiceCandidate(digitPacket(), [7, 3], 'solver-b', 'b') }, 0), /Revision conflict/);
  assert.equal((await store.load(created.id)).eventCount, 2);
});

test('session path traversal is refused', async () => {
  const store = new SessionStore(await workspace());
  await assert.rejects(store.load('../outside'), /session id/);
  await assert.rejects(store.load('C:\\outside'), /session id/);
});

test('changed audit content is detected before it can be used', async () => {
  const dir = await workspace(); const store = new SessionStore(dir); const { id } = await store.create(digitPacket());
  const file = join(dir, '.proofsprint', 'sessions', id, '00000000.json');
  const event = JSON.parse(await readFile(file, 'utf8')); event.action.value.text = 'Tampered puzzle';
  await writeFile(file, JSON.stringify(event));
  await assert.rejects(store.load(id), /integrity check failed/);
});

test('unfinished temporary writes are not treated as committed events', async () => {
  const dir = await workspace(); const store = new SessionStore(dir); const { id } = await store.create(digitPacket());
  await writeFile(join(dir, '.proofsprint', 'sessions', id, '00000001.json.partial.tmp'), '{unfinished');
  assert.equal((await store.load(id)).state.revision, 0);
});

test('an active or stale lock prevents overlapping writes without deleting the lock', async () => {
  const dir = await workspace(); const store = new SessionStore(dir); const { id } = await store.create(digitPacket());
  await mkdir(join(dir, '.proofsprint', 'sessions', id, '.write-lock'));
  await assert.rejects(store.append(id, { type: 'candidate', value: practiceCandidate(digitPacket(), [7, 3], 'solver-a', 'a') }, 0), /Session is busy/);
  assert.equal((await store.load(id)).eventCount, 1);
});

test('CLI completes a durable rehearsal and refuses to overwrite a draft', async () => {
  const dir = await workspace();
  const demo = JSON.parse((await exec(process.execPath, [cli, 'demo', 'unique'], { cwd: dir })).stdout);
  assert.equal(demo.revision, 4); assert.match(demo.label, /NO MODEL CALLS/);
  const output = join(dir, 'answer.md');
  await exec(process.execPath, [cli, 'export', demo.sessionId, 'solver-a-0', output], { cwd: dir });
  assert.match(await readFile(output, 'utf8'), /DRAFT/);
  await assert.rejects(exec(process.execPath, [cli, 'export', demo.sessionId, 'solver-a-0', output], { cwd: dir }), /EEXIST/);
  const prompt = JSON.parse((await exec(process.execPath, [cli, 'prompt', demo.sessionId, 'solver-b'], { cwd: dir })).stdout);
  assert.equal(prompt.candidate, undefined);
});

test('CLI ambiguous rehearsal cannot export and unknown external actions fail', async () => {
  const dir = await workspace();
  const demo = JSON.parse((await exec(process.execPath, [cli, 'demo', 'ambiguous'], { cwd: dir })).stdout);
  assert.equal(demo.draft, null);
  await assert.rejects(exec(process.execPath, [cli, 'export', demo.sessionId, 'solver-a-0', join(dir, 'answer.md')], { cwd: dir }), /not ready/);
  await assert.rejects(exec(process.execPath, [cli, 'submit'], { cwd: dir }), /Unknown command/);
});
