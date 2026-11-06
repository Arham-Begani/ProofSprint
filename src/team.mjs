import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { rolePacket, applyAction, assess, nextChecks, digest, clone, validateChecklist, ValidationError } from './core.mjs';

const failureMessage = error => error instanceof Error ? error.message : typeof error === 'string' && error ? error : 'Adapter rejected without an error message';

async function timedCall(label, fn, timeoutMs, externalSignal) {
  const controller = new AbortController();
  const signal = externalSignal ? AbortSignal.any([controller.signal, externalSignal]) : controller.signal;
  if (signal.aborted) throw signal.reason ?? new Error('Round cancelled');
  let timer;
  let abort;
  try {
    return await Promise.race([
      Promise.resolve().then(() => fn(signal)),
      new Promise((_, reject) => {
        abort = () => reject(signal.reason ?? new Error('Round cancelled'));
        signal.addEventListener('abort', abort, { once: true });
        timer = setTimeout(() => controller.abort(new Error(`${label} timed out`)), timeoutMs);
      })
    ]);
  } finally { clearTimeout(timer); if (abort) signal.removeEventListener('abort', abort); }
}

function payload(value) {
  if (typeof value === 'string') {
    if (Buffer.byteLength(value) > 1000000) throw new ValidationError('Model response exceeds 1 MB');
    value = JSON.parse(value);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ValidationError('Model response must be a JSON object');
  if (Buffer.byteLength(JSON.stringify(value)) > 1000000) throw new ValidationError('Model response exceeds 1 MB');
  return clone(value);
}

/**
 * One bounded round. Adapters must honor AbortSignal and return JSON.
 * @param {any} initial
 * @param {any} adapters
 * @param {{timeoutMs?: number, commit?: (action: any, revision: number) => Promise<any>, signal?: AbortSignal}} options
 */
export async function runRound(initial, adapters, { timeoutMs = 120000, commit = async () => {}, signal } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 600000) throw new ValidationError('timeoutMs must be between 1 and 600000');
  for (const method of ['prepareVerifier', 'solve', 'review']) if (typeof adapters[method] !== 'function') throw new ValidationError(`Missing adapter ${method}`);
  if (!adapters.label || !['live-model', 'test-double', 'deterministic'].includes(adapters.kind)) throw new ValidationError('Adapter provenance is required');
  let state = clone(initial);
  const runId = randomUUID();
  const roundStart = performance.now();
  const report = { runId, adapter: adapters.label, executionKind: adapters.kind, packetDigest: digest(state.packet), startedAt: new Date().toISOString(), stages: [], candidateIds: [], calls: [] };
  const call = async (label, fn) => {
    const start = performance.now();
    const timing = { label, startOffsetMs: start - roundStart, elapsedMs: 0, transportStatus: 'pending' };
    report.calls.push(timing);
    try { const value = await timedCall(label, fn, timeoutMs, signal); timing.transportStatus = 'fulfilled'; return value; }
    catch (error) { timing.transportStatus = 'rejected'; throw error; }
    finally { timing.elapsedMs = performance.now() - start; }
  };
  const persist = async action => {
    const next = applyAction(state, action);
    await commit(action, state.revision);
    state = next;
  };
  const originals = ['solver-a', 'solver-b', 'verifier'].map(role => rolePacket(initial, role));
  const outcomes = await Promise.allSettled([
    call('solver-a', childSignal => adapters.solve(clone(originals[0]), childSignal)),
    call('solver-b', childSignal => adapters.solve(clone(originals[1]), childSignal)),
    call('verifier checklist', childSignal => adapters.prepareVerifier(clone(originals[2]), childSignal))
  ]);
  let checklist;
  if (outcomes[2].status === 'fulfilled') {
    try {
      checklist = payload(outcomes[2].value);
      validateChecklist(state.packet, checklist);
      report.stages.push({ role: 'verifier-checklist', status: 'completed', checklist });
    } catch (error) { checklist = undefined; report.stages.push({ role: 'verifier-checklist', status: 'failed', error: failureMessage(error) }); }
  } else report.stages.push({ role: 'verifier-checklist', status: 'failed', error: failureMessage(outcomes[2].reason) });

  for (let i = 0; i < 2; i++) {
    const role = originals[i].role;
    if (outcomes[i].status === 'rejected') { report.stages.push({ role, status: 'failed', error: failureMessage(outcomes[i].reason) }); continue; }
    try {
      const raw = payload(outcomes[i].value);
      const candidate = { ...raw, id: `${role}-${runId}`, role, packetDigest: report.packetDigest };
      await persist({ type: 'candidate', value: candidate }); report.candidateIds.push(candidate.id);
      report.stages.push({ role, status: 'completed', candidateId: candidate.id });
    } catch (error) { report.stages.push({ role, status: 'failed', error: failureMessage(error) }); }
  }
  // Review requests see only their own candidate and the same blind checklist.
  // Start them together, then commit results in a deterministic revision order.
  const reviewOutcomes = checklist ? await Promise.allSettled(report.candidateIds.map(candidateId => {
    const input = { ...rolePacket(state, 'verifier', candidateId), checklist: clone(checklist) };
    return call(`review ${candidateId}`, childSignal => adapters.review(input, childSignal));
  })) : [];
  for (const [index, outcome] of reviewOutcomes.entries()) {
    const candidateId = report.candidateIds[index];
    try {
      if (outcome.status === 'rejected') throw outcome.reason;
      const raw = payload(outcome.value);
      const candidate = state.candidates.find(c => c.id === candidateId);
      const { requirementChecks, ambiguityChecks, ...body } = raw;
      const review = { ...body, id: `v-${randomUUID()}`, candidateId, candidateDigest: digest(candidate), packetDigest: report.packetDigest, role: 'verifier', blindReview: { checklist: clone(checklist), requirementChecks, ambiguityChecks } };
      await persist({ type: 'review', value: review });
      report.stages.push({ role: 'verifier-review', status: 'completed', candidateId });
    } catch (error) { report.stages.push({ role: 'verifier-review', status: 'failed', candidateId, error: failureMessage(error) }); }
  }
  report.finishedAt = new Date().toISOString();
  report.elapsedMs = performance.now() - roundStart;
  report.status = report.stages.some(s => s.status === 'failed') ? 'partial' : 'completed';
  report.assessment = assess(state); report.nextChecks = nextChecks(state);
  report.notice = 'Structural review status only. A live model reply is not proof of correctness. No registration, payment or submission was performed.';
  return { state, report };
}
