import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import '../settings.js';

const origin = process.env.KOPI_TEST_URL || 'http://127.0.0.1:8787';
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname)) throw new Error('Browser tests only write to a local development server.');
const token = process.env.KOPI_TEST_TOKEN || (await readFile('artifacts/team-token.txt', 'utf8')).trim();
const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
const link = origin + '/#team=' + token;
const read = async () => { const response = await fetch(origin + '/api/team', { headers }); assert.equal(response.status, 200); return response.json(); };
let browser;
test.before(async () => { await mkdir('artifacts', { recursive: true }); browser = await chromium.launch({ headless: true, channel: process.env.KOPI_BROWSER_CHANNEL || 'chrome' }); });
test.after(async () => { await browser?.close(); });
const fixture = () => ({ roster: [
  { id: 'alice', name: 'Alice', usuals: ['Kopi O', 'Teh'], groups: ['Office'] },
  { id: 'bob', name: 'Bob', usuals: ['Milo'] },
], history: [], customs: ['100Plus', 'coke zero'], groups: ['Office'], hero: KopiSettings.defaults() });
async function seed(state = fixture()) {
  const snapshot = await read();
  assert.equal((await fetch(origin + '/api/team', { method: 'PUT', headers, body: JSON.stringify({ version: snapshot.version, state }) })).status, 200);
}
async function context(t, time = '2026-10-30T04:00:00Z') {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, timezoneId: 'America/Los_Angeles' });
  t.after(() => ctx.close());
  const page = await ctx.newPage(); const errors = [];
  page.setDefaultTimeout(7000);
  page.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  await page.clock.install({ time: new Date(time) });
  return { ctx, page };
}
async function open(page) { await page.goto(link); await page.waitForFunction(() => typeof team !== 'undefined' && team?.upToDate); }
async function sync(page) {
  const response = page.waitForResponse(r => r.url().endsWith('/api/team') && r.request().method() === 'GET');
  await page.getByRole('button', { name: 'Sync', exact: true }).click(); await response;
  await page.waitForFunction(() => team.upToDate);
}
async function save(page, action) {
  const response = page.waitForResponse(r => r.url().endsWith('/api/team') && r.request().method() === 'PUT');
  await action(); assert.equal((await response).status(), 200);
  await page.waitForFunction(() => !team.pending && !team.saving);
}
const card = (page, name) => page.locator('.card').filter({ has: page.locator('.name', { hasText: new RegExp('^' + name + '$') }) });
async function editUsual(page, name, oldDrink, newDrink) {
  await page.getByRole('button', { name: "Who's in", exact: true }).click();
  if (!(await card(page, name).getAttribute('class')).includes(' on')) await card(page, name).locator('.cardmain').click();
  await card(page, name).locator('.edit').click();
  await page.getByRole('button', { name: oldDrink, exact: true }).click();
  await page.locator('.soft-drinks').getByRole('button', { name: newDrink, exact: true }).click();
  assert.equal(await page.locator('.preview strong').innerText(), newDrink);
  await save(page, () => page.getByRole('button', { name: 'Save usual drink', exact: true }).click());
}

