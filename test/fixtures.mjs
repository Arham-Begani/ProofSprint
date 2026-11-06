import { practiceReview } from '../src/demo.mjs';

export const blindChecklist = packet => ({ requirements: packet.constraints.map(c => ({ id: `blind-${c.id}`, description: c.description, constraintIds: [c.id] })), ambiguities: [] });
export const blindChecks = checklist => ({ requirementChecks: checklist.requirements.map(r => ({ itemId: r.id, status: 'pass', reason: 'Independently checked against the original conditions.', evidenceIds: ['original'] })), ambiguityChecks: checklist.ambiguities.map(a => ({ itemId: a.id, status: 'unresolved', reason: 'No decisive evidence is available.', evidenceIds: [] })) });
export const roundReview = input => ({ ...practiceReview(input.packet, input.candidate, true), ...blindChecks(input.checklist) });
