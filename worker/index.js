const json = (body, status = 200) => Response.json(body, {
  status,
  headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' },
});

export async function tokenHash(token) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}

const text = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 200;
const strings = (value, max) => Array.isArray(value) && value.length <= max && value.every(text);
export function validState(s) {
  return s && typeof s === 'object' &&
    Array.isArray(s.roster) && s.roster.length <= 500 && s.roster.every(p =>
      p && text(p.name) && strings(p.usuals, 3) && p.usuals.length > 0 &&
      (p.groups === undefined || strings(p.groups, 100))) &&
    new Set(s.roster.map(p => p.name.toLowerCase())).size === s.roster.length &&
    strings(s.customs, 20) && strings(s.groups, 100) &&
    Array.isArray(s.history) && s.history.length <= 60 && s.history.every(r =>
      r && Number.isSafeInteger(r.ts) && r.ts >= 0 && Array.isArray(r.orders) &&
      r.orders.length <= 1000 && r.orders.every(o => o && text(o.who) && text(o.drink)));
}

async function api(request, env) {
  // Fail closed: a missing deployment secret never makes the roster public.
  if (!/^[a-f0-9]{64}$/.test(env.TEAM_TOKEN_HASH || '')) return json({ error: 'Team access is not configured.' }, 503);
  const token = request.headers.get('Authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43,128})$/)?.[1];
  if (!token || await tokenHash(token) !== env.TEAM_TOKEN_HASH) return json({ error: 'Open the team invitation link to continue.' }, 401);
  if (!env.DB) return json({ error: 'Team storage is not configured.' }, 503);
  if (new URL(request.url).pathname !== '/api/team') return json({ error: 'Not found.' }, 404);
  if (request.method === 'GET') {
    const row = await env.DB.prepare('SELECT version, data FROM team_state WHERE id = 1').first();
    if (!row) return json({ error: 'Run the database migration first.' }, 503);
    return json({ version: row.version, state: JSON.parse(row.data) });
  }
  if (request.method !== 'PUT') return json({ error: 'Method not allowed.' }, 405);
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return json({ error: 'Origin not allowed.' }, 403);
  if (!(request.headers.get('Content-Type') || '').startsWith('application/json')) return json({ error: 'JSON required.' }, 415);
  // Bound streaming bodies too; Content-Length is not trusted.
  const reader = request.body?.getReader();
  if (!reader) return json({ error: 'Missing body.' }, 400);
  let size = 0;
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 256 * 1024) { await reader.cancel(); return json({ error: 'Team data is too large.' }, 413); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let input;
  try { input = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { return json({ error: 'Invalid JSON.' }, 400); }
  if (!Number.isSafeInteger(input?.version) || input.version < 0 || !validState(input.state)) return json({ error: 'Invalid team data.' }, 400);
  const { roster, history, customs, groups } = input.state;
  const result = await env.DB.prepare(
    'UPDATE team_state SET data = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1 AND version = ?'
  ).bind(JSON.stringify({ roster, history, customs, groups }), input.version).run();
  if (!result.meta.changes) return json({ error: 'A colleague has saved newer changes. Load the latest team list before editing again.' }, 409);
  return json({ version: input.version + 1 });
}

export default {
  async fetch(request, env) {
    try {
      const path = new URL(request.url).pathname;
      if (path.startsWith('/api/')) return await api(request, env);
      if (!['/', '/index.html', '/team.js', '/sw.js'].includes(path)) return new Response('Not found', { status: 404 });
      const response = await env.ASSETS.fetch(request);
      const headers = new Headers(response.headers);
      headers.set('Referrer-Policy', 'no-referrer');
      headers.set('X-Content-Type-Options', 'nosniff');
      headers.set('Cache-Control', 'no-cache');
      headers.set('X-Robots-Tag', 'noindex, nofollow');
      if (response.status === 304) return new Response(null, { status: 304, headers });
      if (path === '/' || path === '/index.html') {
        const body = (await response.text()).replace('<!-- cloudflare-team-mode -->', '<script>window.KOPI_TEAM_MODE = true;</script>');
        return new Response(body, { status: response.status, headers });
      }
      return new Response(response.body, { status: response.status, headers });
    } catch {
      return json({ error: 'Team storage is unavailable. Your changes have not been confirmed. Please retry.' }, 503);
    }
  },
};