test('two devices, live selected usual replacement, multiple usuals, one-offs, and restored drafts', { timeout: 60000 }, async t => {
  await seed(); const { page: a } = await context(t), { page: b } = await context(t);
  await open(a); await open(b);
  await card(a, 'Alice').locator('.cardmain').click();
  await a.getByRole('button', { name: 'By drink', exact: true }).click();
  await a.getByPlaceholder('Calamansi ice lemon tea, 100 Plus…').fill('Guest drink');
  await save(a, () => a.getByRole('button', { name: 'Bob', exact: true }).click());
  await a.getByRole('button', { name: "Who's in", exact: true }).click();
  const staleDraft = await a.evaluate(() => JSON.parse(localStorage.getItem('kr.draft.v1.team')));
  await sync(b);
  assert.equal(await b.locator('.card.on').count(), 0);
  await editUsual(b, 'Alice', 'Kopi O', 'Coke');
  await a.getByRole('button', { name: 'Counter', exact: true }).click();
  await sync(a);
  await a.locator('.dark').getByText('Coke', { exact: true }).waitFor();
  assert.equal(await a.getByRole('button', { name: 'Hand back', exact: true }).count(), 0);
  await a.getByRole('button', { name: "Who's in", exact: true }).click();
  assert.equal(await card(a, 'Alice').locator('.drink').innerText(), 'Coke');
  assert.match(await card(a, 'Alice').getAttribute('class'), /\bon\b/);
  assert.equal(await card(a, 'Bob').locator('.drink').innerText(), 'Guest drink');
  await editUsual(b, 'Alice', 'Coke', 'Sprite');
  await a.clock.fastForward(15010);
  await card(a, 'Alice').locator('.drink').filter({ hasText: /^Sprite$/ }).waitFor();
  assert.equal(await a.evaluate(() => JSON.parse(localStorage.getItem('kr.draft.v1.team')).picked.Alice), 'Sprite');
  const { ctx: restoredCtx, page: restored } = await context(t);
  await restoredCtx.addInitScript(draft => localStorage.setItem('kr.draft.v1.team', JSON.stringify(draft)), staleDraft);
  await open(restored);
  assert.equal(await card(restored, 'Alice').locator('.drink').innerText(), 'Sprite');
  assert.match(await card(restored, 'Alice').getAttribute('class'), /\bon\b/);
  const { ctx: legacyCtx, page: legacy } = await context(t);
  await legacyCtx.addInitScript(() => localStorage.setItem('kr.draft.v1.team', JSON.stringify({ Alice: 'Kopi O', Bob: 'Guest drink' })));
  await open(legacy); assert.equal(await card(legacy, 'Alice').locator('.drink').innerText(), 'Sprite');
  // A different usual is retained when the primary changes.
  await a.getByRole('button', { name: 'By drink', exact: true }).click();
  await a.locator('.bases button').filter({ hasText: /^Teh$/ }).click();
  await a.getByRole('button', { name: /^Alice(?: ✓)?$/ }).click();
  await a.getByRole('button', { name: "Who's in", exact: true }).click();
  await editUsual(b, 'Alice', 'Sprite', 'Coke Zero');
  await sync(a); assert.equal(await card(a, 'Alice').locator('.drink').innerText(), 'Teh');
  await editUsual(b, 'Alice', 'Teh', '100 Plus');
  await a.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await card(a, 'Alice').locator('.drink').filter({ hasText: /^100 Plus$/ }).waitFor();
  assert.equal(await card(a, 'Bob').locator('.drink').innerText(), 'Guest drink');
  const state = (await read()).state;
  assert.equal('picked' in state, false); assert.equal('draft' in state, false);
  await a.screenshot({ path: 'artifacts/shared-main-mobile.png', fullPage: true });
});

