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
// One silent sample, played inside the tap so phones allow the AI clip to start after its download.
const SILENCE = 'data:audio/wav;base64,UklGRiUAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQEAAACA';
KopiSpeech.Reader = class {
  // voice(text, signal) resolves to an audio Blob; without it, or when it fails, the phone voice reads the order.
  constructor(environment = globalThis, voice = null) {
    this.env = environment; this.voice = voice; this.clip = null;
    this.serial = 0; this.listeners = new Set(); this.status = 'idle'; this.message = '';
  }
  get device() { return typeof this.env.SpeechSynthesisUtterance === 'function' && !!this.env.speechSynthesis?.speak; }
  get playable() { return !!this.voice && typeof this.env.Audio === 'function' && typeof this.env.URL?.createObjectURL === 'function'; }
  get available() { return this.device || this.playable; }
  get active() { return ['starting', 'speaking'].includes(this.status); }
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { this.listeners.forEach(fn => fn()); }
  speak(lines) {
    this.stop();
    if (!this.available) { this.status = 'error'; this.message = 'Speech is unavailable in this browser.'; this.emit(); return false; }
    const text = KopiSpeech.text(lines);
    if (!text) return false;
    return this.playable ? this.play(text) : this.say(text);
  }
  play(text) {
    const serial = ++this.serial, controller = this.controller = new AbortController();
    const audio = this.audio = new this.env.Audio();
    try { audio.src = SILENCE; audio.play()?.catch?.(() => {}); } catch {}
    this.status = 'starting'; this.message = 'Warming up the voice…'; this.emit();
    const fallback = () => {
      if (serial !== this.serial) return;
      this.release();
      if (this.device) this.say(text);
      else { this.serial++; this.status = 'error'; this.message = 'Could not play speech. Check your volume and tap Speak order to retry.'; this.emit(); }
    };
    this.timer = setTimeout(() => controller.abort(), 10000);
    const clip = this.clip?.text === text ? Promise.resolve(this.clip.blob) : this.voice(text, controller.signal);
    clip.then(blob => {
      if (serial !== this.serial) return;
      clearTimeout(this.timer); this.clip = { text, blob };
      audio.onplaying = () => {
        if (serial !== this.serial) return;
        this.status = 'speaking'; this.message = 'Reading the full order…'; this.emit();
      };
      audio.onended = () => {
        if (serial !== this.serial) return;
        this.release(); this.status = 'idle'; this.message = 'Order read out. Can repeat, no problem.'; this.emit();
      };
      audio.onerror = fallback;
      audio.src = this.url = this.env.URL.createObjectURL(blob);
      audio.play()?.catch?.(fallback);
    }).catch(fallback);
    return true;
  }
  release() {
    clearTimeout(this.timer); this.controller?.abort();
    const audio = this.audio;
    if (audio) { audio.onplaying = audio.onended = audio.onerror = null; try { audio.pause(); } catch {} }
    if (this.url) this.env.URL.revokeObjectURL(this.url);
    this.audio = this.url = this.controller = null;
  }
  say(text) {
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
    this.serial++; this.release();
    try { if (this.device) this.env.speechSynthesis.cancel(); } catch {}
    this.utterance = null; this.status = 'idle';
    if (message) this.message = message;
    else if (active) this.message = 'Readout stopped.';
    this.emit();
  }
  dispose() { this.stop(); this.listeners.clear(); }
};
