import test from 'node:test';
import assert from 'node:assert/strict';
import '../speech.js';

const lines = [ { line: 'Kopi O Kosong Peng', who: ['Alice', 'Bob'] }, { line: 'Ice Lemon Tea', who: [null] } ];
function environment() {
  const spoken = [], voices = [{ name: 'US', lang: 'en-US' }, { name: 'Singapore', lang: 'en-SG' }];
  let cancels = 0;
  return { spoken, voices, get cancels() { return cancels; }, SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
    speechSynthesis: { getVoices: () => voices, speak: utterance => spoken.push(utterance), cancel: () => { cancels++; } } };
}

test('spoken order includes quantities and local phrasing, without reading customer names', () => {
  assert.equal(KopiSpeech.text(lines), "Boss, order ah. 2 Kopi O Kosong Peng. 1 Ice Lemon Tea. That's all, gam sia boss!");
  assert.equal(KopiSpeech.text([]), '');
  assert.equal(KopiSpeech.text([{ line: 'Nothing', who: [] }]), '');
  assert.ok(!KopiSpeech.text(lines).includes('Alice'));
});

test('Singapore voice is preferred, with English fallback and no installed voices supported', () => {
  assert.equal(KopiSpeech.voice([{ lang: 'en-US' }, { lang: 'en_SG' }]).lang, 'en_SG');
  assert.equal(KopiSpeech.voice([{ lang: 'en-US' }, { lang: 'en-GB' }]).lang, 'en-GB');
  assert.equal(KopiSpeech.voice([{ lang: 'en-US' }]).lang, 'en-US');
  assert.equal(KopiSpeech.voice([]), null);
});

test('speech starts only on request, stops, repeats, and ignores cancelled utterance callbacks', t => {
  const env = environment(), reader = new KopiSpeech.Reader(env); t.after(() => reader.dispose());
  assert.equal(env.spoken.length, 0); assert.equal(reader.available, true);
  assert.equal(reader.speak(lines), true);
  assert.equal(reader.status, 'starting');
  const first = env.spoken[0]; assert.equal(first.lang, 'en-SG'); assert.equal(first.voice, env.voices[1]);
  first.onstart(); assert.equal(reader.status, 'speaking');
  reader.stop(); assert.equal(reader.active, false);
  reader.speak(lines); const second = env.spoken[1]; second.onstart();
  first.onend(); first.onerror(); assert.equal(reader.status, 'speaking');
  second.onend(); assert.equal(reader.status, 'idle'); assert.match(reader.message, /Can repeat/);
  assert.ok(env.cancels >= 3);
});

test('unavailable speech and playback failures remain retryable without reporting completion', t => {
  const unavailable = new KopiSpeech.Reader({}); assert.equal(unavailable.speak(lines), false);
  assert.equal(unavailable.status, 'error'); assert.match(unavailable.message, /unavailable/);
  const env = environment(), reader = new KopiSpeech.Reader(env); t.after(() => reader.dispose());
  reader.speak(lines); env.spoken[0].onerror({ error: 'not-allowed' });
  assert.equal(reader.status, 'error'); assert.match(reader.message, /retry/); assert.equal(reader.active, false);
  reader.speak(lines); env.spoken[1].onstart(); env.spoken[1].onend(); assert.equal(reader.status, 'idle');
});
