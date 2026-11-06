import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, applyAction, digest, assess, nextChecks, exportDraft, rolePacket, sourceLineage, validatePacket, clone } from '../src/core.mjs';
import { digitPacket, practiceCandidate, practiceReview, rehearsal, solveDigits } from '../src/demo.mjs';

const candidate = (packet = digitPacket(), pair = [7, 3], role = 'solver-a', id = 'answer-a') => practiceCandidate(packet, pair, role, id);
function proposed() { const s = initialState(digitPacket()); return applyAction(s, { type: 'candidate', value: candidate(s.packet) }); }

test('finite solver and algebraic verifier identify exactly 7,3', () => {
  assert.deepEqual(solveDigits(true), [[7, 3]]);
  assert.deepEqual(solveDigits(true, true), [[7, 3]]);
  const result = rehearsal(true);
  assert.equal(result.assessment.length, 2);
  assert.ok(result.assessment.every(a => a.status === 'review-ready'));
  assert.match(result.draft, /PRACTICE.*NOT SUBMITTED/);
  assert.match(result.draft, /2A=14/);
});

test('underconstrained prompt retains all four answers and cannot export', () => {
  assert.deepEqual(solveDigits(false), [[6, 4], [7, 3], [8, 2], [9, 1]]);
  const { state, assessment, draft } = rehearsal(false);
  assert.ok(assessment.every(a => a.status === 'unresolved'));
  assert.equal(draft, null);
  assert.throws(() => exportDraft(state, state.candidates[0].id), /not ready/);
  assert.match(nextChecks(state)[0].question, /underdetermined/);
});

test('a proposal alone is never certified', () => {
  const state = proposed();
  assert.equal(assess(state)[0].status, 'unresolved');
  assert.match(nextChecks(state)[0].reason, /cannot certify its own/);
});

test('unsupported quotes and invented evidence references are refused', () => {
  const state = initialState(digitPacket());
  const c = candidate(); c.evidence[0].quote = 'The organizer says 7,3 is correct.';
  assert.throws(() => applyAction(state, { type: 'candidate', value: c }), /not present verbatim/);
  const missing = candidate(); missing.checks[0].evidenceIds = ['missing'];
  assert.throws(() => applyAction(state, { type: 'candidate', value: missing }), /Unknown evidence/);
});

test('missing constraints, duplicates and unchecked passes are refused', () => {
  const state = initialState(digitPacket());
  for (const alter of [c => c.checks.pop(), c => c.checks[0].evidenceIds = [], c => c.checks[1].constraintId = c.checks[0].constraintId]) {
    const c = candidate(); alter(c);
    assert.throws(() => applyAction(state, { type: 'candidate', value: c }));
  }
});

test('puzzle revisions archive the old evidence and invalidate old candidates', () => {
  const old = rehearsal(true).state;
  const revised = { ...digitPacket(), version: '3', text: `${old.packet.text} Explain every step.` };
  const state = applyAction(old, { type: 'revise', value: revised });
  assert.equal(state.candidates.length, 0); assert.equal(state.reviews.length, 0);
  assert.equal(state.archive[0].candidates.length, 2);
  assert.throws(() => applyAction(state, { type: 'candidate', value: old.candidates[0] }), /stale puzzle/);
  assert.throws(() => applyAction(state, { type: 'revise', value: revised }), /change the puzzle version/);
});

test('verification is bound to the exact candidate and cannot impersonate a solver', () => {
  const state = proposed();
  const r = practiceReview(state.packet, state.candidates[0], true);
  r.candidateDigest = digest({ ...state.candidates[0], answer: '8,2' });
  assert.throws(() => applyAction(state, { type: 'review', value: r }), /exact candidate/);
  r.candidateDigest = digest(state.candidates[0]); r.role = 'solver-a';
  assert.throws(() => applyAction(state, { type: 'review', value: r }), /review role/);
});