test('manual sync states, unchanged checks, failed requests and concurrent edits', { timeout: 60000 }, async t => {
  await seed(); const { page: a } = await context(t), { page: b } = await context(t); await open(a); await open(b);
  await sync(a); await a.getByText('✓ Up to date', { exact: true }).waitFor();
  assert.match(await a.locator('.syncbar time').innerText(), /Last synced: .*SGT/);
  const stamp = await a.evaluate(() => team.lastSyncedAt);
  let release; const gate = new Promise(resolve => { release = resolve; });
  await a.route('**/api/team', async route => { if (route.request().method() === 'GET') await gate; await route.continue(); });
  await a.getByRole('button', { name: 'Sync', exact: true }).click();
  await a.getByRole('button', { name: 'Syncing…', exact: true }).waitFor();
  assert.equal(await a.getByText('✓ Up to date', { exact: true }).count(), 0); release();
  await a.waitForFunction(() => team.upToDate); await a.unroute('**/api/team');
  await a.route('**/api/team', route => route.abort());
  await a.getByRole('button', { name: 'Sync', exact: true }).click();
  await a.getByRole('alert').filter({ hasText: 'Sync failed' }).waitFor();
  assert.equal(await a.getByText('✓ Up to date', { exact: true }).count(), 0);
  assert.ok(await a.evaluate(() => team.lastSyncedAt) >= stamp);
  await a.unroute('**/api/team'); await sync(a);
  // Keep A stale while B writes; a stale save must stay pending on A.
  await editUsual(b, 'Alice', 'Kopi O', 'Coke');
  await a.getByRole('button', { name: 'Setup', exact: true }).click();
  await a.getByRole('button', { name: 'Edit buyer schedule', exact: true }).click();
  await a.getByLabel('Small message', { exact: true }).fill('Unsaved concurrent edit');
  await a.getByRole('button', { name: 'Save buyer schedule', exact: true }).click();
  await a.getByRole('alert').filter({ hasText: 'A colleague saved changes first' }).waitFor();
  const pending = await a.evaluate(() => team.pending);
  await a.getByRole('button', { name: 'Sync', exact: true }).click();
  assert.equal(await a.evaluate(() => team.pending), pending);
  assert.equal(await a.getByText('✓ Up to date', { exact: true }).count(), 0);
  assert.equal((await read()).state.hero.message, 'Gam Sia Lao Ban hehe');
});

test('free text switches to base buttons, soft drinks preview and save through all composers', { timeout: 60000 }, async t => {
  await seed(); const { page } = await context(t); await open(page);
  await card(page, 'Alice').locator('.cardmain').click(); await card(page, 'Alice').locator('.edit').click();
  await page.getByRole('button', { name: 'Kopi O', exact: true }).click();
  const input = () => page.getByPlaceholder('Calamansi ice lemon tea, 100 Plus…');
  await input().fill('Free text');
  assert.equal(await page.locator('.bases button:disabled').count(), 0);
  await page.locator('.bases button').filter({ hasText: /^Teh$/ }).click();
  assert.equal(await input().inputValue(), ''); assert.equal(await page.locator('.preview strong').innerText(), 'Teh');
  await page.locator('.modrow button').filter({ hasText: 'Kosong' }).click();
  assert.equal(await page.locator('.preview strong').innerText(), 'Teh Kosong');
  await input().fill('Other text'); assert.equal(await page.locator('.preview strong').innerText(), 'Other text');
  for (const drink of ['Coke', 'Coke Zero', 'Sprite', '100 Plus', 'Ice Lemon Tea']) {
    assert.equal(await page.getByRole('button', { name: drink, exact: true }).count(), 1);
    assert.equal(await page.locator('.soft-drinks button').filter({ hasText: drink }).locator('svg[data-drink]').first().count(), 1);
    await page.locator('.soft-drinks').getByRole('button', { name: drink, exact: true }).click();
    assert.equal(await page.locator('.preview strong').innerText(), drink);
    assert.equal(await page.locator('.bases .on').count(), 0);
  }
  await save(page, () => page.getByRole('button', { name: 'Save usual drink', exact: true }).click());
  assert.equal((await read()).state.roster[0].usuals[0], 'Ice Lemon Tea');
  await card(page, 'Alice').locator('.edit').click();
  await page.getByRole('button', { name: 'Drink something different today', exact: true }).click();
  await input().fill('Typed'); await page.locator('.bases button').filter({ hasText: /^Milo$/ }).click();
  assert.equal(await input().inputValue(), '');
  await page.locator('.soft-drinks').getByRole('button', { name: 'Coke', exact: true }).click();
  await save(page, () => page.getByRole('button', { name: 'Use this', exact: true }).click());
  assert.equal((await read()).state.roster[0].usuals[0], 'Ice Lemon Tea');
  assert.equal(await card(page, 'Alice').locator('.drink').innerText(), 'Coke');
  await page.getByRole('button', { name: '+ Someone else', exact: false }).click();
  await page.getByPlaceholder('Name', { exact: true }).fill('New person');
  await page.getByRole('button', { name: 'Add to roster', exact: true }).click();
  await page.locator('.soft-drinks').getByRole('button', { name: 'Sprite', exact: true }).click();
  await save(page, () => page.getByRole('button', { name: 'Use this', exact: true }).click());
  assert.equal((await read()).state.roster[2].usuals[0], 'Sprite');
  await page.getByRole('button', { name: 'By drink', exact: true }).click();
  await input().fill('Custom'); await page.locator('.bases button').filter({ hasText: /^Kopi$/ }).click();
  assert.equal(await input().inputValue(), '');
  await page.locator('.soft-drinks').getByRole('button', { name: 'Sprite', exact: true }).click();
  await page.getByRole('button', { name: 'Bob', exact: true }).click();
  await page.getByRole('button', { name: 'Counter', exact: true }).click();
  const variants = await page.locator('.famvariant').allTextContents();
  assert.match((await page.locator('.dark').innerText()), /Sprite/);
  await page.screenshot({ path: 'artifacts/soft-drinks-counter-mobile.png' });
});

