import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { runLiveSession } from '../../src/run-live.mjs';

export default defineTool({
  description: 'Run one explicitly enabled round of independent model solvers and verification on a local session. At most five generation calls; no retries or external actions. Persists completed candidate/review events and a provenance-labelled report. Never automatically repeat an interrupted round.',
  inputSchema: z.object({ sessionId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/), expectedRevision: z.number().int().nonnegative() }).strict(),
  async execute({ sessionId, expectedRevision }, ctx) { return runLiveSession(sessionId, expectedRevision, { signal: ctx.abortSignal }); },
});
