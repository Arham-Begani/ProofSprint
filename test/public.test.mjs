import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validatePublicProblem, enumerateMultiples, seriesMultiples } from '../scripts/validate-public.mjs';

test('published arithmetic practice survives the complete persisted flow and rejects two plausible wrong answers', async () => {
  assert.deepEqual(enumerateMultiples(10), { sum: 23, count: 4 });
  assert.equal(seriesMultiples(10).sum, 23);
  const report = await validatePublicProblem(await mkdtemp(join(tmpdir(), 'proofsprint-public-')));
  assert.equal(report.answer, 233168);
  assert.equal(report.variedBoundsChecked, 1002);
  assert.equal(report.finalRevision, 8);
  assert.equal(report.blindReviewPersisted, true);
  assert.equal(report.reportKind, 'deterministic');
  assert.ok(report.negativeControls.every(c => c.status === 'rejected'));
});
