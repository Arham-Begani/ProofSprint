import { mkdir, readdir, readFile, writeFile, rename, rmdir, lstat, realpath } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { initialState, applyAction, digest, validateId, ValidationError } from './core.mjs';

export class SessionStore {
  constructor(workspace = process.cwd()) { this.workspace = resolve(workspace); this.root = join(this.workspace, '.proofsprint', 'sessions'); }

  async directory(id) {
    validateId(id, 'session id');
    const directory = join(this.root, id);
    for (const path of [join(this.workspace, '.proofsprint'), this.root]) {
      try { if ((await lstat(path)).isSymbolicLink()) throw new ValidationError('Symlink storage roots are not allowed'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    await mkdir(this.root, { recursive: true });
    const workspace = await realpath(this.workspace);
    const root = await realpath(this.root);
    const rel = relative(workspace, root);
    if (rel.startsWith('..') || isAbsolute(rel)) throw new ValidationError('Session storage resolves outside the workspace');
    try { if ((await lstat(directory)).isSymbolicLink()) throw new ValidationError('Symlink sessions are not allowed'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    return directory;
  }

  async create(packet) {
    initialState(packet);
    const id = randomUUID();
    const directory = await this.directory(id);
    await mkdir(directory);
    const event = this.event(0, null, { type: 'init', value: packet });
    await this.writeEvent(directory, event);
    return { id, state: initialState(packet) };
  }

  event(sequence, previousHash, action) {
    const body = { sequence, previousHash, timestamp: new Date().toISOString(), action };
    return { ...body, hash: digest(body) };
  }

  async writeEvent(directory, event) {
    const name = `${String(event.sequence).padStart(8, '0')}.json`;
    const target = join(directory, name);
    try { await lstat(target); throw new ValidationError('Event already exists; refusing overwrite'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const temporary = join(directory, `${name}.${randomUUID()}.tmp`);
    await writeFile(temporary, `${JSON.stringify(event, null, 2)}\n`, { flag: 'wx' });
    await rename(temporary, target);
  }

  async load(id) {
    const directory = await this.directory(id);
    const names = (await readdir(directory)).filter(n => /^\d{8}\.json$/.test(n)).sort();
    if (!names.length) throw new ValidationError('Session has no committed events');
    let state;
    let previousHash = null;
    for (let i = 0; i < names.length; i++) {
      const path = join(directory, names[i]);
      if ((await lstat(path)).isSymbolicLink()) throw new ValidationError('Symlink events are not allowed');
      const event = JSON.parse(await readFile(path, 'utf8'));
      const { hash, ...body } = event;
      if (event.sequence !== i || names[i] !== `${String(i).padStart(8, '0')}.json` || event.previousHash !== previousHash || hash !== digest(body)) throw new ValidationError('Session event integrity check failed');
      if (i === 0) {
        if (event.action.type !== 'init') throw new ValidationError('First event must initialize the puzzle');
        state = initialState(event.action.value);
      } else state = applyAction(state, event.action);
      previousHash = hash;
    }
    return { id, state, lastHash: previousHash, eventCount: names.length };
  }

  async append(id, action, expectedRevision) {
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new ValidationError('An expected revision is required');
    const directory = await this.directory(id);
    const lock = join(directory, '.write-lock');
    try { await mkdir(lock); }
    catch (error) { if (error.code === 'EEXIST') throw new ValidationError('Session is busy; retry after the active write completes. A stale lock needs manual inspection.'); throw error; }
    try {
      const loaded = await this.load(id);
      if (loaded.state.revision !== expectedRevision) throw new ValidationError('Revision conflict; reload the session before applying the action');
      const state = applyAction(loaded.state, action);
      await this.writeEvent(directory, this.event(loaded.eventCount, loaded.lastHash, action));
      return { id, state };
    } finally { await rmdir(lock); }
  }
}
