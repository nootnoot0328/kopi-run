/* Shared data and versioned saves; local current orders are never sent here. */
globalThis.KopiTeamSync = class KopiTeamSync {
  constructor(token, fetcher = fetch) {
    this.token = token;
    this.fetcher = (...args) => fetcher(...args);
    this.listeners = new Set();
    this.version = 0;
    this.saved = '';
    this.pending = null;
    this.saving = false;
    this.refreshing = false;
    this.status = 'loading';
    this.message = 'Loading the team list…';
    this.lastSyncedAt = null;
    this.checkedVersion = null;
    this.generation = 0;
  }
  normalize(state) { return { ...state, hero: KopiSettings.hero(state.hero) }; }
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(state, previous) { this.listeners.forEach(fn => fn(state, previous)); }
  get upToDate() {
    return this.status === 'saved' && !this.pending && !this.saving && !this.refreshing &&
      this.checkedVersion === this.version && this.lastSyncedAt !== null;
  }
  async request(method = 'GET', body) {
    const response = await this.fetcher('/api/team', {
      method, cache: 'no-store', credentials: 'omit',
      headers: { Authorization: 'Bearer ' + this.token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000),
    });
    const data = await response.json();
    if (!response.ok) {
      const error = new Error(data.error || 'Could not reach team storage.');
      error.status = response.status; throw error;
    }
    return data;
  }
  async load() {
    const data = await this.request();
    this.version = data.version;
    this.state = this.normalize(data.state);
    this.saved = JSON.stringify(this.state);
    this.checkedVersion = data.version;
    this.lastSyncedAt = Date.now();
    this.status = 'saved'; this.message = 'Up to date';
  }
  queue(state) {
    const serialized = JSON.stringify(this.normalize(state));
    if (serialized === (this.pending ?? this.saved)) return;
    this.generation++;
    this.pending = serialized;
    if (this.status !== 'conflict' && this.status !== 'error') void this.flush();
    else this.emit();
  }
  flush() {
    if (this.saving) return this.saveTask;
    if (!this.pending || this.status === 'conflict') return Promise.resolve(false);
    this.saveTask = this.performSave();
    return this.saveTask;
  }
  async performSave() {
    this.saving = true; this.status = 'saving';
    this.message = 'Saving team changes… Keep this page open.'; this.emit();
    try {
      while (this.pending) {
        const snapshot = this.pending;
        const data = await this.request('PUT', { version: this.version, state: JSON.parse(snapshot) });
        this.version = data.version; this.saved = snapshot; this.state = JSON.parse(snapshot);
        if (this.pending === snapshot) this.pending = null;
      }
      this.status = 'saved'; this.message = 'Changes saved. Sync to check the latest team data.';
      return true;
    } catch (error) {
      this.status = error.status === 409 ? 'conflict' : 'error';
      this.message = error.status === 409
        ? 'A colleague saved changes first. Download your edits and load the latest team list, then reapply your changes.'
        : 'Changes are not saved to the team yet. Keep this page open and retry when connected.';
      return false;
    } finally { this.saving = false; this.emit(); }
  }
  refresh() {
    if (this.pending || this.saving || this.status === 'conflict') return Promise.resolve(false);
    if (this.refreshing) return this.refreshTask;
    this.refreshTask = this.performRefresh();
    return this.refreshTask;
  }
  async performRefresh() {
    this.refreshing = true; this.status = 'checking'; this.message = 'Checking for team updates…'; this.emit();
    const expectedVersion = this.version, generation = this.generation;
    try {
      const data = await this.request();
      if (this.pending || this.saving || this.version !== expectedVersion || this.generation !== generation) return false;
      const changed = data.version !== this.version;
      const previous = this.state;
      this.version = data.version; this.state = this.normalize(data.state);
      this.saved = JSON.stringify(this.state);
      this.checkedVersion = data.version; this.lastSyncedAt = Date.now();
      this.status = 'saved'; this.message = 'Up to date';
      this.emit(changed ? this.state : undefined, previous);
      return true;
    } catch {
      if (!this.pending && !this.saving && this.generation === generation) {
        this.status = 'offline'; this.message = 'Sync failed. Showing the last loaded team data. Retry when connected.';
      }
      return false;
    } finally { this.refreshing = false; this.emit(); }
  }
  sync() {
    if (this.syncTask) return this.syncTask;
    this.syncTask = this.performSync().finally(() => { this.syncTask = null; });
    return this.syncTask;
  }
  async performSync() {
    if (this.status === 'conflict') { this.emit(); return false; }
    // Never fetch over unsaved edits. Save first, retaining them on any error.
    if (this.saving) await this.saveTask;
    if (this.pending && !await this.flush()) return false;
    if (this.pending || this.status === 'conflict') return false;
    if (this.refreshing) await this.refreshTask;
    return this.refresh();
  }
};
