import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { SessionStore } from '../../src/store.mjs';
import { exportDraft } from '../../src/core.mjs';

export default defineTool({
  description: 'Return an unsent answer draft only after structural verification checks pass. This does not certify correctness or send anything.',
  inputSchema: z.object({ sessionId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/), candidateId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/) }).strict(),
  async execute({ sessionId, candidateId }) { return { status: 'DRAFT — NOT SUBMITTED', draft: exportDraft((await new SessionStore().load(sessionId)).state, candidateId) }; },
});