test('drink logos, retired quick option, order collage, skip, and completion exactly once', { timeout: 60000 }, async t => {
  const state = fixture();
  state.roster.push({ id: 'cara', name: 'Cara', usuals: ['Ice Lemon Tea'] });
  state.customs.push('Fanta Orange');
  await seed(state); const { page } = await context(t); await open(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.getByRole('button', { name: 'By drink', exact: true }).click();
  assert.equal(await page.locator('.soft-drinks .drink-logo').count(), 5);
  assert.equal(await page.getByRole('button', { name: 'Fanta Orange', exact: true }).count(), 0);
  await page.getByPlaceholder('Calamansi ice lemon tea, 100 Plus…').fill('Iced Lemon Tea');
  assert.equal(await page.locator('.preview strong').innerText(), 'Ice Lemon Tea');
  assert.equal(await page.locator('.preview svg[data-drink="Ice Lemon Tea"]').count(), 1);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'artifacts/drink-logos-mobile.png', fullPage: true });
  await page.getByRole('button', { name: "Who's in", exact: true }).click();
  for (const name of ['Alice', 'Bob', 'Cara']) await card(page, name).locator('.cardmain').click();
  const draft = await page.evaluate(() => JSON.parse(localStorage.getItem('kr.draft.v1.team')).picked);
  const previous = await read();
  await page.getByRole('button', { name: 'Done — show at counter', exact: true }).click();
  await page.getByRole('dialog', { name: 'Writing the order…', exact: true }).waitFor();
  assert.equal(await page.locator('.motion-name').count(), 3);
  assert.equal(await page.locator('.app-content').evaluate(element => element.inert), true);
  await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.motion-receipt')).opacity) > .95);
  await page.screenshot({ path: 'artifacts/order-collage-mobile.png' });
  await page.getByRole('button', { name: 'Order cards', exact: true }).waitFor();
  assert.equal(await page.locator('.run-motion').count(), 0);
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('kr.draft.v1.team')).picked), draft);
  assert.equal((await read()).version, previous.version);
  await page.getByRole('button', { name: "Who's in", exact: true }).click();
  await page.getByRole('button', { name: 'Done — show at counter', exact: true }).click();
  await page.getByRole('button', { name: 'Skip animation', exact: true }).click();
  await page.getByRole('button', { name: 'Order cards', exact: true }).waitFor();
  const finish = await page.getByRole('button', { name: 'Finish run', exact: true }).elementHandle();
  await save(page, () => page.getByRole('button', { name: 'Finish run', exact: true }).click());
  await page.getByRole('dialog', { name: 'Gam xia lao ban hehe!', exact: true }).waitFor();
  await finish.evaluate(element => { element.click(); element.click(); });
  await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.thanks-card')).opacity) > .95);
  await page.clock.fastForward(8000);
  assert.equal(await page.getByRole('dialog', { name: 'Gam xia lao ban hehe!', exact: true }).count(), 1);
  await page.screenshot({ path: 'artifacts/lao-ban-celebration-mobile.png' });
  await page.getByRole('button', { name: 'Close celebration', exact: true }).click();
  const saved = await read();
  assert.equal(saved.state.history.length, 1);
  assert.equal(saved.state.history[0].orders.length, 3);
  assert.equal(await page.locator('.card.on').count(), 0);
  assert.equal(await page.locator('.run-motion').count(), 0);
  assert.equal(await page.locator('.app-content').evaluate(element => element.inert), false);
  // A second run can be finished and its persistent celebration swiped away.
  await card(page, 'Alice').locator('.cardmain').click();
  await page.getByRole('button', { name: 'Counter', exact: true }).click();
  await save(page, () => page.getByRole('button', { name: 'Finish run', exact: true }).click());
  await page.getByRole('dialog', { name: 'Gam xia lao ban hehe!', exact: true }).waitFor();
  await page.mouse.move(180, 420); await page.mouse.down();
  await page.mouse.move(300, 420, { steps: 5 }); await page.mouse.up();
  assert.equal(await page.locator('.run-motion').count(), 0);
  assert.equal((await read()).state.history.length, 2);
});

