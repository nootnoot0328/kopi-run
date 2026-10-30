import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import worker, { tokenHash } from '../worker/index.js';
import '../team.js';

const token = 'a'.repeat(43);
const empty = () => ({ roster: [], history: [], customs: [], groups: [], hero: KopiSettings.defaults() });
const changed = name => ({ ...empty(), roster: [{ name, usuals: ['Kopi O'] }] });

test('asset revalidation preserves a bodyless 304 response', async () => {
  const env = { ASSETS: { fetch: async () => new Response(null, { status: 304 }) } };
  for (const path of ['/', '/team.js']) {
    const result = await worker.fetch(new Request('https://kopi.test' + path), env);
    assert.equal(result.status, 304);
    assert.equal(result.body, null);
  }
});

test('D1 API: protected access, durable saves, validation and concurrent writes', async t => {
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: 'export default { fetch() { return new Response("ok"); } }', d1Databases: ['DB'] }));
  t.after(() => mf.dispose());
  const DB = await mf.getD1Database('DB');
  const sql = await readFile(new URL('../migrations/0001_team.sql', import.meta.url), 'utf8');
  for (const statement of sql.split(';').filter(s => s.trim())) await DB.prepare(statement).run();
  const env = { DB, TEAM_TOKEN_HASH: await tokenHash(token) };
  const request = (method = 'GET', body, auth = token, headers = {}) => new Request('https://kopi.test/api/team', {
    method, headers: { ...(auth ? { Authorization: 'Bearer ' + auth } : {}), 'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.equal((await worker.fetch(request('GET', undefined, ''), env)).status, 401);
  assert.equal((await worker.fetch(request('GET', undefined, 'b'.repeat(43)), env)).status, 401);
  assert.equal((await worker.fetch(request(), { DB })).status, 503);
  assert.deepEqual(await (await worker.fetch(request(), env)).json(), { version: 0, state: empty() });
  assert.equal((await worker.fetch(request('PUT', { version: 0, state: { roster: 'bad' } }), env)).status, 400);
  assert.equal((await worker.fetch(request('PUT', { version: 0, state: changed('A') }, token, { Origin: 'https://other.test' }), env)).status, 403);
  assert.equal((await worker.fetch(request('PUT', { padding: 'x'.repeat(270000) }), env)).status, 413);
  const results = await Promise.all(['Alice', 'Bob'].map(name => worker.fetch(request('PUT', { version: 0, state: changed(name) }), env)));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  const saved = await (await worker.fetch(request(), env)).json();
  assert.equal(saved.version, 1);
  assert.equal(saved.state.roster.length, 1);
  assert.equal((await worker.fetch(request('PUT', { version: 0, state: empty() }), env)).status, 409);
  assert.deepEqual(await (await worker.fetch(request(), env)).json(), saved);
  assert.equal((await worker.fetch(request(), env)).headers.get('Cache-Control'), 'no-store');
  const custom = { ...empty(), hero: { ...KopiSettings.defaults(), heading: 'Team buyers', days: { ...KopiSettings.defaults().days, Friday: 'Custom names' } } };
  assert.equal((await worker.fetch(request('PUT', { version: 1, state: custom }), env)).status, 200);
  const legacy = empty(); delete legacy.hero;
  assert.equal((await worker.fetch(request('PUT', { version: 2, state: legacy }), env)).status, 200);
  assert.deepEqual((await (await worker.fetch(request(), env)).json()).state.hero, custom.hero);
  assert.equal((await worker.fetch(request('PUT', { version: 3, state: { ...empty(), hero: { heading: 123 } } }), env)).status, 400);
});

const response = (data, status = 200) => Response.json(data, { status });
const untilIdle = async sync => { while (sync.saving) await new Promise(resolve => setTimeout(resolve, 1)); };

test('client loads without writing, coalesces saves, and retains edits after a conflict', async () => {
  let reads = 0, writes = 0;
  const sync = new KopiTeamSync(token, async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer ' + token);
    if (options.method === 'GET') { reads++; return response({ version: 0, state: empty() }); }
    writes++;
    if (writes === 1) return response({ version: 1 });
    return response({ error: 'Conflict' }, 409);
  });
  await sync.load(); sync.queue(empty());
  assert.equal(writes, 0);
  sync.queue(changed('Alice')); await untilIdle(sync);
  assert.equal(sync.status, 'saved');
  sync.queue(changed('Bob')); await untilIdle(sync);
  assert.equal(sync.status, 'conflict');
  assert.deepEqual(JSON.parse(sync.pending), changed('Bob'));
  await sync.refresh(); await sync.flush();
  assert.equal(writes, 2); assert.equal(reads, 1);
});

