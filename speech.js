globalThis.KopiSpeech = {
  text(lines) {
    const drinks = lines.filter(line => line.who.length).map(line => `${line.who.length} ${line.line}`);
    return drinks.length ? `Boss, order ah. ${drinks.join('. ')}. That's all, gam sia boss!` : '';
  },
  voice(voices) {
    const language = voice => (voice.lang || '').toLowerCase().replaceAll('_', '-');
    return voices.find(v => language(v) === 'en-sg') || voices.find(v => /singapore/i.test(v.name) && language(v).startsWith('en')) ||
      voices.find(v => language(v) === 'en-gb') || voices.find(v => language(v).startsWith('en')) || null;
  },
};
KopiSpeech.Reader = class {
  constructor(environment = globalThis) {
    this.env = environment; this.serial = 0; this.listeners = new Set(); this.status = 'idle'; this.message = '';
  }
  get available() { return typeof this.env.SpeechSynthesisUtterance === 'function' && !!this.env.speechSynthesis?.speak; }
  get active() { return ['starting', 'speaking'].includes(this.status); }
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { this.listeners.forEach(fn => fn()); }
  speak(lines) {
    this.stop();
    if (!this.available) { this.status = 'error'; this.message = 'Speech is unavailable in this browser.'; this.emit(); return false; }
    const text = KopiSpeech.text(lines);
    if (!text) return false;
    const serial = ++this.serial;
    try {
      const utterance = new this.env.SpeechSynthesisUtterance(text);
      const voice = KopiSpeech.voice(this.env.speechSynthesis.getVoices());
      if (voice) utterance.voice = voice;
      utterance.lang = voice?.lang || 'en-SG'; utterance.rate = .9; utterance.pitch = 1; utterance.volume = 1;
      this.utterance = utterance;
      this.status = 'starting'; this.message = 'Starting readout…'; this.emit();
      const error = () => {
        if (serial !== this.serial) return;
        clearTimeout(this.timer); this.serial++;
        try { this.env.speechSynthesis.cancel(); } catch {}
        this.utterance = null;
        this.status = 'error'; this.message = 'Could not play speech. Check your volume and tap Speak order to retry.'; this.emit();
      };
      utterance.onstart = () => {
        if (serial !== this.serial) return;
        clearTimeout(this.timer); this.status = 'speaking'; this.message = 'Reading the full order…'; this.emit();
      };
      utterance.onend = () => {
        if (serial !== this.serial) return;
        clearTimeout(this.timer); this.utterance = null; this.status = 'idle'; this.message = 'Order read out. Can repeat, no problem.'; this.emit();
      };
      utterance.onerror = error;
      this.timer = setTimeout(error, 7000);
      this.env.speechSynthesis.speak(utterance);
      return true;
    } catch {
      clearTimeout(this.timer); this.serial++; this.status = 'error'; this.message = 'Could not start speech. Tap Speak order to retry.'; this.emit(); return false;
    }
  }
  stop(message) {
    const active = this.active;
    this.serial++; clearTimeout(this.timer);
    try { if (this.available) this.env.speechSynthesis.cancel(); } catch {}
    this.utterance = null; this.status = 'idle';
    if (message) this.message = message;
    else if (active) this.message = 'Readout stopped.';
    this.emit();
  }
  dispose() { this.stop(); this.listeners.clear(); }
};