test('reduced motion skips the collage and provides a static thank-you without duplicate history', { timeout: 60000 }, async t => {
  await seed(); const { page } = await context(t); await page.emulateMedia({ reducedMotion: 'reduce' }); await open(page);
  await card(page, 'Alice').locator('.cardmain').click();
  await page.getByRole('button', { name: 'Done — show at counter', exact: true }).click();
  await page.getByRole('button', { name: 'Order cards', exact: true }).waitFor();
  assert.equal(await page.locator('.run-motion').count(), 0);
  await save(page, () => page.getByRole('button', { name: 'Finish run', exact: true }).click());
  await page.getByRole('dialog', { name: 'Gam xia lao ban hehe!', exact: true }).waitFor();
  assert.equal(await page.locator('.thanks-card').evaluate(element => getComputedStyle(element).animationName), 'none');
  await page.clock.fastForward(10000);
  assert.equal(await page.locator('.run-motion').count(), 1);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.run-motion').count(), 0);
  assert.equal((await read()).state.history.length, 1);
});

test('AI voice reads the order clip, replays it without downloading again, and never uses the phone voice', { timeout: 60000 }, async t => {
  const state = fixture(); state.roster[1].usuals = ['Kopi O']; await seed(state);
  const { ctx, page } = await context(t), requests = [];
  await ctx.route('**/api/speak', route => { requests.push(route.request().postDataJSON()); route.fulfill({ status: 200, contentType: 'audio/mpeg', body: 'fake-mp3' }); });
  await ctx.addInitScript(() => {
    const state = { clips: [], spoken: 0 }; window.__voice = state;
    window.Audio = class { constructor() { state.clips.push(this); } play() { if (this.src?.startsWith('blob:')) queueMicrotask(() => this.onplaying?.()); return Promise.resolve(); } pause() {} };
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { getVoices: () => [], speak: () => { state.spoken++; }, cancel() {} } });
  });
  await open(page); await card(page, 'Alice').locator('.cardmain').click(); await card(page, 'Bob').locator('.cardmain').click();
  await page.getByRole('button', { name: 'Counter', exact: true }).click();
  assert.equal(requests.length, 0);
  await page.getByRole('button', { name: '🎤 Speak order', exact: true }).click();
  await page.getByText('Reading the full order…', { exact: true }).waitFor();
  assert.deepEqual(requests, [{ text: "Boss, order ah. 2 Kopi O. That's all, gam sia boss!" }]);
  await page.evaluate(() => __voice.clips.at(-1).onended());
  await page.getByText('Order read out. Can repeat, no problem.', { exact: true }).waitFor();
  await page.getByRole('button', { name: '🎤 Speak order', exact: true }).click();
  await page.getByRole('button', { name: '■ Stop reading', exact: true }).click();
  assert.equal(requests.length, 1);
  assert.equal(await page.evaluate(() => __voice.spoken), 0);
});

