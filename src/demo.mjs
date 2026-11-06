import { initialState, applyAction, digest, assess, exportDraft } from './core.mjs';

export function digitPacket(unique = true) {
  return {
    id: 'practice-digits', version: unique ? '2' : '1', title: 'Synthetic two-digit rehearsal', mode: 'practice', answerMode: 'unique',
    text: `Find the unique ordered pair A,B. A and B are integers from 1 to 9. A + B = 10. A > B.${unique ? ' A - B = 4.' : ''}`,
    constraints: [
      { id: 'domain', description: 'Both integers lie between 1 and 9 inclusive.' },
      { id: 'sum', description: 'A + B = 10.' },
      { id: 'order', description: 'A > B.' },
      ...(unique ? [{ id: 'difference', description: 'A - B = 4.' }] : [])
    ], sources: []
  };
}

// A real finite search of this deliberately narrow practice family, not an LLM result.
export function solveDigits(unique = true, descending = false) {
  const values = Array.from({ length: 9 }, (_, i) => descending ? 9 - i : i + 1);
  const answers = [];
  for (const a of values) for (const b of values) if (a + b === 10 && a > b && (!unique || a - b === 4)) answers.push([a, b]);
  return answers;
}

export function practiceCandidate(packet, pair, role, id) {
  const [a, b] = pair;
  const reasons = { domain: `${a} and ${b} are integers in [1,9].`, sum: `${a} + ${b} = ${a + b}.`, order: `${a} > ${b}.`, difference: `${a} - ${b} = ${a - b}.` };
  const pass = { domain: Number.isInteger(a) && Number.isInteger(b) && a >= 1 && a <= 9 && b >= 1 && b <= 9, sum: a + b === 10, order: a > b, difference: a - b === 4 };
  return {
    id, role, packetDigest: digest(packet), answer: `${a},${b}`, reasoning: Object.values(reasons).join(' '), assumptions: [],
    evidence: [{ id: 'original', sourceId: 'puzzle', quote: packet.text, claim: 'The quoted text supplies the mathematical conditions; the arithmetic is reproduced in each check.' }],
    checks: packet.constraints.map(c => ({ constraintId: c.id, status: pass[c.id] ? 'pass' : 'fail', reason: reasons[c.id], evidenceIds: ['original'] }))
  };
}

export function practiceReview(packet, candidate, unique) {
  // Verifier uses substitution B = 10 - A, independently of the solver's nested pair search.
  const valid = [];
  for (let a = 1; a <= 9; a++) {
    const b = 10 - a;
    if (b >= 1 && b <= 9 && a > b && (!unique || 2 * a - 10 === 4)) valid.push(`${a},${b}`);
  }
  const reproduction = unique ? 'Adding A+B=10 and A-B=4 gives 2A=14, so A=7 and B=3. Both are in the domain and 7>3. The two linear equations have exactly one solution.' : `Substitute B=10-A and apply the domain and ordering. Four pairs survive: ${valid.join('; ')}. The stated unique answer cannot be established.`;
  return {
    id: `review-${candidate.id}`, candidateId: candidate.id, candidateDigest: digest(candidate), packetDigest: digest(packet), role: 'verifier',
    evidence: [{ id: 'original', sourceId: 'puzzle', quote: packet.text, claim: 'Original conditions used for an independent substitution check.' }],
    checks: packet.constraints.map(c => ({ constraintId: c.id, status: valid.includes(candidate.answer) ? 'pass' : 'fail', reason: reproduction, evidenceIds: ['original'] })),
    openIssues: valid.length === 1 ? [] : ['The prompt requests a unique pair but permits four answers.'],
    uniqueness: { status: valid.length === 1 ? 'established' : 'not-established', reason: reproduction }, reproduction
  };
}

export function rehearsal(unique = true) {
  const packet = digitPacket(unique);
  let state = initialState(packet);
  const actions = [];
  for (const [role, descending] of [['solver-a', false], ['solver-b', true]]) {
    for (const [index, pair] of solveDigits(unique, descending).entries()) {
      const candidate = practiceCandidate(packet, pair, role, `${role}-${index}`);
      const action = { type: 'candidate', value: candidate }; actions.push(action); state = applyAction(state, action);
    }
  }
  for (const candidate of state.candidates) {
    const action = { type: 'review', value: practiceReview(packet, candidate, unique) }; actions.push(action); state = applyAction(state, action);
  }
  const assessment = assess(state);
  return { label: 'DETERMINISTIC SYNTHETIC REHEARSAL — NO MODEL CALLS OR SUBMISSIONS', packet, actions, state, assessment, draft: assessment.some(a => a.status === 'review-ready') ? exportDraft(state, state.candidates[0].id) : null };
}
