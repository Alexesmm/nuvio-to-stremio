// The requests. Everything goes straight from this browser to each service; there is no server
// of ours in between. Sessions live in memory only and end when the page closes or at "Finish".

/* Published by Nuvio for public clients in its API documentation. */
const NUVIO_URL = 'https://api.nuvio.tv';
const NUVIO_KEY = 'sb_publishable_1Clq8rlTVACkdcZuqr6_AD__xUUC_EN';
const STREMIO_URL = 'https://api.strem.io/api';
const LINK_URL = 'https://link.stremio.com/api';
const CINEMETA_URL = 'https://v3-cinemeta.strem.io';
const TIMEOUT_MS = 20000;

export class ServiceError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

async function request(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeout || TIMEOUT_MS);
  let response;
  try {
    response = await fetch(url, { ...options, signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
  } catch {
    throw new ServiceError('network');
  } finally {
    clearTimeout(timer);
  }
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // reported by the callers that need a body
  }
  return { status: response.status, ok: response.ok, body };
}

/* ------------------------------- Nuvio --------------------------------- */

export async function nuvioSignIn(email, password) {
  const r = await request(`${NUVIO_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: NUVIO_KEY },
    body: JSON.stringify({ email, password })
  });
  if (r.status === 429) throw new ServiceError('rate');
  if (!r.ok || !r.body || !r.body.access_token) throw new ServiceError('login');
  return { token: r.body.access_token, email: (r.body.user && r.body.user.email) || email };
}

function nuvioHeaders(session) {
  return { 'Content-Type': 'application/json', apikey: NUVIO_KEY, Authorization: `Bearer ${session.token}` };
}

async function nuvioRpc(session, name, body) {
  const r = await request(`${NUVIO_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: nuvioHeaders(session),
    body: body ? JSON.stringify(body) : undefined
  });
  if (!r.ok) throw new ServiceError(r.status === 401 ? 'expired' : r.status === 429 ? 'rate' : 'read', name);
  return r.body;
}

export async function nuvioProfiles(session) {
  const rows = await nuvioRpc(session, 'sync_pull_profiles');
  const profiles = Array.isArray(rows) ? rows : [];
  return profiles
    .map((row) => ({
      index: Number(row.profile_index) || 1,
      name: row.name || '',
      usesPrimaryAddons: !!row.uses_primary_addons,
      locked: !!row.pin_enabled
    }))
    .sort((a, b) => a.index - b.index);
}

export async function nuvioData(session, profile, onStep = () => {}) {
  onStep('addons');
  const addonProfile = profile.usesPrimaryAddons ? 1 : profile.index;
  const addons = await request(`${NUVIO_URL}/rest/v1/addons?select=*&profile_id=eq.${addonProfile}&order=sort_order`, {
    headers: nuvioHeaders(session)
  });
  if (!addons.ok) throw new ServiceError(addons.status === 401 ? 'expired' : 'read', 'addons');

  onStep('library');
  const library = [];
  for (let offset = 0; ; offset += 500) {
    const page = await nuvioRpc(session, 'sync_pull_library', { p_profile_id: profile.index, p_limit: 500, p_offset: offset });
    const rows = Array.isArray(page) ? page : [];
    library.push(...rows);
    if (rows.length < 500) break;
  }

  onStep('progress');
  /* with a starting point the server does not cap the list at the latest 200 */
  const progressRows = await nuvioRpc(session, 'sync_pull_watch_progress', { p_profile_id: profile.index, p_since_last_watched: 0, p_limit: 5000 });

  onStep('watched');
  const watched = [];
  for (let page = 1; ; page++) {
    const rows = await nuvioRpc(session, 'sync_pull_watched_items', { p_profile_id: profile.index, p_page: page, p_page_size: 500 });
    const list = Array.isArray(rows) ? rows : [];
    watched.push(...list);
    if (list.length < 500) break;
  }
  return { addons: Array.isArray(addons.body) ? addons.body : [], library, progress: Array.isArray(progressRows) ? progressRows : [], watched };
}

/* The list as it is right now, to build a full replacement from. */
export async function nuvioAddonRows(session, profileIndex) {
  const r = await request(`${NUVIO_URL}/rest/v1/addons?select=*&profile_id=eq.${profileIndex}&order=sort_order`, { headers: nuvioHeaders(session) });
  if (!r.ok) throw new ServiceError(r.status === 401 ? 'expired' : 'read', 'addons');
  return Array.isArray(r.body) ? r.body : [];
}

async function nuvioWrite(session, name, body) {
  const r = await request(`${NUVIO_URL}/rest/v1/rpc/${name}`, { method: 'POST', headers: nuvioHeaders(session), body: JSON.stringify(body) });
  if (!r.ok) throw new ServiceError(r.status === 401 ? 'expired' : r.status === 429 ? 'rate' : 'write', name);
}

/* Replaces the profile's addons: `addons` must be the complete list (plan-nuvio.js). */
export function nuvioPushAddons(session, profileIndex, addons) {
  return nuvioWrite(session, 'sync_push_addons', { p_profile_id: profileIndex, p_addons: addons });
}