test('phone voice fallback reads aggregate quantities with local wording, stops, retries, and cancels stale orders', { timeout: 60000 }, async t => {
  const state = fixture(); state.roster[1].usuals = ['Kopi O']; await seed(state);
  const { ctx, page: a } = await context(t), { page: b } = await context(t);
  await ctx.route('**/api/speak', route => route.abort());
  await ctx.addInitScript(() => {
    const state = { spoken: [], current: null, cancels: 0 }; window.__speech = state;
    const synth = {
      getVoices: () => [{ name: 'US English', lang: 'en-US' }, { name: 'Singapore English', lang: 'en-SG' }],
      speak: utterance => {
        state.spoken.push({ text: utterance.text, lang: utterance.lang, voice: utterance.voice?.name });
        state.current = utterance; queueMicrotask(() => utterance.onstart?.());
      },
      cancel: () => { state.cancels++; const current = state.current; state.current = null; current?.onerror?.({ error: 'interrupted' }); },
    };
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: synth });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: class { constructor(text) { this.text = text; } } });
  });
  await open(a); await open(b);
  await card(a, 'Alice').locator('.cardmain').click(); await card(a, 'Bob').locator('.cardmain').click();
  await a.getByRole('button', { name: 'Counter', exact: true }).click();
  assert.equal(await a.getByRole('button', { name: 'Hand back', exact: true }).count(), 0);
  assert.equal(await a.evaluate(() => __speech.spoken.length), 0);
  await a.getByRole('button', { name: '🎤 Speak order', exact: true }).click();
  await a.waitForFunction(() => __speech.spoken.length === 1);
  await a.getByRole('button', { name: '■ Stop reading', exact: true }).waitFor();
  const utterance = await a.evaluate(() => __speech.spoken[0]);
  assert.equal(utterance.text, "Boss, order ah. 2 Kopi O. That's all, gam sia boss!");
  assert.equal(utterance.lang, 'en-SG'); assert.equal(utterance.voice, 'Singapore English');
  await a.getByRole('button', { name: '■ Stop reading', exact: true }).click();
  await a.getByRole('button', { name: '🎤 Speak order', exact: true }).click();
  await a.waitForFunction(() => __speech.spoken.length === 2);
  await a.evaluate(() => __speech.current.onerror({ error: 'synthesis-failed' }));
  await a.getByRole('alert').filter({ hasText: 'Could not play speech' }).waitFor();
  await a.getByRole('button', { name: '🎤 Speak order', exact: true }).click();
  await a.waitForFunction(() => __speech.spoken.length === 3);
  await a.getByRole('button', { name: '■ Stop reading', exact: true }).waitFor();
  await editUsual(b, 'Alice', 'Kopi O', 'Coke'); await sync(a);
  await a.getByRole('button', { name: '🎤 Speak order', exact: true }).waitFor();
  await a.getByText('Order changed. Tap Speak order for the latest list.', { exact: true }).waitFor();
  assert.equal(await a.evaluate(() => __speech.spoken.length), 3);
  await a.getByRole('button', { name: '🎤 Speak order', exact: true }).click();
  await a.waitForFunction(() => __speech.spoken.length === 4);
  assert.match(await a.evaluate(() => __speech.spoken.at(-1).text), /1 Coke/);
  await a.screenshot({ path: 'artifacts/spoken-counter-mobile.png' });
  const cancels = await a.evaluate(() => __speech.cancels);
  await a.getByRole('button', { name: "Who's in", exact: true }).click();
  assert.ok(await a.evaluate(() => __speech.cancels) > cancels);
});

