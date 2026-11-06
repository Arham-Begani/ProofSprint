// Project Euler problem 1 excerpt and adapted task: CC BY-NC-SA 4.0.
// Attribution, source, adaptation and license details: ../THIRD_PARTY_NOTICES.md.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { SessionStore } from '../src/store.mjs';
import { runLiveSession } from '../src/run-live.mjs';
import { digest, assess, exportDraft } from '../src/core.mjs';

// Two independently implemented algorithms for one published mathematical task.
// They are deterministic code, not a substitute for a live model benchmark.
export function enumerateMultiples(limit) {
  const values = [];
  for (let n = 1; n < limit; n++) if (n % 3 === 0 || n % 5 === 0) values.push(n);
  return { sum: values.reduce((a, n) => a + n, 0), count: values.length };
}
export function seriesMultiples(limit) {
  const term = k => { const n = Math.max(0, Math.floor((limit - 1) / k)); return k * n * (n + 1) / 2; };
  const terms = { threes: term(3), fives: term(5), fifteens: term(15) };
  return { sum: terms.threes + terms.fives - terms.fifteens, terms };
}

export async function validatePublicProblem(workspace = process.cwd()) {
  const checkedAt = new Date().toISOString();
  const enumeration = enumerateMultiples(1000);
  const series = seriesMultiples(1000);
  assert.equal(enumeration.sum, series.sum);
  assert.equal(enumeration.sum, 233168);
  for (let limit = 0; limit <= 1001; limit++) assert.equal(enumerateMultiples(limit).sum, seriesMultiples(limit).sum);
  const packet = {
    id: 'public-project-euler-1', version: 'practice-v02', title: 'Published practice: Project Euler problem 1', mode: 'practice', answerMode: 'unique',
    text: 'Compute the integer total of positive integers less than 1000 divisible by either 3 or 5. Count each selected integer once.',
    constraints: [{ id: 'boundary', description: 'Use positive integers strictly less than 1000.' }, { id: 'union', description: 'Select divisibility by 3 OR by 5, counting overlaps once.' }, { id: 'sum', description: 'Return the exact integer sum of all selected values.' }],
    sources: [
      { id: 'official', label: 'Project Euler problem 1; retrieved November 5, 2026', kind: 'primary', origin: 'https://projecteuler.net/problem=1', content: 'Find the sum of all the multiples of $3$ or $5$ below $1000$.' },
      { id: 'enumeration', label: 'Actual local enumeration output', kind: 'artifact', origin: 'local:enumerateMultiples', content: JSON.stringify(enumeration) },
      { id: 'series', label: 'Actual local inclusion-exclusion output', kind: 'artifact', origin: 'local:seriesMultiples', content: JSON.stringify(series) }
    ]
  };
  const store = new SessionStore(workspace);
  const { id: sessionId } = await store.create(packet);
  const evidence = [{ id: 'statement', sourceId: 'official', quote: packet.sources[0].content, claim: 'Official task supplies the divisors and strict upper bound.' }, ...packet.sources.slice(1).map(s => ({ id: s.id, sourceId: s.id, quote: s.content, claim: 'Locally executed mathematical calculation, not organizer feedback or AI output.' }))];
  const reasoning = `Sum multiples of 3: ${series.terms.threes}; multiples of 5: ${series.terms.fives}; subtract common multiples of 15: ${series.terms.fifteens}. Total ${series.sum}. Exhaustive enumeration independently finds ${enumeration.count} selected integers and total ${enumeration.sum}.`;
  const checklist = { requirements: packet.constraints.map(c => ({ id: `blind-${c.id}`, description: c.description, constraintIds: [c.id] })), ambiguities: [] };
  const reviewBody = candidate => {
    const correct = candidate.answer === String(seriesMultiples(1000).sum) && candidate.answer === String(enumerateMultiples(1000).sum);
    return {
      evidence, checks: packet.constraints.map(c => ({ constraintId: c.id, status: c.id === 'sum' && !correct ? 'fail' : 'pass', reason: reasoning, evidenceIds: ['statement', 'enumeration', 'series'] })),
      openIssues: [], uniqueness: { status: 'established', reason: 'A finite specified set has exactly one integer sum.' }, reproduction: reasoning,
      requirementChecks: checklist.requirements.map(r => ({ itemId: r.id, status: r.id === 'blind-sum' && !correct ? 'fail' : 'pass', reason: reasoning, evidenceIds: ['statement', 'enumeration', 'series'] })), ambiguityChecks: []
    };
  };
  const report = await runLiveSession(sessionId, 0, { workspace, adapters: {
    label: 'Actual deterministic enumeration and inclusion-exclusion; public practice only', kind: 'deterministic',
    prepareVerifier: async () => checklist,
    solve: async input => ({ answer: String(input.role === 'solver-a' ? enumerateMultiples(1000).sum : seriesMultiples(1000).sum), reasoning, assumptions: [], evidence, checks: packet.constraints.map(c => ({ constraintId: c.id, status: 'pass', reason: reasoning, evidenceIds: ['statement', 'enumeration', 'series'] })) }),
    review: async input => reviewBody(input.candidate)
  } });
  let loaded = await store.load(sessionId);
  assert.equal(report.status, 'completed');
  assert.ok(assess(loaded.state).every(a => a.status === 'review-ready'));
  assert.match(exportDraft(loaded.state, loaded.state.candidates[0].id), /233168/);
  const negatives = [];
  for (const [kind, answer] of [['included-upper-bound', String(enumerateMultiples(1001).sum)], ['double-counted-overlap', String(series.terms.threes + series.terms.fives)]]) {
    const candidate = { ...loaded.state.candidates[0], id: `negative-${kind}`, answer, reasoning: `Intentional invalid test case: ${kind}.` };
    await store.append(sessionId, { type: 'candidate', value: candidate }, loaded.state.revision);
    loaded = await store.load(sessionId);
    assert.throws(() => exportDraft(loaded.state, loaded.state.candidates[0].id), /not ready/);
    const { requirementChecks, ambiguityChecks, ...body } = reviewBody(candidate);
    const review = { ...body, id: `reject-${kind}`, candidateId: candidate.id, candidateDigest: digest(candidate), packetDigest: digest(packet), role: 'verifier', blindReview: { checklist, requirementChecks, ambiguityChecks } };
    await store.append(sessionId, { type: 'review', value: review }, loaded.state.revision);
    loaded = await store.load(sessionId);
    const status = assess(loaded.state).find(a => a.id === candidate.id).status;
    assert.equal(status, 'rejected');
    assert.throws(() => exportDraft(loaded.state, candidate.id), /not ready/);
    negatives.push({ kind, answer, status });
  }
  const draft = exportDraft(loaded.state, loaded.state.candidates[0].id);
  await writeFile(join(workspace, '.proofsprint', 'sessions', sessionId, 'public-practice-draft.md'), draft, { flag: 'wx' });
  return { label: 'PUBLIC PRACTICE, DETERMINISTIC ALGORITHMS, NO MODEL CALLS OR SUBMISSION', checkedAt, source: packet.sources[0].origin, sourceRetrievedAt: '2026-11-05', sessionId, finalRevision: loaded.state.revision, answer: enumeration.sum, enumeration, series, variedBoundsChecked: 1002, negativeControls: negatives, blindReviewPersisted: Boolean(loaded.state.reviews[0].blindReview), reportKind: report.executionKind, limitations: 'One narrow published arithmetic problem. No AI reasoning, organizer verification, human study or real competition puzzle was tested.' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await validatePublicProblem();
  if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(report, null, 2), { flag: 'wx' });
  console.log(JSON.stringify(report, null, 2));
}