/* Nuvio's own clients send at most 500 items per request. */
async function inBatches(rows, send, onSent) {
  const SIZE = 500;
  for (let i = 0; i < rows.length; i += SIZE) {
    await send(rows.slice(i, i + SIZE));
    onSent(Math.min(SIZE, rows.length - i));
  }
}

export function nuvioPushLibrary(session, profileIndex, items, onSent = () => {}) {
  return inBatches(items, (batch) => nuvioWrite(session, 'sync_push_library_items', { p_profile_id: profileIndex, p_items: batch }), onSent);
}

export function nuvioPushProgress(session, profileIndex, entries, onSent = () => {}) {
  return inBatches(entries, (batch) => nuvioWrite(session, 'sync_push_watch_progress', { p_profile_id: profileIndex, p_entries: batch }), onSent);
}

export function nuvioPushWatched(session, profileIndex, items, onSent = () => {}) {
  return inBatches(items, (batch) => nuvioWrite(session, 'sync_push_watched_items', { p_profile_id: profileIndex, p_items: batch }), onSent);
}

export async function nuvioSignOut(session) {
  try {
    await request(`${NUVIO_URL}/auth/v1/logout`, { method: 'POST', headers: nuvioHeaders(session), timeout: 5000 });
  } catch {
    // the page is closing the session anyway
  }
}

/* ------------------------------ Stremio -------------------------------- */

async function stremio(method, body) {
  const r = await request(`${STREMIO_URL}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (r.body && r.body.error) {
    const code = r.body.error.code;
    const login = method === 'login';
    throw new ServiceError(login ? 'login' : code === 1 ? 'expired' : 'write', r.body.error.message);
  }
  if (!r.ok || !r.body || !('result' in r.body)) throw new ServiceError(method === 'login' ? 'login' : 'write', method);
  return r.body.result;
}

export async function stremioSignIn(email, password) {
  const result = await stremio('login', { type: 'Login', email, password });
  if (!result || !result.authKey) throw new ServiceError('login');
  return { authKey: result.authKey, email: (result.user && result.user.email) || email };
}

/* Signing in from a phone, for accounts made with Google or Facebook. */
export async function stremioLinkCreate() {
  const r = await request(`${LINK_URL}/create`);
  if (!r.ok || !r.body || !r.body.code) throw new ServiceError('network');
  return { code: r.body.code, qrcode: r.body.qrcode || '', link: r.body.link || `https://link.stremio.com?code=${encodeURIComponent(r.body.code)}` };
}

export async function stremioLinkRead(code) {
  const r = await request(`${LINK_URL}/read?code=${encodeURIComponent(code)}`);
  const result = r.body && r.body.result;
  const authKey = result && (result.authKey || result.auth_key);
  return authKey ? { authKey, email: (result.user && result.user.email) || '' } : null;
}

export async function stremioAddons(session) {
  const result = await stremio('addonCollectionGet', { type: 'AddonCollectionGet', authKey: session.authKey, update: true });
  return (result && result.addons) || [];
}

export function stremioSetAddons(session, addons) {
  return stremio('addonCollectionSet', { type: 'AddonCollectionSet', authKey: session.authKey, addons });
}

export async function stremioLibrary(session) {
  const result = await stremio('datastoreGet', { authKey: session.authKey, collection: 'libraryItem', ids: [], all: true });
  return Array.isArray(result) ? result : [];
}

export async function stremioPutLibrary(session, changes, onProgress = () => {}) {
  const SIZE = 100;
  for (let i = 0; i < changes.length; i += SIZE) {
    await stremio('datastorePut', { authKey: session.authKey, collection: 'libraryItem', changes: changes.slice(i, i + SIZE) });
    onProgress(Math.min(i + SIZE, changes.length), changes.length);
  }
}

export async function stremioSignOut(session) {
  try {
    await request(`${STREMIO_URL}/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'Logout', authKey: session.authKey }),
      timeout: 5000
    });
  } catch {
    // the page is closing the session anyway
  }
}

/* ------------------------------ public data ---------------------------- */

export async function addonManifest(url) {
  const r = await request(url, { timeout: 12000 });
  const m = r.body;
  if (!r.ok || !m || !m.id || !m.version || !m.name) throw new ServiceError('manifest');
  return m;
}

export async function searchCatalog(type, name) {
  const kind = type === 'movie' ? 'movie' : 'series';
  const r = await request(`${CINEMETA_URL}/catalog/${kind}/top/search=${encodeURIComponent(name)}.json`, { timeout: 12000 });
  return (r.ok && r.body && r.body.metas) || [];
}

export async function seriesVideos(id) {
  const r = await request(`${CINEMETA_URL}/meta/series/${encodeURIComponent(id)}.json`, { timeout: 12000 });
  return (r.ok && r.body && r.body.meta && r.body.meta.videos) || [];
}

/* Runs fn over items, a few at a time, so a big library does not flood anyone. */
export async function mapLimit(items, limit, fn, onEach = () => {}) {
  const results = new Array(items.length);
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
      onEach(++done, items.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