test('unavailable speech leaves visual counter usable with a clear explanation', { timeout: 60000 }, async t => {
  await seed(); const { ctx, page } = await context(t);
  await ctx.addInitScript(() => { Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: null }); window.Audio = undefined; });
  await open(page); await card(page, 'Alice').locator('.cardmain').click();
  await page.getByRole('button', { name: 'Counter', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '🎤 Speak order', exact: true }).isDisabled(), true);
  await page.getByText('Speech is unavailable in this browser.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'On the counter · 0/1', exact: true }).click();
  await page.getByRole('button', { name: 'mark Kopi O', exact: true }).click();
  await page.getByRole('button', { name: 'On the counter · 1/1', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Finish run', exact: true }).waitFor();
});

test('buyer editor sync, preview, plain text, cancel, reload, and concurrent form protection', { timeout: 60000 }, async t => {
  await seed(); const { page: a } = await context(t), { page: b } = await context(t); await open(a); await open(b);
  await a.locator('.buyer-names').filter({ hasText: /^Man & Stanford$/ }).waitFor();
  await a.getByRole('button', { name: 'Setup', exact: true }).click();
  await a.getByRole('button', { name: 'Edit buyer schedule', exact: true }).click();
  await a.getByLabel('Friday names', { exact: true }).fill('Preview names');
  await a.locator('.hero-editor .buyer-names').filter({ hasText: /^Preview names$/ }).waitFor();
  await a.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal((await read()).state.hero.days.Friday, 'Man & Stanford');
  await a.getByRole('button', { name: 'Edit buyer schedule', exact: true }).click();
  await a.getByLabel('Heading', { exact: true }).fill('<b>Our buyers</b>');
  await a.getByLabel('Small message', { exact: true }).fill('Thank you team');
  await a.getByLabel('Friday names', { exact: true }).fill('Pat & Sam');
  await a.getByLabel('Saturday names (optional)', { exact: true }).fill('Weekend names');
  await a.getByLabel('Fallback for days without names', { exact: true }).fill('No buyer assigned');
  await save(a, () => a.getByRole('button', { name: 'Save buyer schedule', exact: true }).click());
  await sync(b);
  await b.locator('.buyer-names').filter({ hasText: /^Pat & Sam$/ }).waitFor();
  assert.equal(await b.locator('.buyer-hero h2').innerText(), '<b>Our buyers</b>');
  assert.equal(await b.locator('.buyer-hero h2 b').count(), 0);
  await b.reload(); await b.waitForFunction(() => team.upToDate);
  assert.equal(await b.locator('.buyer-names').innerText(), 'Pat & Sam');
  assert.deepEqual((await read()).state.roster.map(p => p.name), ['Alice', 'Bob']);
  // Keep an unsaved editor open while another editor saves and syncs in.
  await a.getByRole('button', { name: 'Edit buyer schedule', exact: true }).click();
  await a.getByLabel('Friday names', { exact: true }).fill('Local draft');
  await b.getByRole('button', { name: 'Setup', exact: true }).click();
  await b.getByRole('button', { name: 'Edit buyer schedule', exact: true }).click();
  await b.getByLabel('Friday names', { exact: true }).fill('Other editor');
  await save(b, () => b.getByRole('button', { name: 'Save buyer schedule', exact: true }).click());
  await sync(a); await a.getByRole('button', { name: 'Save buyer schedule', exact: true }).click();
  await a.getByRole('alert').filter({ hasText: 'while you were editing' }).waitFor();
  assert.equal((await read()).state.hero.days.Friday, 'Other editor');
  await a.screenshot({ path: 'artifacts/buyer-editor-mobile.png', fullPage: true });
});

test('Singapore midnight, weekend and foreground day rollover with older stored data', { timeout: 60000 }, async t => {
  await seed();
  const state = fixture(); delete state.hero; await seed(state);
  const { page } = await context(t, '2026-10-29T15:59:55Z'); await open(page);
  assert.equal(await page.locator('.buyer-names').innerText(), 'WR & Caesar');
  await page.clock.fastForward(6000);
  await page.locator('.buyer-names').filter({ hasText: /^Man & Stanford$/ }).waitFor();
  await page.clock.fastForward(86400000);
  await page.locator('.buyer-names').filter({ hasText: /^No scheduled buyer today$/ }).waitFor();
  await page.clock.setFixedTime(new Date('2026-11-02T04:00:00Z'));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.locator('.buyer-names').filter({ hasText: /^Patrick & Gan$/ }).waitFor();
  const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(dimensions.scroll <= dimensions.width);
});
