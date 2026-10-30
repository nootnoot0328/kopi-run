import test from 'node:test';
import assert from 'node:assert/strict';
import '../people.js';

const initial = () => ({
  roster: [{ name: 'Alice', usuals: ['Kopi O'], groups: ['Office'] }, { name: 'Bob', usuals: ['Teh'] }],
  history: [{ ts: 1, orders: [{ who: 'Alice', drink: 'Kopi O' }, { who: 'Bob', drink: 'Teh' }] }],
  picked: { Alice: 'Kopi O', Bob: 'Teh' },
});

test('editing a usual replaces its slot, keeps person data, and marks it as manual', () => {
  const person = { id: 'person-1', name: 'Alice', usuals: ['Kopi O', 'Teh'], groups: ['Office'] };
  const edited = KopiPeople.setUsual(person, 'Kopi O', '  Teh   O Kosong Peng ');
  assert.deepEqual(edited.usuals, ['Teh O Kosong Peng', 'Teh']);
  assert.equal(edited.usualsLocked, true);
  assert.equal(edited.id, person.id);
  assert.equal(edited.groups, person.groups);
  assert.deepEqual(person.usuals, ['Kopi O', 'Teh']);
  assert.deepEqual(KopiPeople.setUsual(person, 'Kopi O', 'Teh').usuals, ['Teh']);
  for (const drink of ['', ' ', 'x'.repeat(201)]) assert.throws(() => KopiPeople.setUsual(person, 'Kopi O', drink));
  assert.throws(() => KopiPeople.setUsual(person, 'Milo', 'Teh'));
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

test('sync replaces only the selected usual that changed and keeps cards selected', () => {
  const before = [{ id: 'a', name: 'Alice', usuals: ['Kopi O', 'Teh'] }, { id: 'b', name: 'Bob', usuals: ['Milo'] }];
  const after = [KopiPeople.setUsual(before[0], 'Kopi O', 'Coke Zero'), before[1]];
  assert.deepEqual(KopiPeople.reconcile(before, after, { Alice: 'Kopi O', Bob: 'Milo' }), { Alice: 'Coke Zero', Bob: 'Milo' });
  assert.deepEqual(KopiPeople.reconcile(before, after, { Alice: 'Teh' }), { Alice: 'Teh' });
  assert.deepEqual(KopiPeople.reconcile(before, after, { Alice: 'Sprite' }), { Alice: 'Sprite' });
  assert.deepEqual(KopiPeople.reconcile(before, [{ ...before[0], usuals: ['Teh', 'Kopi O'] }, before[1]], { Alice: 'Teh' }), { Alice: 'Teh' });
});

test('saved and legacy drafts follow replacement chains, including edits made while closed', () => {
  const before = [{ id: 'a', name: 'Alice', usuals: ['Kopi O', 'Teh'] }];
  const draft = KopiPeople.draft({ Alice: 'Kopi O' }, before);
  const first = KopiPeople.setUsual(before[0], 'Kopi O', 'Coke');
  const second = KopiPeople.setUsual(first, 'Coke', 'Coke Zero');
  const renamed = { ...second, name: 'Ali' };
  assert.deepEqual(KopiPeople.restoreDraft(draft, [renamed]), { Ali: 'Coke Zero' });
  assert.deepEqual(KopiPeople.restoreDraft({ Alice: 'Kopi O' }, [second]), { Alice: 'Coke Zero' });
  assert.deepEqual(KopiPeople.restoreDraft({ Alice: 'Teh' }, [second]), { Alice: 'Teh' });
  assert.deepEqual(KopiPeople.restoreDraft({ Alice: 'Sprite' }, [second]), { Alice: 'Sprite' });
  const reverted = KopiPeople.setUsual(second, 'Coke Zero', 'Kopi O');
  assert.deepEqual(KopiPeople.restoreDraft({ Alice: 'Coke' }, [reverted]), { Alice: 'Kopi O' });
  assert.equal(Object.hasOwn(reverted.usualChanges, 'Kopi O'), false);
});
