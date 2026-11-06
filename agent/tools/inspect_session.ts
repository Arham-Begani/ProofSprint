import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { SessionStore } from '../../src/store.mjs';
import { assess, nextChecks, sourceLineage } from '../../src/core.mjs';
import { modelPreflight } from '../../src/live.ts';

export default defineTool({
  description: 'Read a local ProofSprint session, its current evidence gaps and model readiness. Does not send messages or invoke models.',
  inputSchema: z.object({ sessionId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/) }).strict(),
  async execute({ sessionId }) {
    const loaded = await new SessionStore().load(sessionId);
    return { revision: loaded.state.revision, packet: loaded.state.packet, assessment: assess(loaded.state), nextChecks: nextChecks(loaded.state), sourceLineage: sourceLineage(loaded.state), models: modelPreflight() };
  },
});
