import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { modelPreflight, createLiveAdapters } from '../src/live.ts';
import { initialState } from '../src/core.mjs';
import { runRound } from '../src/team.mjs';
import { runLiveSession } from '../src/run-live.mjs';
import { SessionStore } from '../src/store.mjs';
import { digitPacket, practiceCandidate, practiceReview } from '../src/demo.mjs';
import { blindChecklist, blindChecks } from './fixtures.mjs';

const env = { PROOFSPRINT_ENABLE_MODEL_CALLS: '1', PROOFSPRINT_MODEL: 'openai/gpt-6.1-sol', AI_GATEWAY_API_KEY: 'unit-test-not-a-credential' };
function fakeGenerator(seen = [], expectedTokens = 4000) {
  return async options => {
    seen.push(options);
    assert.equal(options.tools, undefined); assert.equal(options.maxRetries, 0); assert.equal(options.maxOutputTokens, expectedTokens);
    const input = JSON.parse(options.prompt);
    let output;
    if (options.system.includes('checklist author')) output = blindChecklist(input.packet);
    else if (options.system.includes('independent solver')) {
      const { id, role, packetDigest, ...body } = practiceCandidate(input.packet, [7, 3], input.role, 'fake'); output = body;
    } else {
      const { id, candidateId, candidateDigest, packetDigest, role, ...body } = practiceReview(input.packet, input.candidate, true); output = { ...body, ...blindChecks(input.checklist) };
    }
    return { output, usage: { inputTokens: 10, outputTokens: 20 } };
  };
}
test('live access is disabled by default without exposing credential values', () => {
  const status = modelPreflight({});
  assert.equal(status.ready, false); assert.equal(status.reasons.length, 3);
  assert.throws(() => createLiveAdapters({ env: {} }), /disabled/);
  assert.equal(JSON.stringify(modelPreflight(env)).includes(env.AI_GATEWAY_API_KEY), false);
});

test('the quality profile routes distinct solvers and maximum reasoning without removing request bounds', async () => {
  const seen = [];
  const quality = { ...env, PROOFSPRINT_MODEL: 'openai/gpt-6-astra', PROOFSPRINT_SOLVER_B_MODEL: 'openai/gpt-6.1-sol', PROOFSPRINT_REASONING: 'max', PROOFSPRINT_MAX_OUTPUT_TOKENS: '16000', PROOFSPRINT_TIMEOUT_MS: '600000' };
  const adapters = createLiveAdapters({ env: quality, generate: fakeGenerator(seen, 16000) });
  const result = await runRound(initialState(digitPacket()), adapters);
  assert.equal(result.report.status, 'completed');
  assert.equal(adapters.timeoutMs, 600000);
  for (const call of seen) {
    const input = JSON.parse(call.prompt);
    const isSolverB = call.system.includes('independent solver') && input.role === 'solver-b';
    assert.equal(call.model, isSolverB ? 'openai/gpt-6.1-sol' : 'openai/gpt-6-astra');
    assert.equal(call.reasoning, 'max');
  }
  assert.equal(adapters.usage.length, 5);
  assert.ok(adapters.usage.every(a => a.status === 'completed' && a.startedAt && a.finishedAt && a.model));
});

test('invalid role models, token bounds, timeout bounds and reasoning fail before any request', () => {
  for (const overrides of [{ PROOFSPRINT_SOLVER_B_MODEL: 'invalid' }, { PROOFSPRINT_MAX_OUTPUT_TOKENS: '32001' }, { PROOFSPRINT_MAX_OUTPUT_TOKENS: 'NaN' }, { PROOFSPRINT_TIMEOUT_MS: '0' }, { PROOFSPRINT_REASONING: 'infinite' }]) {
    assert.equal(modelPreflight({ ...env, ...overrides }).ready, false);
    assert.throws(() => createLiveAdapters({ env: { ...env, ...overrides } }));
  }
});

test('truncated generations cannot become a successful review even if output happens to parse', async () => {
  const adapters = createLiveAdapters({ env, generate: async () => ({ output: blindChecklist(digitPacket()), finishReason: 'length', usage: { outputTokens: 4000 } }) });
  await assert.rejects(adapters.prepareVerifier({}, new AbortController().signal), /did not finish normally: length/);
  assert.equal(adapters.usage[0].status, 'failed');
  assert.deepEqual(adapters.usage[0].usage, { outputTokens: 4000 });
});

