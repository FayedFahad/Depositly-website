import {createWorkspaceStore, WorkspaceStorageError} from './workspace-store.js';

export const LEGACY_WORKSPACE_KEY = 'depositly.web.workspace.v1';
export const ACCOUNT_WORKSPACE_PREFIX = 'depositly.web.workspace.v2';

const object = value => value && typeof value === 'object' && !Array.isArray(value);
const failure = (message, code) => new WorkspaceStorageError(message, code);
function verifiedSubject(user) {
  if (typeof user?.sub !== 'string' || !/^[A-Za-z0-9_-]{1,255}$/.test(user.sub)) {
    throw failure('A verified Google account is required to open this workspace.', 'ACCOUNT_IDENTITY_REQUIRED');
  }
  return user.sub;
}

/** Pass the profile obtained from the server-verified session, never a remembered email. */
export function accountWorkspaceKey(user, prefix = ACCOUNT_WORKSPACE_PREFIX) {
  return `${prefix}.google.${encodeURIComponent(verifiedSubject(user))}`;
}

function safeProfile(user) {
  const profile = {sub: verifiedSubject(user)};
  for (const field of ['name', 'given_name', 'family_name', 'email', 'picture']) {
    if (typeof user[field] === 'string') profile[field] = user[field].slice(0, field === 'picture' ? 2048 : 320);
  }
  return profile;
}

/**
 * Each verified Google subject and the signed-out guest have independent vaults.
 * This is local persistence, not an authentication boundary: the caller obtains
 * the active identity from its verified HttpOnly-cookie server session.
 * Opening a scope always invalidates the previous handle before it reads data.
 */
export function createAccountWorkspaces({storage, legacyKey = LEGACY_WORKSPACE_KEY, prefix = ACCOUNT_WORKSPACE_PREFIX} = {}) {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function' || !prefix || typeof prefix !== 'string') {
    throw failure('Browser workspace storage is unavailable.', 'STORAGE_UNAVAILABLE');
  }
  const guestKey = `${prefix}.guest`;
  let current = null, activeKey = null, activeSub = null, identity = null, present = false, candidate = null;

  function reset() {
    current = null; activeKey = null; activeSub = null; identity = null; present = false; candidate = null;
  }
  function assertOwner(payload) {
    if (!object(payload)) throw failure('The workspace is invalid.', 'INVALID_WORKSPACE');
    if (activeSub ? payload.owner !== activeSub : payload.owner != null) {
      throw failure('These records belong to a different workspace. Open the correct Google account or review a file import.', 'ACCOUNT_WORKSPACE_MISMATCH');
    }
  }
  function open(key, user = null) {
    activeKey = key; activeSub = user?.sub || null; identity = user ? safeProfile(user) : null;
    current = createWorkspaceStore({storage, key});
    // Treat an unreadable destination as occupied until a deliberate recovery.
    present = true;
    const payload = current.load();
    present = payload !== null;
    if (payload !== null) assertOwner(payload);
    return payload;
  }
  function openGuest() {
    reset();
    return open(guestKey);
  }
  function openAccount(verifiedUser) {
    reset();
    return open(accountWorkspaceKey(verifiedUser, prefix), verifiedUser);
  }
  function save(payload) {
    if (!current) throw failure('Open a workspace before making changes.', 'WORKSPACE_NOT_LOADED');
    assertOwner(payload);
    const credentialFields = ['access_token', 'refresh_token', 'id_token', 'accessToken', 'refreshToken', 'idToken', 'authorization', 'sessionToken', 'cookie'];
    if (credentialFields.some(field => Object.prototype.hasOwnProperty.call(payload, field))) {
      throw failure('OAuth credentials cannot be stored in a browser workspace.', 'WORKSPACE_CREDENTIALS_REJECTED');
    }
    // Remember only profile presentation fields. OAuth tokens stay on the server.
    const saved = {...payload, owner: activeSub};
    if (identity) saved.profile = {...identity};
    else delete saved.profile;
    current.save(saved);
    present = true;
    return saved;
  }
  function readLegacyRaw() {
    try { return storage.getItem(legacyKey); }
    catch (cause) { throw new WorkspaceStorageError('The previous browser workspace could not be read. Its saved copy has been kept.', 'STORAGE_UNAVAILABLE', cause); }
  }
  function inspectLegacy() {
    if (!current) throw failure('Open a workspace before reviewing previous records.', 'WORKSPACE_NOT_LOADED');
    candidate = null;
    const raw = readLegacyRaw();
    if (raw === null) return {available: false, eligible: false, ownerMatches: false, reason: 'No previous workspace found.'};
    let payload;
    try { payload = JSON.parse(raw); }
    catch { return {available: true, eligible: false, ownerMatches: false, reason: 'The previous workspace is invalid. Its original saved copy has been kept.'}; }
    if (!object(payload)) return {available: true, eligible: false, ownerMatches: false, reason: 'The previous workspace is invalid. Its original saved copy has been kept.'};
    const knownOwner = payload.owner != null && payload.owner !== '';
    const ownerMatches = knownOwner && activeSub !== null && payload.owner === activeSub;
    if (knownOwner && !ownerMatches) {
      return {available: true, eligible: false, ownerMatches: false, reason: 'Previous records belong to another Google account. Sign in with that account to review them.'};
    }
    if (present) return {available: true, eligible: false, ownerMatches, reason: 'This workspace already has a saved copy. Previous records have been kept separately.'};
    candidate = {raw, payload, key: activeKey, sub: activeSub};
    return {available: true, eligible: true, ownerMatches, requiresReview: true,
      reason: ownerMatches ? 'Previous records match this verified Google account. Review before opening them.' : 'Previous records are unassigned. Review before copying them to this workspace.',
      deposits: Array.isArray(payload.data?.assets) ? payload.data.assets.length : 0,
      receipts: object(payload.data?.paid) ? Object.keys(payload.data.paid).length : 0};
  }
  function adoptLegacy({confirmed = false} = {}) {
    if (!confirmed) throw failure('Review the previous workspace and explicitly choose to open it first.', 'LEGACY_REVIEW_REQUIRED');
    if (!current || !candidate || candidate.key !== activeKey || candidate.sub !== activeSub) {
      throw failure('Review the previous records for this workspace before copying them.', 'LEGACY_REVIEW_REQUIRED');
    }
    if (present) throw failure('This workspace already has saved records. Its data has not been replaced.', 'WORKSPACE_EXISTS');
    if (readLegacyRaw() !== candidate.raw) {
      candidate = null;
      throw failure('The previous workspace changed in another tab. Review its current copy before opening it.', 'WORKSPACE_CONFLICT');
    }
    const old = candidate.payload;
    const payload = {data: old.data, reminders: old.reminders, owner: activeSub, dirty: !!old.dirty, updatedAt: old.updatedAt};
    const saved = save(payload);
    candidate = null;
    // Preserve the old key, including guest records, as a recovery copy.
    return saved;
  }
  function markChangedExternally(key) {
    if (current && (key === activeKey || key === null)) { current.markChangedExternally(); return true; }
    return false;
  }
  return Object.freeze({openGuest, openAccount, save, inspectLegacy, adoptLegacy, markChangedExternally,
    get activeKey() { return activeKey; }, get activeSub() { return activeSub; },
    get isBlocked() { return current?.isBlocked || false; }, get hasSavedWorkspace() { return present; },
    guestKey, legacyKey});
}
