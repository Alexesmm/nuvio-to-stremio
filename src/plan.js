// Works out what changes on the Stremio account. No network and no screen here, so all of it
// can be tested. The rule throughout: add and update, never remove.
import { mergeWatched } from './watched.js';

const CREDITS_THRESHOLD = 0.9; // as the official apps: past this, the title counts as finished
const MAX_SECONDS_VALUE = 8 * 60 * 60; // older Nuvio rows hold seconds; no video lasts 28800 ms

export function toMs(value) {
  if (value == null || value === '') return 0;
  const number = Number(value);
  if (Number.isFinite(number)) return number;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/* --------------------------------- ids --------------------------------- */

/* Stremio's own catalog speaks IMDb ids, and Kitsu ids work through the Kitsu addon. Anything
   else (tmdb:550) has to be matched to an IMDb id before it means something there. */
export function usableId(contentId) {
  const id = String(contentId || '').trim();
  const imdb = id.match(/^(?:imdb:)?(tt\d+)$/);
  if (imdb) return imdb[1];
  return /^kitsu:\d+$/.test(id) ? id : '';
}

export function normalizeName(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function firstYear(value) {
  const match = String(value || '').match(/\b(19|20)\d{2}\b/);
  return match ? match[0] : '';
}

/* The catalog result that is certainly this title: the same name, and the same year when we
   know it. Without a year the name has to be unique. A doubtful match is no match, because a
   wrong title in someone's library is worse than a title they add by hand. */
export function matchTitle(results, name, year) {
  const wanted = normalizeName(name);
  if (!wanted) return '';
  const sameName = (results || []).filter((meta) => normalizeName(meta && meta.name) === wanted && /^tt\d+$/.test(meta.id || ''));
  if (year) {
    const sameYear = sameName.filter((meta) => firstYear(meta.releaseInfo || meta.year) === year);
    return sameYear.length === 1 ? sameYear[0].id : '';
  }
  return sameName.length === 1 ? sameName[0].id : '';
}

/* ------------------------------- addons -------------------------------- */

export function manifestUrl(url) {
  const clean = String(url || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(clean)) return '';
  if (/\/manifest\.json(\?.*)?$/i.test(clean)) return clean;
  const [base, query] = clean.split('?');
  return `${base.replace(/\/+$/, '')}/manifest.json${query ? `?${query}` : ''}`;
}

export function addonKey(url) {
  return manifestUrl(url).replace(/^https?:\/\//i, '').toLowerCase();
}

/* An addon link can carry the person's debrid key: on screen, only where it lives. */
export function addonHost(url) {
  try {
    return new URL(manifestUrl(url)).host;
  } catch {
    return String(url || '');
  }
}

export function sortAddons(rows, stremioAddons) {
  const have = new Set((stremioAddons || []).map((addon) => addonKey(addon.transportUrl)));
  const seen = new Set();
  const out = { add: [], already: [], disabled: [], invalid: [] };
  for (const row of rows || []) {
    const url = manifestUrl(row.url);
    const entry = { name: row.name || '', url, source: row.url };
    if (!url) {
      out.invalid.push(entry);
      continue;
    }
    const key = addonKey(url);
    if (seen.has(key)) continue;
    seen.add(key);
    if (have.has(key)) out.already.push(entry);
    else if (row.enabled === false) out.disabled.push(entry);
    else out.add.push(entry);
  }
  return out;
}

/* What is on the account stays first and untouched; new addons go after it. */
export function mergedAddons(stremioAddons, additions) {
  return [
    ...(stremioAddons || []),
    ...additions.map(({ url, manifest }) => ({ transportUrl: url, manifest, flags: {} }))
  ];
}

/* ------------------------------- titles -------------------------------- */

/* The three Nuvio lists as one record per title. */
export function collectTitles({ library = [], progress = [], watched = [] }) {
  const titles = new Map();
  function title(row) {
    const contentId = String(row.content_id || '').trim();
    if (!contentId) return null;
    if (!titles.has(contentId))
      titles.set(contentId, {
        contentId,
        type: row.content_type || 'movie',
        name: '',
        year: '',
        poster: '',
        background: '',
        shape: 'poster',
        addedAt: 0,
        inLibrary: false,
        latest: null,
        episodes: [],
        movieWatchedAt: 0
      });
    const entry = titles.get(contentId);
    if (!entry.name) entry.name = row.name || row.title || '';
    return entry;
  }
  for (const row of library) {
    const entry = title(row);
    if (!entry) continue;
    entry.inLibrary = true;
    entry.addedAt = toMs(row.added_at);
    entry.year = firstYear(row.release_info);
    entry.poster = row.poster || '';
    entry.background = row.background || '';
    entry.shape = String(row.poster_shape || 'poster').toLowerCase();
  }
  for (const row of progress) {
    const entry = title(row);
    if (!entry) continue;
    const at = toMs(row.last_watched);
    if (entry.latest && entry.latest.at >= at) continue;
    let position = Number(row.position) || 0;
    let duration = Number(row.duration) || 0;
    if (duration > 0 && duration <= MAX_SECONDS_VALUE) {
      position *= 1000;
      duration *= 1000;
    }
    entry.latest = {
      at,
      position,
      duration,
      season: row.season == null ? null : Number(row.season),
      episode: row.episode == null ? null : Number(row.episode),
      videoId: row.video_id || ''
    };
  }
  for (const row of watched) {
    const entry = title(row);
    if (!entry) continue;
    const at = toMs(row.watched_at);
    if (row.season == null || row.episode == null) entry.movieWatchedAt = Math.max(entry.movieWatchedAt, at);
    else entry.episodes.push({ season: Number(row.season), episode: Number(row.episode), at });
  }
  return titles;
}

function newItem(id, title, nowIso) {
  return {
    _id: id,
    name: title.name || id,
    type: title.type,
    poster: title.poster || '',
    posterShape: ['poster', 'landscape', 'square'].includes(title.shape) ? title.shape : 'poster',
    background: title.background || '',
    logo: '',
    year: title.year || '',
    removed: false,
    temp: true,
    _ctime: nowIso,
    _mtime: nowIso,
    state: {
      lastWatched: null,
      timeWatched: 0,
      timeOffset: 0,
      overallTimeWatched: 0,
      timesWatched: 0,
      flaggedWatched: 0,
      duration: 0,
      video_id: '',
      watched: '',
      noNotif: false,
      season: 0,
      episode: 0
    },
    behaviorHints: { defaultVideoId: null, featuredVideoId: null, hasScheduledVideos: false }
  };
}

function episodeVideoId(id, latest) {
  if (!latest) return id;
  if (latest.season == null || latest.episode == null) return latest.videoId || id;
  if (id.startsWith('kitsu:')) return latest.videoId || `${id}:${latest.episode}`;
  return `${id}:${latest.season}:${latest.episode}`;
}

function applyProgress(item, id, title) {
  const latest = title.latest;
  if (!latest || latest.position <= 0) return false;
  const current = Date.parse(item.state.lastWatched || '') || 0;
  if (latest.at <= current) return false; // whichever device watched last wins
  const finished = latest.duration > 0 && latest.position > latest.duration * CREDITS_THRESHOLD;
  item.state.lastWatched = new Date(latest.at).toISOString();
  item.state.video_id = episodeVideoId(id, latest);
  item.state.timeOffset = finished ? 0 : Math.round(latest.position);
  item.state.duration = Math.round(latest.duration);
  if (latest.season != null) item.state.season = latest.season;
  if (latest.episode != null) item.state.episode = latest.episode;
  /* a title removed from the library shows in Continue Watching only when temporary */
  if (item.removed) {
    item.removed = false;
    item.temp = true;
  }
  return true;
}

/* What has to change on the account. `ids` maps a Nuvio content id to the id on Stremio;
   `videosOf(id)` gives a series' episodes. Titles with no id on Stremio are reported. */
export async function planLibrary({ titles, ids, stremioItems, videosOf, now = Date.now() }) {
  const existing = new Map((stremioItems || []).map((item) => [item._id, item]));
  const nowIso = new Date(now).toISOString();
  const changes = [];
  const unresolved = [];
  const stats = { added: 0, addedToLibrary: 0, progress: 0, watchedTitles: 0, watchedEpisodes: 0, unchanged: 0, episodesNotFound: 0 };

  for (const title of titles.values()) {
    const id = usableId(title.contentId) || ids.get(title.contentId) || '';
    if (!id) {
      unresolved.push({ contentId: title.contentId, name: title.name, type: title.type, year: title.year });
      continue;
    }
    const before = existing.get(id);
    const item = before ? structuredClone(before) : newItem(id, title, nowIso);
    if (!item.state) item.state = newItem(id, title, nowIso).state;
    let changed = !before;
    let inLibraryNow = false;

    if (title.inLibrary && (item.removed || item.temp)) {
      item.removed = false;
      item.temp = false;
      changed = true;
      inLibraryNow = true;
    }
    if (applyProgress(item, id, title)) {
      changed = true;
      stats.progress++;
    }
    if (title.movieWatchedAt && !item.state.flaggedWatched) {
      item.state.flaggedWatched = 1;
      item.state.timesWatched = Math.max(1, item.state.timesWatched || 0);
      changed = true;
      stats.watchedTitles++;
    }
    /* the watched field is built over Cinemeta's episode list, so only for IMDb series */
    if (title.episodes.length && /^tt\d+$/.test(id)) {
      const videos = await videosOf(id);
      const vids = [];
      for (const { season, episode } of title.episodes) {
        const video = (videos || []).find((v) => Number(v.season) === season && Number(v.episode ?? v.number) === episode);
        if (video) vids.push(video.id);
        else stats.episodesNotFound++;
      }
      if (vids.length) {
        const result = await mergeWatched(item.state.watched, videos, vids);
        if (result.added) {
          item.state.watched = result.field;
          changed = true;
          stats.watchedEpisodes += result.added;
          stats.watchedTitles++;
        }
      }
    } else if (title.episodes.length) {
      stats.episodesNotFound += title.episodes.length;
    }

    if (!changed) {
      stats.unchanged++;
      continue;
    }
    item._mtime = nowIso;
    if (!before) stats.added++;
    if (inLibraryNow) stats.addedToLibrary++;
    changes.push(item);
  }
  return { changes, unresolved, stats };
}
