/* Shared storage has no browser-storage dependency. The invitation stays in the
   URL fragment and is sent only as an Authorization header to our own API. */
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
  }
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(state) { this.listeners.forEach(fn => fn(state)); }
  async request(method = 'GET', body) {
    const response = await this.fetcher('/api/team', {
      method, cache: 'no-store', credentials: 'omit',
      headers: { Authorization: 'Bearer ' + this.token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15000),
    });
    const data = await response.json();
    if (!response.ok) {
      const error = new Error(data.error || 'Could not reach team storage.');
      error.status = response.status;
      throw error;
    }
    return data;
  }
  async load() {
    const data = await this.request();
    this.version = data.version;
    this.state = data.state;
    this.saved = JSON.stringify(data.state);
    this.status = 'saved';
    this.message = 'Team list saved in the cloud';
  }
  queue(state) {
    const serialized = JSON.stringify(state);
    if (serialized === (this.pending ?? this.saved)) return;
    this.pending = serialized;
    if (this.status !== 'conflict' && this.status !== 'error') void this.flush();
  }
  async flush() {
    if (this.saving || !this.pending || this.status === 'conflict') return;
    this.saving = true;
    this.status = 'saving';
    this.message = 'Saving team changes… Keep this page open.';
    this.emit();
    try {
      while (this.pending) {
        const snapshot = this.pending;
        const data = await this.request('PUT', { version: this.version, state: JSON.parse(snapshot) });
        this.version = data.version;
        this.saved = snapshot;
        if (this.pending === snapshot) this.pending = null;
      }
      this.status = 'saved';
      this.message = 'Team list saved in the cloud';
    } catch (error) {
      this.status = error.status === 409 ? 'conflict' : 'error';
      this.message = error.status === 409
        ? 'A colleague saved changes first. Download your edits and load the latest team list, then reapply your changes.'
        : 'Changes are not saved to the team yet. Keep this page open and retry when connected.';
    } finally { this.saving = false; this.emit(); }
  }
  async refresh() {
    if (this.pending || this.saving || this.refreshing || this.status === 'conflict') return;
    this.refreshing = true;
    const expectedVersion = this.version;
    try {
      const data = await this.request();
      if (this.pending || this.saving || this.version !== expectedVersion) return;
      const changed = data.version !== this.version;
      this.version = data.version;
      this.state = data.state;
      this.saved = JSON.stringify(data.state);
      this.status = 'saved';
      this.message = 'Team list saved in the cloud';
      this.emit(changed ? data.state : undefined);
    } catch {
      if (!this.pending && !this.saving) {
        this.status = 'offline';
        this.message = 'Cannot refresh the team list. Showing the last loaded copy.';
        this.emit();
      }
    } finally { this.refreshing = false; }
  }
};
