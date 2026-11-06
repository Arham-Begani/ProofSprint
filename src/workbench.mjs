import http from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { SessionStore } from './store.mjs';
import { assess, nextChecks, sourceLineage, exportDraft } from './core.mjs';
import { rehearsal } from './demo.mjs';
import { modelPreflight } from './live.ts';
import { runLiveSession } from './run-live.mjs';
import { validatePublicProblem } from '../scripts/validate-public.mjs';

const idPattern = '[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}';
const assets = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/styles.css': ['styles.css', 'text/css'] };
const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
async function body(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) throw Object.assign(new Error('Send a JSON request.'), { status: 415 });
  if (Number(req.headers['content-length'] ?? 0) > 1100000) { req.resume(); throw Object.assign(new Error('The packet is too large. Keep it below 1 MB.'), { status: 413 }); }
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1100000) throw Object.assign(new Error('The packet is too large. Keep it below 1 MB.'), { status: 413 });
    chunks.push(chunk);
  }
  try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Not an object'); return value; }
  catch { throw Object.assign(new Error('This is not valid JSON. Check the packet and try again.'), { status: 400 }); }
}

export async function startWorkbench({ workspace = process.cwd(), port = 43129 } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid local port');
  const store = new SessionStore(workspace);
  const token = randomBytes(24).toString('hex');
  let activePort;
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; object-src 'none'; form-action 'self'");
    const hosts = [`127.0.0.1:${activePort}`, `localhost:${activePort}`];
    if (!hosts.includes(req.headers.host ?? '')) return json(res, 403, { error: 'This workbench accepts local requests only.' });
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (req.method === 'GET' && assets[url.pathname]) {
        const [file, type] = assets[url.pathname];
        const content = await readFile(new URL(`../web/${file}`, import.meta.url));
        res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` }); return res.end(content);
      }
      if (req.method === 'GET' && url.pathname === '/api/bootstrap') return json(res, 200, { token, models: modelPreflight(), version: '0.4.0', mode: 'local' });
      if (req.method === 'GET' && url.pathname === '/api/sessions') {
        let entries;
        try { entries = await readdir(store.root, { withFileTypes: true }); }
        catch (error) { if (error.code === 'ENOENT') return json(res, 200, []); throw error; }
        const directories = await Promise.all(entries.filter(e => e.isDirectory() && new RegExp(`^${idPattern}$`).test(e.name)).map(async e => ({ id: e.name, modified: (await stat(join(store.root, e.name))).mtimeMs })));
        const sessions = await Promise.all(directories.sort((a, b) => b.modified - a.modified).slice(0, 50).map(async row => {
          try {
            const { state } = await store.load(row.id); const statuses = assess(state);
            return { ...row, title: state.packet.title, mode: state.packet.mode, revision: state.revision, candidates: statuses.length, ready: statuses.filter(s => s.status === 'review-ready').length, unresolved: statuses.filter(s => s.status === 'unresolved').length };
          } catch { return { ...row, title: 'Session needs attention', mode: 'unknown', error: 'The saved session could not be read safely.' }; }
        }));
        return json(res, 200, sessions);
      }
      const detail = url.pathname.match(new RegExp(`^/api/sessions/(${idPattern})$`));
      if (req.method === 'GET' && detail) {
        const loaded = await store.load(detail[1]);
        return json(res, 200, { ...loaded, assessment: assess(loaded.state), nextChecks: nextChecks(loaded.state), sourceLineage: sourceLineage(loaded.state) });
      }
      const draft = url.pathname.match(new RegExp(`^/api/sessions/(${idPattern})/draft/(${idPattern})$`));
      if (req.method === 'GET' && draft) {
        const text = exportDraft((await store.load(draft[1])).state, draft[2]);
        if (url.searchParams.has('download')) {
          res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': `attachment; filename="proofsprint-${draft[2]}.md"` }); return res.end(text);
        }
        return json(res, 200, { draft: text, status: 'DRAFT - NOT SUBMITTED' });
      }
      if (req.method !== 'POST') return json(res, 404, { error: 'This page or action does not exist.' });
      if (!hosts.some(host => req.headers.origin === `http://${host}`) || req.headers['x-proofsprint-token'] !== token) return json(res, 403, { error: 'Reload this local workbench before making changes.' });
      const input = await body(req);
      if (url.pathname === '/api/sessions') {
        const created = await store.create(input.packet);
        return json(res, 201, { sessionId: created.id });
      }
      if (url.pathname === '/api/practice') {
        if (input.kind === 'public') return json(res, 201, await validatePublicProblem(workspace));
        if (!['unique', 'ambiguous'].includes(input.kind)) return json(res, 400, { error: 'Choose one of the available practice cases.' });
        const practice = rehearsal(input.kind === 'unique');
        const created = await store.create(practice.packet); let revision = 0;
        for (const action of practice.actions) await store.append(created.id, action, revision++);
        return json(res, 201, { sessionId: created.id, label: practice.label });
      }
      const run = url.pathname.match(new RegExp(`^/api/sessions/(${idPattern})/run$`));
      if (run) {
        if (!modelPreflight().ready) return json(res, 409, { error: 'Live models are not configured and enabled. Practice remains available.' });
        if (input.confirmModelUsage !== true) return json(res, 400, { error: 'Confirm the displayed model usage before starting one round.' });
        if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) return json(res, 400, { error: 'Refresh the session revision before running a round.' });
        const controller = new AbortController();
        req.on('aborted', () => controller.abort(new Error('Browser disconnected')));
        res.on('close', () => { if (!res.writableEnded) controller.abort(new Error('Browser disconnected')); });
        const result = await runLiveSession(run[1], input.expectedRevision, { workspace, signal: controller.signal });
        return json(res, 200, result);
      }
      return json(res, 404, { error: 'This action does not exist.' });
    } catch (error) {
      if (res.destroyed || res.headersSent) return;
      const status = error.status ?? (error.code === 'ENOENT' ? 404 : /not ready|revision|busy|active or interrupted/i.test(error.message) ? 409 : error.name === 'ValidationError' ? 400 : 500);
      json(res, status, { error: status === 500 ? 'The operation could not finish. Your saved evidence is retained; check the local server log.' : error.message });
      if (status === 500) process.stderr.write(`Workbench: ${error.name}\n`);
    }
  });
  server.requestTimeout = 10000; server.headersTimeout = 5000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  activePort = server.address().port;
  return { server, url: `http://127.0.0.1:${activePort}`, close: () => new Promise((resolve, reject) => { server.closeIdleConnections(); server.close(error => error ? reject(error) : resolve()); }) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = await startWorkbench({ port: process.argv[2] === undefined ? 43129 : Number(process.argv[2]) });
  console.log(`ProofSprint workbench: ${app.url}\nLocal evidence workspace. No model calls start automatically.`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => app.close().then(() => process.exit(0)));
}
