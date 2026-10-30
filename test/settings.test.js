import test from 'node:test';
import assert from 'node:assert/strict';
import '../settings.js';

test('Singapore weekday, midnight, and weekend fallback are independent of host timezone', () => {
  const settings = KopiSettings.defaults();
  assert.equal(KopiSettings.buyer(settings, new Date('2026-10-29T15:59:59Z')), 'WR & Caesar');
  assert.equal(KopiSettings.buyer(settings, new Date('2026-10-29T16:00:00Z')), 'Man & Stanford');
  assert.equal(KopiSettings.singaporeDay(new Date('2026-10-29T16:00:00Z')).date, '2026-10-30');
  assert.equal(KopiSettings.buyer(settings, new Date('2026-10-30T16:00:00Z')), 'No scheduled buyer today');
  assert.equal(KopiSettings.buyer(settings, new Date('2026-11-01T04:00:00Z')), 'No scheduled buyer today');
  settings.days.Saturday = 'Weekend team';
  assert.equal(KopiSettings.buyer(settings, new Date('2026-10-31T04:00:00Z')), 'Weekend team');
  assert.match(KopiSettings.syncTime(Date.parse('2026-10-29T16:00:00Z')), /30 Oct 2026, 00:00:00 SGT/);
});

test('missing settings get defaults while existing text and empty days are preserved', () => {
  const defaults = KopiSettings.hero();
  assert.equal(defaults.days.Friday, 'Man & Stanford');
  const edited = KopiSettings.hero({ heading: '<script>alert(1)</script>', message: '', days: { Friday: '', Sunday: 'Sunday buyers' } });
  assert.equal(edited.heading, '<script>alert(1)</script>');
  assert.equal(edited.message, '');
  assert.equal(edited.days.Friday, '');
  assert.equal(edited.days.Sunday, 'Sunday buyers');
  assert.equal(edited.days.Monday, defaults.days.Monday);
  assert.equal(KopiSettings.validHero(edited), true);
  assert.equal(KopiSettings.validHero({ ...edited, heading: '' }), false);
  assert.equal(KopiSettings.validHero({ ...edited, message: 'a'.repeat(201) }), false);
  assert.equal(KopiSettings.validHero({ ...edited, days: { Friday: 123 } }), false);
});
