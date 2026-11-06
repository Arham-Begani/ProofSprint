import { mkdir, rmdir, writeFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { SessionStore } from './store.mjs';
import { runRound } from './team.mjs';
import { assess } from './core.mjs';

/** @param {string} sessionId @param {number} expectedRevision @param {{adapters?: any, workspace?: string, signal?: AbortSignal}} options */
export async function runLiveSession(sessionId, expectedRevision, { adapters, workspace = process.cwd(), signal } = {}) {
  if (!adapters) adapters = (await import('./live.ts')).createLiveAdapters();
  const store = new SessionStore(workspace);
  const directory = await store.directory(sessionId);
  const lock = join(directory, '.round-lock');
  try { await mkdir(lock); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('A round is active or interrupted. Inspect its state before manually recovering the round lock.'); throw error; }
  try {
    const loaded = await store.load(sessionId);
    if (loaded.state.revision !== expectedRevision) throw new Error('Session revision changed; inspect it before starting another round');
    const result = await runRound(loaded.state, adapters, { signal, timeoutMs: adapters.timeoutMs ?? 120000, commit: (action, revision) => store.append(sessionId, action, revision) });
    const current = await store.load(sessionId);
    const reports = join(directory, 'reports');
    try { if ((await lstat(reports)).isSymbolicLink()) throw new Error('Symlink report directories are not allowed'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await mkdir(reports, { recursive: true });
    const report = { ...result.report, sessionId, usage: adapters.usage ?? [], persistedRevision: current.state.revision, persistedAssessment: assess(current.state) };
    await writeFile(join(reports, `${report.runId}.json`), JSON.stringify(report, null, 2), { flag: 'wx' });
    return report;
  } finally { await rmdir(lock); }
}