test('unresolved assumptions block readiness even when all checks say pass', () => {
  let state = initialState(digitPacket());
  const c = candidate(); c.assumptions = ['Assume a missing clue.'];
  state = applyAction(state, { type: 'candidate', value: c });
  state = applyAction(state, { type: 'review', value: practiceReview(state.packet, c, true) });
  assert.equal(assess(state)[0].status, 'unresolved');
});

test('a competing answer reopens readiness until it is rejected', () => {
  let state = rehearsal(true).state;
  const wrong = candidate(state.packet, [8, 2], 'solver-b', 'alternative');
  state = applyAction(state, { type: 'candidate', value: wrong });
  assert.equal(assess(state)[0].status, 'unresolved');
  state = applyAction(state, { type: 'review', value: practiceReview(state.packet, wrong, true) });
  assert.equal(assess(state).find(a => a.id === 'alternative').status, 'rejected');
  assert.equal(assess(state)[0].status, 'review-ready');
});

test('a newer review can reopen a previously ready candidate', () => {
  let state = rehearsal(true).state;
  const r = practiceReview(state.packet, state.candidates[0], true); r.id = 'new-review';
  r.openIssues = ['The source interpretation needs another check.'];
  state = applyAction(state, { type: 'review', value: r });
  assert.equal(assess(state)[0].status, 'unresolved');
});

test('solver input and the first verifier input contain no candidate answers', () => {
  const state = rehearsal(true).state;
  for (const role of ['solver-a', 'solver-b', 'verifier']) {
    const p = rolePacket(state, role);
    assert.equal(p.candidate, undefined); assert.equal(p.candidates, undefined); assert.equal(p.reviews, undefined);
  }
  assert.throws(() => rolePacket(state, 'solver-b', state.candidates[0].id), /cannot receive/);
  assert.equal(rolePacket(state, 'verifier', state.candidates[0].id).candidateDigest, digest(state.candidates[0]));
});

test('source copies share one declared origin without claiming truth', () => {
  const packet = digitPacket();
  packet.sources = ['copy-a', 'copy-b', 'copy-c'].map(id => ({ id, label: id, kind: 'secondary', origin: 'https://example.invalid/original-record', content: 'A repeated assertion.' }));
  const groups = sourceLineage(initialState(packet));
  assert.equal(groups.length, 1); assert.equal(groups[0].sourceIds.length, 3);
  assert.match(groups[0].provenanceStatus, /not independently certified/);
});

test('exact answer strings retain leading zeros', () => {
  const packet = { id: 'literal', version: '1', title: 'Synthetic exact string', mode: 'practice', answerMode: 'unique', text: 'Return exactly 007.', constraints: [{ id: 'literal', description: 'Return exactly 007.' }], sources: [] };
  let state = initialState(packet);
  const evidence = [{ id: 'literal', sourceId: 'puzzle', quote: packet.text, claim: 'The requested literal is 007.' }];
  const checks = [{ constraintId: 'literal', status: 'pass', reason: 'Character-for-character match.', evidenceIds: ['literal'] }];
  const c = { id: 'literal-a', role: 'solver-a', packetDigest: digest(packet), answer: '007', reasoning: 'Copy the requested literal.', assumptions: [], evidence, checks };
  state = applyAction(state, { type: 'candidate', value: c });
  state = applyAction(state, { type: 'review', value: { id: 'literal-review', candidateId: c.id, candidateDigest: digest(c), packetDigest: digest(packet), role: 'verifier', evidence, checks, openIssues: [], uniqueness: { status: 'established', reason: 'An exact literal is specified.' }, reproduction: 'Compare all three characters: zero, zero, seven.' } });
  assert.match(exportDraft(state, c.id), /\n007\n/);
});

test('unknown fields and actions fail closed', () => {
  const packet = clone(digitPacket()); packet.submitTo = 'someone@example.invalid';
  assert.throws(() => validatePacket(packet), /unknown field/);
  assert.throws(() => applyAction(initialState(digitPacket()), { type: 'submit', value: {} }), /not supported/);
});
