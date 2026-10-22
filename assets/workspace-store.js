/** Synchronous browser-vault persistence with stale-tab conflict detection. */
export class WorkspaceStorageError extends Error {
  constructor(message, code, cause) {
    super(message, cause ? {cause} : undefined);
    this.name = 'WorkspaceStorageError';
    this.code = code;
  }
}

/**
 * load() establishes the current stored revision. Call it once when opening a
 * workspace, or deliberately reload it after an external change.
 * save() never advances in-memory revision after a failed storage write.
 * The revision is the exact serialized envelope, including its update time.
 * This guards stale browser tabs; Google Drive conflicts are handled separately.
 */
export function createWorkspaceStore({storage, key} = {}) {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function' || typeof key !== 'string' || !key) {
    throw new WorkspaceStorageError('Browser workspace storage is unavailable.', 'STORAGE_UNAVAILABLE');
  }
  let expectedRaw = null, loaded = false, blocked = false;
  const conflict = () => new WorkspaceStorageError('This workspace changed in another browser tab. Reload this page before editing or saving to Drive. You can export this tab’s records first.', 'WORKSPACE_CONFLICT');
  function readRaw() {
    try { return storage.getItem(key); }
    catch (cause) { throw new WorkspaceStorageError('Your browser could not read the saved workspace. Check storage access or import a backup.', 'STORAGE_UNAVAILABLE', cause); }
  }
  function load() {
    const raw = readRaw();
    // Retain the revision even if its contents need recovery from a file backup.
    expectedRaw = raw;
    loaded = true;
    blocked = false;
    if (raw === null) return null;
    let payload;
    try { payload = JSON.parse(raw); }
    catch (cause) { throw new WorkspaceStorageError('The saved workspace could not be opened. Its saved copy has been kept. Import a valid backup to recover your records.', 'INVALID_WORKSPACE', cause); }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new WorkspaceStorageError('The saved workspace is invalid. Its saved copy has been kept. Import a valid backup to recover your records.', 'INVALID_WORKSPACE');
    }
    return payload;
  }
  function save(payload) {
    if (blocked) throw conflict();
    if (!loaded) throw new WorkspaceStorageError('Open the saved workspace before making changes.', 'WORKSPACE_NOT_LOADED');
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new WorkspaceStorageError('The workspace could not be saved because its data is invalid.', 'INVALID_WORKSPACE');
    let serialized;
    try { serialized = JSON.stringify(payload); }
    catch (cause) { throw new WorkspaceStorageError('The workspace could not be saved because its data is invalid.', 'INVALID_WORKSPACE', cause); }
    if (readRaw() !== expectedRaw) {
      blocked = true;
      throw conflict();
    }
    try { storage.setItem(key, serialized); }
    catch (cause) { throw new WorkspaceStorageError('Your browser could not save these changes. Free some storage or export a backup, then try again.', 'STORAGE_UNAVAILABLE', cause); }
    expectedRaw = serialized;
  }
  function markChangedExternally() { blocked = true; }
  return Object.freeze({load, save, markChangedExternally, get isBlocked() { return blocked; }});
}
