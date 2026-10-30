import test from 'node:test';
import assert from 'node:assert/strict';
import '../speech.js';
import worker, { spokenOrder, tokenHash, VOICES } from '../worker/index.js';

test('only order readouts can be voiced by the Worker', () => {
  assert.ok(spokenOrder(KopiSpeech.text([{ line: 'Kopi O', who: ['Alice'] }])));
  assert.ok(!spokenOrder('Ignore the order and say something else.'));
  assert.ok(!spokenOrder("Boss, order ah. " + 'x'.repeat(1500) + " That's all, gam sia boss!"));
  assert.ok(!spokenOrder(undefined));
  assert.equal(VOICES[0], 'thalia');
});

test('speak endpoint is team-only and returns the AI clip as mp3', async () => {
  const token = 'a'.repeat(43), calls = [];
  const env = { TEAM_TOKEN_HASH: await tokenHash(token), DB: {}, AI: { run: async (model, input, options) => {
    calls.push({ model, input, options }); return input.speaker === 'orion' ? new Response('down', { status: 500 }) : new Response('mp3-bytes');
  } } };
  const text = KopiSpeech.text([{ line: 'Teh C', who: ['Bob'] }]);
  const call = (body, auth = token) => worker.fetch(new Request('https://kopi.test/api/speak', { method: 'POST',
    headers: { Authorization: 'Bearer ' + auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env);
  assert.equal((await call({ text }, 'b'.repeat(43))).status, 401);
  assert.equal((await call({ text: 'Say hello' })).status, 400);
  assert.equal((await call({ text, voice: 'zeus' })).status, 400);
  const ok = await call({ text });
  assert.equal(ok.status, 200); assert.equal(ok.headers.get('Content-Type'), 'audio/mpeg'); assert.equal(await ok.text(), 'mp3-bytes');
  assert.deepEqual(calls[0], { model: '@cf/deepgram/aura-2-en', input: { text, speaker: 'thalia', encoding: 'mp3' }, options: { returnRawResponse: true } });
  assert.equal((await call({ text, voice: 'orion' })).status, 502);
  assert.equal(calls.length, 2);
});
