/* Names are editable; identity lets another open browser keep its selections
   when a colleague renames someone in the shared roster. */
globalThis.KopiPeople = {
  identity(person) { return person.id || 'name:' + person.name; },
  setUsual(person, oldDrink, value) {
    const drink = value.trim().replace(/\s+/g, ' ');
    if (!drink || drink.length > 200) throw new Error('Enter a drink within 200 characters.');
    if (!person.usuals.includes(oldDrink)) throw new Error('This usual drink has changed. Reopen the editor.');
    const usuals = [...new Set(person.usuals.map(usual => usual === oldDrink ? drink : usual))];
    // Keep replacement lineage so an older browser draft can catch up through
    // several edits, including edits made while that browser was closed.
    const changes = { ...person.usualChanges, [oldDrink]: drink };
    for (const key of Object.keys(changes)) {
      if (changes[key] === oldDrink) changes[key] = drink;
      if (usuals.includes(key)) delete changes[key];
    }
    return { ...person, usuals, usualsLocked: true, usualChanges: changes };
  },
  rename({ roster, history, picked }, oldName, value) {
    const name = value.trim().replace(/\s+/g, ' ');
    if (!name) throw new Error('Enter a name.');
    if (name.length > 200) throw new Error('Keep the name within 200 characters.');
    const person = roster.find(p => p.name === oldName);
    if (!person) throw new Error('This person was removed. Refresh the list.');
    if (roster.some(p => p !== person && p.name.toLowerCase() === name.toLowerCase())) {
      throw new Error('Someone already has that name. Use a different name.');
    }
    return {
      name,
      roster: roster.map(p => p === person ? { ...p, id: this.identity(p), name } : p),
      history: history.map(run => ({ ...run, orders: run.orders.map(order =>
        order.who === oldName ? { ...order, who: name } : order) })),
      picked: Object.fromEntries(Object.entries(picked).map(([who, drink]) => [who === oldName ? name : who, drink])),
    };
  },
  move(roster, name, direction) {
    const index = roster.findIndex(p => p.name === name);
    const target = index + direction;
    if (index < 0 || ![-1, 1].includes(direction) || target < 0 || target >= roster.length) return roster;
    const next = roster.slice();
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  },
  reconcile(before, after, picked) {
    const people = new Map(after.map(person => [this.identity(person), person]));
    return Object.fromEntries(Object.entries(picked).flatMap(([name, drink]) => {
      const person = before.find(p => p.name === name);
      const current = person && people.get(this.identity(person));
      if (!current) return [];
      return [[current.name, this.currentDrink(person, current, drink)]];
    }));
  },
  currentDrink(before, after, drink) {
    if (after.usuals.includes(drink)) return drink;
    let next = drink;
    const seen = new Set();
    while (Object.hasOwn(after.usualChanges || {}, next) && !seen.has(next)) {
      seen.add(next); next = after.usualChanges[next];
      if (after.usuals.includes(next)) return next;
    }
    // Compatibility with an older writer without lineage: pair replacements,
    // rather than treating a reordering of usuals as a preference change.
    const removed = before.usuals.filter(d => !after.usuals.includes(d));
    const added = after.usuals.filter(d => !before.usuals.includes(d));
    const index = removed.indexOf(drink);
    return index >= 0 && removed.length === added.length ? added[index] : drink;
  },
  restoreDraft(value, roster) {
    if (value?.version === 2 && Array.isArray(value.roster) && value.picked) {
      return this.reconcile(value.roster, roster, value.picked);
    }
    // Legacy drafts have only names and drink strings. Replacement lineage
    // updates known former usuals; unrecognized one-off choices are retained.
    return Object.fromEntries(Object.entries(value || {}).flatMap(([name, drink]) => {
      const person = roster.find(p => p.name === name);
      return person && typeof drink === 'string' ? [[name, this.currentDrink(person, person, drink)]] : [];
    }));
  },
  draft(picked, roster) {
    return { version: 2, picked, roster: roster.map(({ id, name, usuals }) => ({ ...(id ? { id } : {}), name, usuals })) };
  },
};
