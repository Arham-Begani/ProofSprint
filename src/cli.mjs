#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assess, nextChecks, rolePacket, exportDraft, digest, sourceLineage } from './core.mjs';
import { SessionStore } from './store.mjs';
import { rehearsal } from './demo.mjs';

const [command, ...args] = process.argv.slice(2);
const store = new SessionStore();
const jsonFile = async path => JSON.parse(await readFile(resolve(path), 'utf8'));
const print = value => process.stdout.write(`${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}\n`);
const requireArgs = (min, max = min) => { if (args.length < min || args.length > max) throw new Error(`Invalid arguments for ${command}; run help`); };
try {
  if (!command || command === 'help') print(`ProofSprint - preparation and local review only\n\nCommands:\n  new <packet.json>\n  show <session-id>\n  prompt <session-id> <solver-a|solver-b|verifier> [candidate-id]\n  candidate <session-id> <candidate.json> <expected-revision>\n  review <session-id> <review.json> <expected-revision>\n  revise <session-id> <packet.json> <expected-revision>\n  next <session-id>\n  export <session-id> <candidate-id> <new-draft-file>\n  demo [unique|ambiguous]\n  model-status\n  run-model <session-id> <expected-revision>\n\nNo register, send, payment or submit command exists. Data stays in .proofsprint/sessions under the current project directory.`);
  else if (command === 'model-status') { requireArgs(0); print((await import('./live.ts')).modelPreflight()); }
  else if (command === 'run-model') { requireArgs(2); print(await (await import('./run-live.mjs')).runLiveSession(args[0], Number(args[1]))); }
  else if (command === 'new') { requireArgs(1); const result = await store.create(await jsonFile(args[0])); print({ id: result.id, revision: 0, packetDigest: digest(result.state.packet) }); }
  else if (command === 'show') { requireArgs(1); const loaded = await store.load(args[0]); print({ ...loaded, assessment: assess(loaded.state), sourceLineage: sourceLineage(loaded.state) }); }
  else if (command === 'prompt') { requireArgs(2, 3); print(rolePacket((await store.load(args[0])).state, args[1], args[2])); }
  else if (['candidate', 'review', 'revise'].includes(command)) { requireArgs(3); const result = await store.append(args[0], { type: command, value: await jsonFile(args[1]) }, Number(args[2])); print({ id: result.id, revision: result.state.revision, assessment: assess(result.state) }); }
  else if (command === 'next') { requireArgs(1); print(nextChecks((await store.load(args[0])).state)); }
  else if (command === 'export') { requireArgs(3); const draft = exportDraft((await store.load(args[0])).state, args[1]); await writeFile(resolve(args[2]), draft, { flag: 'wx' }); print({ file: resolve(args[2]), status: 'DRAFT — NOT SUBMITTED' }); }
  else if (command === 'demo') {
    requireArgs(0, 1);
    if (args[0] && !['unique', 'ambiguous'].includes(args[0])) throw new Error('Demo must be unique or ambiguous');
    const result = rehearsal(args[0] !== 'ambiguous');
    const created = await store.create(result.packet);
    let revision = 0;
    for (const action of result.actions) { await store.append(created.id, action, revision); revision++; }
    const loaded = await store.load(created.id);
    print({ label: result.label, sessionId: created.id, revision: loaded.state.revision, assessment: assess(loaded.state), draft: result.draft });
  } else throw new Error(`Unknown command ${command}; run help`);
} catch (error) { process.stderr.write(`ProofSprint: ${error.message}\n`); process.exitCode = 1; }
