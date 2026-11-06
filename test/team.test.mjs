import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, assess, nextChecks, exportDraft } from '../src/core.mjs';
import { digitPacket, practiceCandidate, practiceReview } from '../src/demo.mjs';
import { runRound } from '../src/team.mjs';
import { blindChecklist, roundReview } from './fixtures.mjs';

function adapters() {
  return {
    label: 'Deterministic test double; not model output', kind: 'test-double',
    async prepareVerifier(input) {
      assert.equal(input.candidate, undefined);
      return blindChecklist(input.packet);
    },
    async solve(input) {
      assert.equal(input.candidate, undefined); assert.equal(input.candidates, undefined);
      return practiceCandidate(input.packet, [7, 3], input.role, 'ignored-model-id');
    },
    async review(input) { return roundReview(input); }
  };
}

test('orchestration starts isolated roles then reviews and commits exact candidates', async () => {
  const commits = [];
  const result = await runRound(initialState(digitPacket()), adapters(), { commit: async (action, revision) => { commits.push({ action, revision }); } });
  assert.equal(result.report.executionKind, 'test-double');
  assert.equal(result.report.status, 'completed'); assert.equal(commits.length, 4);
  assert.deepEqual(commits.map(c => c.revision), [0, 1, 2, 3]);
  assert.ok(assess(result.state).every(a => a.status === 'review-ready'));
});

test('model errors are visible and are never silently replaced by practice data', async () => {
  const a = adapters(); a.solve = async () => { throw new Error('Provider unavailable'); };
  const result = await runRound(initialState(digitPacket()), a);
  assert.equal(result.report.status, 'partial'); assert.equal(result.state.candidates.length, 0);
  assert.equal(result.report.stages.filter(s => s.error === 'Provider unavailable').length, 2);
});

test('a failed checklist blocks all reviews while retaining useful proposals', async () => {
  const a = adapters(); a.prepareVerifier = async () => { throw new Error('Checklist unavailable'); };
  const result = await runRound(initialState(digitPacket()), a);
  assert.equal(result.state.candidates.length, 2); assert.equal(result.state.reviews.length, 0);
  assert.ok(assess(result.state).every(x => x.status === 'unresolved'));
});

test('a malformed fulfilled checklist also blocks reviews', async () => {
  const a = adapters(); a.prepareVerifier = async () => ({ requirements: [], ambiguities: [] });
  const result = await runRound(initialState(digitPacket()), a);
  assert.equal(result.state.reviews.length, 0); assert.equal(result.report.status, 'partial');
});

test('malformed model JSON is rejected instead of repaired into a claimed result', async () => {
  const a = adapters(); a.solve = async () => '```json\n{"answer":"7,3"}\n```';
  const result = await runRound(initialState(digitPacket()), a);
  assert.equal(result.report.status, 'partial'); assert.equal(result.state.candidates.length, 0);
});

test('initial ambiguities cannot vanish from the review', async () => {
  const a = adapters(); a.prepareVerifier = async input => ({ ...blindChecklist(input.packet), ambiguities: [{ id: 'units', description: 'Metres or feet?' }] });
  a.review = async input => ({ ...roundReview(input), ambiguityChecks: [] });
  const result = await runRound(initialState(digitPacket()), a);
  assert.equal(result.state.reviews.length, 0);
  assert.ok(result.report.stages.some(s => /explicit check/.test(s.error ?? '')));
});

test('an additional blind requirement cannot be omitted from the final review', async () => {
  const a = adapters();
  a.prepareVerifier = async input => ({ ...blindChecklist(input.packet), requirements: [...blindChecklist(input.packet).requirements, { id: 'format', description: 'Justify the answer format.', constraintIds: [] }] });
  a.review = async input => { const review = roundReview(input); review.requirementChecks.pop(); return review; };
  const result = await runRound(initialState(digitPacket()), a);
  assert.equal(result.state.reviews.length, 0);
  assert.ok(result.report.stages.some(s => /Every blind requirement/.test(s.error ?? '')));
});

test('unknown blind requirements and unresolved ambiguities block export despite passing packet checks', async () => {
  for (const gap of ['requirement', 'ambiguity']) {
    const a = adapters();
    if (gap === 'ambiguity') a.prepareVerifier = async input => ({ ...blindChecklist(input.packet), ambiguities: [{ id: 'format', description: 'Which separator is required?' }] });
    a.review = async input => {
      const review = roundReview(input);
      if (gap === 'requirement') review.requirementChecks[0] = { ...review.requirementChecks[0], status: 'unknown', reason: 'Missing decisive evidence.', evidenceIds: [] };
      return review;
    };
    const result = await runRound(initialState(digitPacket()), a);
    assert.equal(result.state.reviews.length, 2);
    assert.ok(assess(result.state).every(a => a.status === 'unresolved'));
    assert.ok(nextChecks(result.state).length > 0);
    assert.throws(() => exportDraft(result.state, result.state.candidates[0].id), /not ready/);
  }
});