test('failed requests retain attempt metadata and redact the configured key', async () => {
  const adapters = createLiveAdapters({ env, generate: async () => { throw new Error(`Provider rejected credential ${env.AI_GATEWAY_API_KEY}`); } });
  await assert.rejects(adapters.prepareVerifier({}, new AbortController().signal), /\[REDACTED\]/);
  assert.equal(adapters.usage[0].status, 'failed');
  assert.equal(adapters.usage[0].usage, null);
  assert.ok(adapters.usage[0].finishedAt);
  assert.equal(JSON.stringify(adapters.usage).includes(env.AI_GATEWAY_API_KEY), false);
});
test('typed model adapter and workflow integrate without any network calls', async () => {
  const seen = [];
  const adapters = createLiveAdapters({ env, generate: fakeGenerator(seen) });
  const result = await runRound(initialState(digitPacket()), adapters);
  assert.equal(result.report.status, 'completed'); assert.equal(seen.length, 5);
  assert.equal(result.report.executionKind, 'test-double'); assert.equal(adapters.usage.length, 5);
  for (const call of seen.filter(s => s.system.includes('independent solver'))) assert.equal(JSON.parse(call.prompt).candidate, undefined);
});
test('adapter rejects oversized input before generation and enforces its call cap', async () => {
  let calls = 0;
  const adapters = createLiveAdapters({ env, generate: async () => { calls++; return { output: blindChecklist(digitPacket()) }; } });
  await assert.rejects(adapters.prepareVerifier({ large: 'x'.repeat(65000) }, new AbortController().signal), /64 KB/);
  assert.equal(calls, 0);
  for (let i = 0; i < 5; i++) await adapters.prepareVerifier({}, new AbortController().signal);
  await assert.rejects(adapters.prepareVerifier({}, new AbortController().signal), /budget exhausted/);
  assert.equal(calls, 5);
});
test('operator cancellation propagates without starting model requests', async () => {
  let calls = 0; const controller = new AbortController(); controller.abort(new Error('Operator cancelled'));
  const adapters = createLiveAdapters({ env, generate: async () => { calls++; throw new Error('Unexpected request'); } });
  const result = await runRound(initialState(digitPacket()), adapters, { signal: controller.signal });
  assert.equal(calls, 0); assert.equal(result.report.status, 'partial');
});
test('a complete model-path test run persists state and a clearly labelled test report', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'proofsprint-live-test-'));
  const store = new SessionStore(workspace); const { id } = await store.create(digitPacket());
  const adapters = createLiveAdapters({ env, generate: fakeGenerator() });
  const report = await runLiveSession(id, 0, { adapters, workspace });
  assert.equal(report.persistedRevision, 4); assert.equal(report.executionKind, 'test-double');
  const reportDir = join(workspace, '.proofsprint', 'sessions', id, 'reports');
  const files = await readdir(reportDir); assert.equal(files.length, 1);
  const saved = JSON.parse(await readFile(join(reportDir, files[0]), 'utf8'));
  assert.equal(saved.runId, report.runId); assert.ok(saved.persistedAssessment.every(a => a.status === 'review-ready'));
  const persisted = await store.load(id);
  assert.equal(persisted.state.reviews[0].blindReview.requirementChecks.length, 4);
  assert.deepEqual(persisted.state.reviews[0].blindReview.checklist, blindChecklist(digitPacket()));
  await assert.rejects(runLiveSession(id, 0, { adapters, workspace }), /revision changed/);
});
test('overlapping rounds are rejected before a second set of generation calls', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'proofsprint-lock-test-'));
  const { id } = await new SessionStore(workspace).create(digitPacket());
  let started; const entered = new Promise(resolve => { started = resolve; });
  let release; const barrier = new Promise(resolve => { release = resolve; });
  const fake = fakeGenerator();
  const slow = createLiveAdapters({ env, generate: async options => { started(); await barrier; return fake(options); } });
  const first = runLiveSession(id, 0, { adapters: slow, workspace });
  await entered;
  let secondCalls = 0;
  const second = createLiveAdapters({ env, generate: async options => { secondCalls++; return fake(options); } });
  await assert.rejects(runLiveSession(id, 0, { adapters: second, workspace }), /active or interrupted/);
  release(); await first; assert.equal(secondCalls, 0);
});
