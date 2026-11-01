globalThis.KopiSettings = {
  weekdays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
  defaults() {
    return { heading: 'Who’s buying today?', message: 'Gam Sia Lao Ban hehe', fallback: 'No scheduled buyer today',
      days: { Monday: 'Patrick & Gan', Tuesday: 'YJ & Alaric', Wednesday: 'JT & Abram',
        Thursday: 'WR & Caesar', Friday: 'Man & Stanford', Saturday: '', Sunday: '' } };
  },
  hero(value) {
    const defaults = this.defaults();
    return { ...defaults, ...value, days: { ...defaults.days, ...value?.days } };
  },
  validHero(value) {
    const string = (s, required = false) => typeof s === 'string' && s.length <= 200 && (!required || !!s.trim());
    return value && typeof value === 'object' && !Array.isArray(value) &&
      string(value.heading, true) && string(value.message) && string(value.fallback, true) &&
      value.days && this.weekdays.every(day => string(value.days[day]));
  },
  singaporeDay(now = new Date()) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'long',
    }).formatToParts(now).map(p => [p.type, p.value]));
    return { date: `${parts.year}-${parts.month}-${parts.day}`, weekday: parts.weekday };
  },
  buyer(value, now = new Date()) {
    const hero = this.hero(value);
    return hero.days[this.singaporeDay(now).weekday].trim() || hero.fallback;
  },
  syncTime(timestamp) {
    if (!timestamp) return 'Never';
    return new Intl.DateTimeFormat('en-SG', { timeZone: 'Asia/Singapore',
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).format(new Date(timestamp)) + ' SGT';
  },
};