test('a claimed ambiguity resolution without traceable evidence is rejected', async () => {
  const a = adapters();
  a.prepareVerifier = async input => ({ ...blindChecklist(input.packet), ambiguities: [{ id: 'format', description: 'Which separator is required?' }] });
  a.review = async input => { const r = roundReview(input); r.ambiguityChecks[0].status = 'resolved'; return r; };
  const result = await runRound(initialState(digitPacket()), a);
  assert.equal(result.state.reviews.length, 0);
  assert.ok(result.report.stages.some(s => /traceable evidence/.test(s.error ?? '')));
});

test('checklist mappings must cover supplied constraints with known IDs', async () => {
  for (const mutate of [c => c.requirements.pop(), c => c.requirements[0].constraintIds.push('invented'), c => c.ambiguities.push({ id: 'bad', description: 'x', injected: true })]) {
    const a = adapters();
    a.prepareVerifier = async input => { const c = blindChecklist(input.packet); mutate(c); return c; };
    const result = await runRound(initialState(digitPacket()), a);
    assert.equal(result.state.reviews.length, 0);
    assert.equal(result.report.status, 'partial');
  }
});

test('independent reviews start together while revision commits remain ordered', async () => {
  const a = adapters(); let started = 0; let release;
  const bothStarted = new Promise(resolve => { release = resolve; });
  a.review = async input => {
    assert.equal(input.reviews, undefined); assert.equal(input.candidates, undefined);
    if (++started === 2) release();
    await bothStarted;
    return roundReview(input);
  };
  const revisions = [];
  const result = await runRound(initialState(digitPacket()), a, { timeoutMs: 2000, commit: async (_action, revision) => revisions.push(revision) });
  assert.equal(result.report.status, 'completed');
  assert.deepEqual(revisions, [0, 1, 2, 3]);
});

test('one failed review preserves the independently completed review', async () => {
  const a = adapters(); a.review = async input => { if (input.candidate.role === 'solver-a') throw new Error('Review unavailable'); return roundReview(input); };
  const result = await runRound(initialState(digitPacket()), a);
  assert.equal(result.report.status, 'partial'); assert.equal(result.state.reviews.length, 1);
  assert.equal(result.state.reviews[0].candidateId, result.state.candidates[1].id);
});

test('oversized object responses are rejected as well as oversized JSON strings', async () => {
  const a = adapters(); a.solve = async () => ({ reasoning: 'x'.repeat(1000001) });
  const result = await runRound(initialState(digitPacket()), a);
  assert.equal(result.state.candidates.length, 0);
  assert.ok(result.report.stages.some(s => /exceeds 1 MB/.test(s.error ?? '')));
});

test('a timeout aborts a hung adapter and produces an explicit partial report', async () => {
  let aborted = false;
  const a = adapters(); a.solve = (_input, signal) => new Promise(() => { signal.addEventListener('abort', () => { aborted = true; }); });
  const result = await runRound(initialState(digitPacket()), a, { timeoutMs: 10 });
  assert.equal(aborted, true); assert.equal(result.report.status, 'partial');
  assert.ok(result.report.stages.some(s => /timed out/.test(s.error ?? '')));
});

test('an unsuccessful persistence step cannot produce a verified phantom candidate', async () => {
  const result = await runRound(initialState(digitPacket()), adapters(), { commit: async () => { throw new Error('Revision conflict'); } });
  assert.equal(result.state.candidates.length, 0); assert.equal(result.report.status, 'partial');
});

test('non-Error rejections retain the other solver and a useful failure report', async () => {
  for (const failure of [null, undefined, 'Provider unavailable']) {
    const a = adapters(); const original = a.solve;
    a.solve = async input => { if (input.role === 'solver-b') throw failure; return original(input); };
    const result = await runRound(initialState(digitPacket()), a);
    assert.equal(result.report.status, 'partial'); assert.equal(result.state.candidates.length, 1); assert.equal(result.state.reviews.length, 1);
    assert.ok(result.report.stages.find(s => s.role === 'solver-b').error);
    assert.equal(result.report.calls.length, 4); assert.ok(result.report.calls.every(c => c.elapsedMs >= 0));
    assert.equal(result.report.calls.find(c => c.label === 'solver-b').transportStatus, 'rejected');
  }
});

test('a string cancellation reason is retained without starting adapter work', async () => {
  const controller = new AbortController(); controller.abort('Operator cancelled the timed case');
  const a = adapters(); a.solve = async () => { throw new Error('Should not start'); };
  const result = await runRound(initialState(digitPacket()), a, { signal: controller.signal });
  assert.equal(result.report.status, 'partial'); assert.equal(result.state.candidates.length, 0);
  assert.ok(result.report.stages.every(s => s.error === 'Operator cancelled the timed case'));
  assert.ok(result.report.elapsedMs >= 0);
});
