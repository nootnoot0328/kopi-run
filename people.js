/* Names are editable; identity lets another open browser keep its selections
   when a colleague renames someone in the shared roster. */
globalThis.KopiPeople = {
  identity(person) { return person.id || 'name:' + person.name; },
  setUsual(person, oldDrink, value) {
    const drink = value.trim().replace(/\s+/g, ' ');
    if (!drink || drink.length > 200) throw new Error('Enter a drink within 200 characters.');
    if (!person.usuals.includes(oldDrink)) throw new Error('This usual drink has changed. Reopen the editor.');
    const usuals = [...new Set(person.usuals.map(usual => usual === oldDrink ? drink : usual))];
    return { ...person, usuals, usualsLocked: true };
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
    const names = new Map(after.map(person => [this.identity(person), person.name]));
    return Object.fromEntries(Object.entries(picked).flatMap(([name, drink]) => {
      const person = before.find(p => p.name === name);
      const current = person && names.get(this.identity(person));
      return current ? [[current, drink]] : [];
    }));
  },
};
