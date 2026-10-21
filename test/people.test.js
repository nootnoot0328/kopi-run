import test from 'node:test';
import assert from 'node:assert/strict';
import '../people.js';

const initial = () => ({
  roster: [{ name: 'Alice', usuals: ['Kopi O'], groups: ['Office'] }, { name: 'Bob', usuals: ['Teh'] }],
  history: [{ ts: 1, orders: [{ who: 'Alice', drink: 'Kopi O' }, { who: 'Bob', drink: 'Teh' }] }],
  picked: { Alice: 'Kopi O', Bob: 'Teh' },
});

test('renaming preserves preferences, groups, history and current selections', () => {
  const before = initial();
  const next = KopiPeople.rename(before, 'Alice', '  Alicia   Tan  ');
  assert.equal(next.name, 'Alicia Tan');
  assert.deepEqual(next.roster[0].usuals, ['Kopi O']);
  assert.deepEqual(next.roster[0].groups, ['Office']);
  assert.equal(next.history[0].orders[0].who, 'Alicia Tan');
  assert.deepEqual(next.picked, { 'Alicia Tan': 'Kopi O', Bob: 'Teh' });
  assert.equal(before.roster[0].name, 'Alice');
  assert.equal(before.history[0].orders[0].who, 'Alice');
  const again = KopiPeople.rename(next, 'Alicia Tan', 'Ali');
  assert.equal(again.roster[0].id, next.roster[0].id);
  assert.deepEqual(KopiPeople.reconcile(before.roster, again.roster, before.picked), { Ali: 'Kopi O', Bob: 'Teh' });
});

test('empty, duplicate, long and removed names are rejected, but case edits work', () => {
  for (const name of ['', '   ', ' bOB ', 'x'.repeat(201)]) {
    assert.throws(() => KopiPeople.rename(initial(), 'Alice', name));
  }
  assert.throws(() => KopiPeople.rename(initial(), 'Nobody', 'Ali'));
  assert.equal(KopiPeople.rename(initial(), 'Alice', 'ALICE').roster[0].name, 'ALICE');
});

test('moving people preserves objects and handles the first/last boundaries', () => {
  const { roster } = initial();
  assert.deepEqual(KopiPeople.move(roster, 'Bob', -1).map(p => p.name), ['Bob', 'Alice']);
  assert.deepEqual(KopiPeople.move(roster, 'Alice', 1).map(p => p.name), ['Bob', 'Alice']);
  assert.equal(KopiPeople.move(roster, 'Alice', -1), roster);
  assert.equal(KopiPeople.move(roster, 'Bob', 1), roster);
  assert.equal(KopiPeople.move(roster, 'Nobody', 1), roster);
  assert.equal(KopiPeople.move(roster, 'Bob', 5), roster);
  assert.deepEqual(KopiPeople.reconcile(roster, [roster[1]], initial().picked), { Bob: 'Teh' });
});
