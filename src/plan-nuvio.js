// Works out what changes on the Nuvio account when copying from Stremio. No network and no screen
// here, so all of it can be tested. As in plan.js: add and update, never remove.
import { addonKey, firstYear, manifestUrl, normalizeName, toMs } from './plan.js';
import { watchedIds } from './watched.js';

const MIN_DURATION_MS = 60000; // Nuvio does not keep progress for anything shorter

/* Which of the account's addons Nuvio does not have yet. Only https links can reach other devices:
   Stremio's own local addon lives on one computer. */
export function planNuvioAddons(stremioAddons, nuvioRows) {
  const have = new Set((nuvioRows || []).map((row) => addonKey(row.url)));
  const seen = new Set();
  const out = { add: [], already: [], skipped: [] };
  for (const addon of stremioAddons || []) {
    const url = manifestUrl(addon.transportUrl);
    const entry = { url: url || String(addon.transportUrl || ''), name: (addon.manifest && addon.manifest.name) || '', manifest: addon.manifest };
    if (!/^https:\/\//i.test(url)) {
      out.skipped.push(entry);
      continue;
    }
    const key = addonKey(url);
    if (seen.has(key)) continue;
    seen.add(key);
    if (have.has(key)) out.already.push(entry);
    else out.add.push(entry);
  }
  return out;
}

/* Nuvio's addon push REPLACES the profile's list and deletes whatever is missing from it, so this
   is always the complete list: every current row as it is, then the new ones. */
export function mergedNuvioAddons(nuvioRows, additions) {
  const rows = [...(nuvioRows || [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const current = rows.map((row) => {
    const out = { url: row.url, enabled: row.enabled !== false };
    if (row.name) out.name = row.name;
    return out;
  });
  const added = additions.map((entry) => {
    const out = { url: entry.url, enabled: true };
    if (entry.name) out.name = entry.name;
    return out;
  });
  return [...current, ...added].map((row, index) => ({ ...row, sort_order: index }));
}

export function sameAddonList(a, b) {
  const keys = (rows) => (rows || []).map((row) => addonKey(row.url)).sort().join('\n');
  return keys(a) === keys(b);
}

function progressKey(contentId, season, episode) {
  return `${contentId}|${season ?? ''}|${episode ?? ''}`;
}

function episodeOf(item) {
  const state = item.state || {};
  const match = String(state.video_id || '').match(/:(\d+):(\d+)$/);
  if (match) return { season: Number(match[1]), episode: Number(match[2]) };
  if (item.type === 'series' && state.episode > 0) return { season: state.season > 0 ? state.season : 1, episode: state.episode };
  return { season: null, episode: null };
}

function titleKey(type, name) {
  return `${type}|${normalizeName(name)}`;
}

export async function planToNuvio({ stremioItems, nuvio, videosOf }) {
  const libraryIds = new Set((nuvio.library || []).map((row) => row.content_id));
  /* the same title may be there under another id (tmdb:550), so the name and year also count */
  const libraryNames = new Map();
  for (const row of nuvio.library || []) libraryNames.set(titleKey(row.content_type, row.name), firstYear(row.release_info));
  const progressAt = new Map();
  for (const row of nuvio.progress || []) progressAt.set(progressKey(row.content_id, row.season, row.episode), toMs(row.last_watched));
  const watchedKeys = new Set((nuvio.watched || []).map((row) => progressKey(row.content_id, row.season, row.episode)));

  const library = [];
  const progress = [];
  const watched = [];
  const stats = { library: 0, progress: 0, watched: 0, unchanged: 0 };

  for (const item of stremioItems || []) {
    if (!item || !item._id || (item.type !== 'movie' && item.type !== 'series')) continue;
    const state = item.state || {};
    let changed = false;

    /* in the library: neither removed nor only there because it was watched */
    if (!item.removed && !item.temp && !libraryIds.has(item._id)) {
      const year = firstYear(item.year);
      const named = libraryNames.get(titleKey(item.type, item.name));
      const sameTitle = named !== undefined && (!named || !year || named === year);
      if (!sameTitle) {
        const row = {
          content_id: item._id,
          content_type: item.type,
          name: item.name || item._id,
          poster_shape: String(item.posterShape || 'poster').toUpperCase(),
          added_at: toMs(item._ctime) || Date.now()
        };
        if (item.poster) row.poster = item.poster;
        if (item.background) row.background = item.background;
        if (item.year) row.release_info = String(item.year);
        library.push(row);
        changed = true;
      }
    }

    /* what Continue Watching shows; whichever device watched last wins */
    const at = toMs(state.lastWatched);
    if ((!item.removed || item.temp) && state.timeOffset > 0 && state.duration >= MIN_DURATION_MS && at) {
      const { season, episode } = episodeOf(item);
      if (at > (progressAt.get(progressKey(item._id, season, episode)) ?? 0)) {
        const entry = {
          content_id: item._id,
          content_type: item.type,
          video_id: state.video_id || item._id,
          position: Math.round(state.timeOffset),
          duration: Math.round(state.duration),
          last_watched: at
        };
        if (season != null) {
          entry.season = season;
          entry.episode = episode;
        }
        progress.push(entry);
        changed = true;
      }
    }

    const watchedAt = at || toMs(item._mtime) || Date.now();
    if (item.type === 'movie' && (state.flaggedWatched || state.timesWatched > 0) && !watchedKeys.has(progressKey(item._id))) {
      watched.push({ content_id: item._id, content_type: 'movie', title: item.name || item._id, watched_at: watchedAt });
      changed = true;
    }
    /* the watched field is built over Cinemeta's episode list, so only for IMDb series */
    if (item.type === 'series' && state.watched && /^tt\d+$/.test(item._id)) {
      const videos = (await videosOf(item._id)) || [];
      const byId = new Map(videos.map((video) => [video.id, video]));
      for (const id of await watchedIds(state.watched, videos)) {
        const video = byId.get(id);
        const season = Number(video && video.season);
        const episode = Number(video && (video.episode ?? video.number));
        if (!Number.isFinite(season) || !Number.isFinite(episode) || watchedKeys.has(progressKey(item._id, season, episode))) continue;
        watched.push({
          content_id: item._id,
          content_type: 'series',
          title: `${item.name || item._id} S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`,
          season,
          episode,
          watched_at: watchedAt
        });
        changed = true;
      }
    }
    if (!changed) stats.unchanged++;
  }
  stats.library = library.length;
  stats.progress = progress.length;
  stats.watched = watched.length;
  return { library, progress, watched, changes: [...library, ...progress, ...watched], unresolved: [], stats };
}