test('client retries network failures without losing changes', async () => {
  let fail = true;
  const sync = new KopiTeamSync(token, async (url, options) => {
    if (options.method === 'GET') return response({ version: 0, state: empty() });
    if (fail) throw new Error('Offline');
    return response({ version: 1 });
  });
  await sync.load(); sync.queue(changed('Alice')); await untilIdle(sync);
  assert.equal(sync.status, 'error'); assert.ok(sync.pending);
  fail = false; await sync.flush();
  assert.equal(sync.status, 'saved'); assert.equal(sync.pending, null);
});

test('late refresh cannot replace a newer successful save', async () => {
  let finishRefresh, reads = 0;
  const sync = new KopiTeamSync(token, async (url, options) => {
    if (options.method === 'PUT') return response({ version: 1 });
    if (++reads === 1) return response({ version: 0, state: empty() });
    return new Promise(resolve => { finishRefresh = resolve; });
  });
  await sync.load(); const refreshing = sync.refresh();
  sync.queue(changed('Alice')); await untilIdle(sync);
  finishRefresh(response({ version: 0, state: empty() })); await refreshing;
  assert.equal(sync.version, 1); assert.deepEqual(JSON.parse(sync.saved), changed('Alice'));
});

test('manual sync checks unchanged data, tracks successful checks, and never reports failures as success', async () => {
  let fail = false, reads = 0;
  const sync = new KopiTeamSync(token, async () => {
    reads++; if (fail) throw new Error('Offline');
    return response({ version: 0, state: empty() });
  });
  await sync.load(); assert.equal(sync.upToDate, true);
  sync.lastSyncedAt = 1;
  assert.equal(await sync.sync(), true);
  assert.equal(reads, 2); assert.ok(sync.lastSyncedAt > 1); assert.equal(sync.upToDate, true);
  const last = sync.lastSyncedAt; fail = true;
  assert.equal(await sync.sync(), false);
  assert.equal(sync.status, 'offline'); assert.equal(sync.lastSyncedAt, last); assert.equal(sync.upToDate, false);
  fail = false; await sync.sync(); assert.equal(sync.upToDate, true);
});

test('manual sync saves pending edits before fetching and retains failed/conflicted edits', async () => {
  let mode = 'offline', version = 0, state = empty(); const methods = [];
  const sync = new KopiTeamSync(token, async (url, options) => {
    methods.push(options.method);
    if (options.method === 'GET') return response({ version, state });
    if (mode === 'offline') throw new Error('Offline');
    if (mode === 'conflict') return response({ error: 'Conflict' }, 409);
    state = JSON.parse(options.body).state; version++; return response({ version });
  });
  await sync.load(); const last = sync.lastSyncedAt;
  sync.queue(changed('Alice')); await untilIdle(sync);
  assert.equal(sync.upToDate, false);
  assert.equal(await sync.sync(), false); assert.ok(sync.pending); assert.equal(sync.lastSyncedAt, last);
  mode = 'ok'; methods.length = 0;
  await sync.sync(); assert.deepEqual(methods, ['PUT', 'GET']); assert.equal(sync.upToDate, true);
  assert.equal(sync.pending, null); assert.equal(sync.state.roster[0].name, 'Alice');
  mode = 'conflict'; sync.queue(changed('Bob')); await untilIdle(sync);
  const pending = sync.pending; methods.length = 0;
  assert.equal(await sync.sync(), false); assert.equal(sync.pending, pending);
  assert.equal(sync.upToDate, false); assert.deepEqual(methods, []);
});

test('checking is visible, concurrent manual checks coalesce, and edits invalidate in-flight checks', async () => {
  let resolveRead, readCount = 0;
  const sync = new KopiTeamSync(token, async (url, options) => {
    if (options.method === 'PUT') return response({ version: 1 });
    if (++readCount === 1) return response({ version: 0, state: empty() });
    return new Promise(resolve => { resolveRead = resolve; });
  });
  await sync.load(); const last = sync.lastSyncedAt;
  const check = sync.sync(), duplicate = sync.sync();
  assert.equal(sync.refreshing, true); assert.equal(sync.upToDate, false);
  assert.equal(check, duplicate); assert.equal(readCount, 2);
  sync.queue(changed('Alice')); await untilIdle(sync);
  resolveRead(response({ version: 0, state: empty() })); await check;
  assert.equal(sync.version, 1); assert.equal(sync.lastSyncedAt, last);
  assert.equal(sync.upToDate, false); assert.equal(sync.state.roster[0].name, 'Alice');
});
