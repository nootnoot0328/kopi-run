import '../settings.js';
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
    (s.hero === undefined || KopiSettings.validHero(s.hero)) &&
    Array.isArray(s.history) && s.history.length <= 60 && s.history.every(r =>
      r && Number.isSafeInteger(r.ts) && r.ts >= 0 && Array.isArray(r.orders) &&
      r.orders.length <= 1000 && r.orders.every(o => o && text(o.who) && text(o.drink)));
}

// Same-origin JSON only; streaming bodies are bounded because Content-Length is not trusted.
async function body(request, limit, tooLarge) {
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return json({ error: 'Origin not allowed.' }, 403);
  if (!(request.headers.get('Content-Type') || '').startsWith('application/json')) return json({ error: 'JSON required.' }, 415);
  const reader = request.body?.getReader();
  if (!reader) return json({ error: 'Missing body.' }, 400);
  let size = 0;
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); return json({ error: tooLarge }, 413); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let input;
  try { input = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { return json({ error: 'Invalid JSON.' }, 400); }
  return input;
}

// Readout voices: Azure's Singapore English when its key is set, Workers AI's Aura-2 otherwise.
export const VOICES = {
  luna: { azure: 'en-SG-LunaNeural' }, wayne: { azure: 'en-SG-WayneNeural' },
  thalia: { aura: 'thalia' }, helena: { aura: 'helena' }, apollo: { aura: 'apollo' }, pandora: { aura: 'pandora' }, orion: { aura: 'orion' },
};
// Only order readouts are voiced, so the endpoint cannot be used as a general speech service.
export const spokenOrder = text => typeof text === 'string' && text.length <= 1500 &&
  /^Boss, order ah\. .+ That's all, gam sia boss!$/.test(text);
const xml = value => value.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

async function azure(env, text, name) {
  if (!env.AZURE_SPEECH_KEY || !name) return null;
  const response = await fetch(`https://${env.AZURE_SPEECH_REGION || 'southeastasia'}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: 'POST',
    headers: { 'Ocp-Apim-Subscription-Key': env.AZURE_SPEECH_KEY, 'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3', 'User-Agent': 'kopi-run' },
    body: `<speak version="1.0" xml:lang="en-SG"><voice name="${name}">${xml(text)}</voice></speak>`,
  }).catch(() => null);
  return response?.ok ? response : null;
}

async function aura(env, text, speaker) {
  if (!env.AI) return null;
  const response = await env.AI.run('@cf/deepgram/aura-2-en', { text, speaker, encoding: 'mp3' }, { returnRawResponse: true }).catch(() => null);
  return response?.ok ? response : null;
}

async function speak(request, env) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  if (!env.AI && !env.AZURE_SPEECH_KEY) return json({ error: 'Voice is not configured.' }, 503);
  const input = await body(request, 4096, 'Order is too long to read.');
  if (input instanceof Response) return input;
  const name = input?.voice ?? (env.AZURE_SPEECH_KEY ? 'luna' : 'thalia');
  if (!spokenOrder(input?.text) || !Object.hasOwn(VOICES, name)) return json({ error: 'Invalid order readout.' }, 400);
  const voice = VOICES[name];
  // Azure first for the local accent; Aura keeps the readout going if Azure is down or out of quota.
  let audio = await azure(env, input.text, voice.azure), used = name;
  if (!audio) { audio = await aura(env, input.text, voice.aura || 'thalia'); used = voice.aura || 'thalia'; }
  if (!audio) return json({ error: 'Voice is unavailable. Using the phone voice instead.' }, 502);
  return new Response(audio.body, { headers: {
    'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Kopi-Voice': used,
  } });
}

async function api(request, env) {
  // Fail closed: a missing deployment secret never makes the roster public.
  if (!/^[a-f0-9]{64}$/.test(env.TEAM_TOKEN_HASH || '')) return json({ error: 'Team access is not configured.' }, 503);
  const token = request.headers.get('Authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43,128})$/)?.[1];
  if (!token || await tokenHash(token) !== env.TEAM_TOKEN_HASH) return json({ error: 'Open the team invitation link to continue.' }, 401);
  if (!env.DB) return json({ error: 'Team storage is not configured.' }, 503);
  const path = new URL(request.url).pathname;
  if (path === '/api/speak') return speak(request, env);
  if (path !== '/api/team') return json({ error: 'Not found.' }, 404);
  if (request.method === 'GET') {
    const row = await env.DB.prepare('SELECT version, data FROM team_state WHERE id = 1').first();
    if (!row) return json({ error: 'Run the database migration first.' }, 503);
    const state = JSON.parse(row.data);
    return json({ version: row.version, state: { ...state, hero: KopiSettings.hero(state.hero) } });
  }
  if (request.method !== 'PUT') return json({ error: 'Method not allowed.' }, 405);
  const input = await body(request, 256 * 1024, 'Team data is too large.');
  if (input instanceof Response) return input;
  if (!Number.isSafeInteger(input?.version) || input.version < 0 || !validState(input.state)) return json({ error: 'Invalid team data.' }, 400);
  const { roster, history, customs, groups, hero } = input.state;
  const result = await env.DB.prepare(
    "UPDATE team_state SET data = json_set(?, '$.hero', json(COALESCE(?, json_extract(data, '$.hero'), ?))), version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1 AND version = ?"
  ).bind(JSON.stringify({ roster, history, customs, groups }), hero === undefined ? null : JSON.stringify(hero), JSON.stringify(KopiSettings.defaults()), input.version).run();
  if (!result.meta.changes) return json({ error: 'A colleague has saved newer changes. Load the latest team list before editing again.' }, 409);
  return json({ version: input.version + 1 });
}

export default {
  async fetch(request, env) {
    try {
      const path = new URL(request.url).pathname;
      if (path.startsWith('/api/')) return await api(request, env);
      if (!['/', '/index.html', '/settings.js', '/team.js', '/people.js', '/speech.js', '/sw.js'].includes(path)) return new Response('Not found', { status: 404 });
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
