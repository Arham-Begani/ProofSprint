import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import inspect from '../agent/tools/inspect_session.ts';
import draft from '../agent/tools/draft_answer.ts';
import round from '../agent/tools/run_round.ts';
import { SessionStore } from '../src/store.mjs';
import { rehearsal } from '../src/demo.mjs';

test('Eve tools inspect persisted practice, export a draft, reject ambiguity and enforce the model gate', async () => {
  const previousDirectory = process.cwd();
  const previousFlag = process.env.PROOFSPRINT_ENABLE_MODEL_CALLS;
  const workspace = await mkdtemp(join(tmpdir(), 'proofsprint-eve-test-'));
  process.chdir(workspace);
  process.env.PROOFSPRINT_ENABLE_MODEL_CALLS = '0';
  try {
    const store = new SessionStore();
    for (const unique of [true, false]) {
      const practice = rehearsal(unique);
      const { id } = await store.create(practice.packet);
      let revision = 0;
      for (const action of practice.actions) await store.append(id, action, revision++);
      const input = inspect.inputSchema.parse({ sessionId: id });
      const result = await inspect.execute(input);
      assert.equal(result.revision, revision);
      assert.equal(result.models.ready, false);
      assert.ok(result.assessment.every(a => a.status === (unique ? 'review-ready' : 'unresolved')));
      const candidateId = practice.actions.find(a => a.type === 'candidate').value.id;
      if (unique) {
        const answer = await draft.execute(draft.inputSchema.parse({ sessionId: id, candidateId }));
        assert.match(answer.status, /^DRAFT.*NOT SUBMITTED$/);
        assert.match(answer.draft, /PRACTICE/);
        assert.match(answer.draft, /7,3/);
      } else await assert.rejects(draft.execute({ sessionId: id, candidateId }), /not ready/);
      await assert.rejects(round.execute({ sessionId: id, expectedRevision: revision }, { abortSignal: new AbortController().signal }), /Live model calls are disabled/);
      assert.equal((await store.load(id)).state.revision, revision);
    }
    assert.throws(() => inspect.inputSchema.parse({ sessionId: '../outside' }));
    assert.throws(() => round.inputSchema.parse({ sessionId: 'valid', expectedRevision: -1 }));
  } finally {
    process.chdir(previousDirectory);
    if (previousFlag === undefined) delete process.env.PROOFSPRINT_ENABLE_MODEL_CALLS;
    else process.env.PROOFSPRINT_ENABLE_MODEL_CALLS = previousFlag;
  }
});
