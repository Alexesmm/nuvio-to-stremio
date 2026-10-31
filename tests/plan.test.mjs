import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addonHost, addonKey, collectTitles, manifestUrl, matchTitle, mergedAddons, planLibrary, sortAddons, toMs, usableId } from '../src/plan.js';
import { decodeField, mergeWatched, orderedIds } from '../src/watched.js';

const NOW = Date.UTC(2026, 9, 31);
const videos = [
  { id: 'tt7:1:2', season: 1, episode: 2 },
  { id: 'tt7:1:1', season: 1, episode: 1 },
  { id: 'tt7:2:1', season: 2, episode: 1 },
  { id: 'tt7:0:1', season: 0, episode: 1 }
];

function plan(source, stremioItems = [], ids = new Map(), list = videos) {
  return planLibrary({ titles: collectTitles(source), ids, stremioItems, videosOf: async () => list, now: NOW });
}

test('ids Stremio knows pass; others need a match', () => {
  assert.equal(usableId('tt0137523'), 'tt0137523');
  assert.equal(usableId('imdb:tt0137523'), 'tt0137523');
  assert.equal(usableId('kitsu:12'), 'kitsu:12');
  assert.equal(usableId('tmdb:550'), '');
  assert.equal(usableId(''), '');
});

test('a title matches only when certain', () => {
  const results = [
    { id: 'tt0137523', name: 'Fight Club', releaseInfo: '1999' },
    { id: 'tt15561202', name: 'Fight Club', releaseInfo: '2023' },
    { id: 'tt0456413', name: 'Fight Club: Members Only', releaseInfo: '2006' }
  ];
  assert.equal(matchTitle(results, 'Fight Club', '1999'), 'tt0137523');
  assert.equal(matchTitle(results, 'FIGHT club!', '2023'), 'tt15561202');
  assert.equal(matchTitle(results, 'Fight Club', ''), '', 'two with this name and no year is a guess');
  assert.equal(matchTitle(results, 'Fight Club', '2001'), '', 'a different year is not this title');
  assert.equal(matchTitle(results, 'Fight', '1999'), '', 'part of a name is not this title');
  assert.equal(matchTitle([{ id: 'tt1', name: 'Amélie' }], 'Amelie', ''), 'tt1', 'accents do not matter');
  assert.equal(matchTitle([{ id: 'kitsu:1', name: 'X' }], 'X', ''), '', 'only IMDb ids');
});

test('addon links become manifest links, keeping their keys', () => {
  assert.equal(manifestUrl('https://a.example'), 'https://a.example/manifest.json');
  assert.equal(manifestUrl('https://a.example/'), 'https://a.example/manifest.json');
  assert.equal(manifestUrl('https://a.example/cfg/manifest.json'), 'https://a.example/cfg/manifest.json');
  assert.equal(manifestUrl('https://a.example/manifest.json?token=K'), 'https://a.example/manifest.json?token=K');
  assert.equal(manifestUrl('https://a.example/cfg?token=K'), 'https://a.example/cfg/manifest.json?token=K');
  assert.equal(manifestUrl('stremio://a.example'), '');
  assert.equal(addonKey('http://A.example/x'), addonKey('https://a.example/x/manifest.json'));
  assert.equal(addonHost('https://a.example/SECRET-KEY/manifest.json'), 'a.example', 'keys stay off the screen');
});

test('addons are sorted without losing or repeating any', () => {
  const sorted = sortAddons(
    [
      { url: 'https://new.example', name: 'New', enabled: true },
      { url: 'https://new.example/manifest.json', name: 'New again', enabled: true },
      { url: 'https://have.example', name: 'Have', enabled: true },
      { url: 'https://off.example', name: 'Off', enabled: false },
      { url: 'not a link', name: 'Bad', enabled: true }
    ],
    [{ transportUrl: 'https://have.example/manifest.json' }]
  );
  assert.deepEqual(sorted.add.map((a) => a.name), ['New']);
  assert.deepEqual(sorted.already.map((a) => a.name), ['Have']);
  assert.deepEqual(sorted.disabled.map((a) => a.name), ['Off']);
  assert.deepEqual(sorted.invalid.map((a) => a.name), ['Bad']);
});

test('what is on the account stays first and unchanged', () => {
  const current = [{ transportUrl: 'https://v3-cinemeta.strem.io/manifest.json', manifest: { id: 'c' }, flags: { official: true, protected: true } }];
  const merged = mergedAddons(current, [{ url: 'https://new.example/manifest.json', manifest: { id: 'n' } }]);
  assert.deepEqual(merged[0], current[0]);
  assert.deepEqual(merged[1], { transportUrl: 'https://new.example/manifest.json', manifest: { id: 'n' }, flags: {} });
  assert.equal(merged.length, 2);
});

test('a library title is added to the library with its artwork', async () => {
  const { changes, stats } = await plan({
    library: [{ content_id: 'tt1', content_type: 'movie', name: 'One', poster: 'p', background: 'b', poster_shape: 'POSTER', release_info: '2001', added_at: 5 }]
  });
  assert.equal(changes.length, 1);
  const item = changes[0];
  assert.equal(item._id, 'tt1');
  assert.equal(item.removed, false);
  assert.equal(item.temp, false, 'in the library, not temporary');
  assert.equal(item.poster, 'p');
  assert.equal(item.posterShape, 'poster');
  assert.equal(item.state.timeOffset, 0);
  assert.equal(item.state.lastWatched, null);
  assert.equal(stats.added, 1);
});

test('an id with no match is listed, not added', async () => {
  const { changes, unresolved } = await plan({ library: [{ content_id: 'tmdb:550', content_type: 'movie', name: 'Fight Club', release_info: '1999' }] });
  assert.equal(changes.length, 0);
  assert.deepEqual(unresolved, [{ contentId: 'tmdb:550', name: 'Fight Club', type: 'movie', year: '1999' }]);
});

test('a matched id uses the Stremio id', async () => {
  const { changes } = await plan(
    { library: [{ content_id: 'tmdb:550', content_type: 'movie', name: 'Fight Club', release_info: '1999' }] },
    [],
    new Map([['tmdb:550', 'tt0137523']])
  );
  assert.equal(changes[0]._id, 'tt0137523');
});

test('progress reaches Continue Watching, in the units Stremio uses', async () => {
  const at = NOW - 1000;
  const { changes, stats } = await plan({
    progress: [{ content_id: 'tt1', content_type: 'movie', video_id: 'tt1', position: 3600000, duration: 7200000, last_watched: at }]
  });
  const s = changes[0].state;
  assert.equal(s.timeOffset, 3600000);
  assert.equal(s.duration, 7200000);
  assert.equal(s.video_id, 'tt1');
  assert.equal(s.lastWatched, new Date(at).toISOString());
  assert.equal(changes[0].temp, true, 'watched only: temporary, as Stremio does');
  assert.equal(changes[0].removed, false);
  assert.equal(stats.progress, 1);
});

test('the latest episode wins, with its Stremio video id', async () => {
  const { changes } = await plan({
    progress: [
      { content_id: 'tmdb:9', content_type: 'series', video_id: 'tmdb:9:1:1', season: 1, episode: 1, position: 10000000, duration: 20000000, last_watched: 100 },
      { content_id: 'tmdb:9', content_type: 'series', video_id: 'tmdb:9:2:3', season: 2, episode: 3, position: 10000000, duration: 20000000, last_watched: 200 }
    ]
  }, [], new Map([['tmdb:9', 'tt9']]));
  assert.equal(changes[0].state.video_id, 'tt9:2:3');
  assert.equal(changes[0].state.season, 2);
  assert.equal(changes[0].state.episode, 3);
});

test('older rows in seconds become milliseconds', async () => {
  const { changes } = await plan({ progress: [{ content_id: 'tt1', content_type: 'movie', position: 1800, duration: 3600, last_watched: 10 }] });
  assert.equal(changes[0].state.timeOffset, 1800000);
  assert.equal(changes[0].state.duration, 3600000);
});

test('a finished video does not return to Continue Watching', async () => {
  const { changes } = await plan({ progress: [{ content_id: 'tt1', content_type: 'movie', position: 6900000, duration: 7200000, last_watched: 10 }] });
  assert.equal(changes[0].state.timeOffset, 0);
});

test('newer progress on the Stremio account is kept', async () => {
  const existing = { _id: 'tt1', name: 'One', type: 'movie', removed: false, temp: false, state: { lastWatched: new Date(5000).toISOString(), timeOffset: 777, video_id: 'tt1' } };
  const { changes, stats } = await plan({ progress: [{ content_id: 'tt1', content_type: 'movie', position: 3600000, duration: 7200000, last_watched: 1000 }] }, [existing]);
  assert.equal(changes.length, 0);
  assert.equal(stats.unchanged, 1);
});

test('nothing on an item is lost, and the original is not touched', async () => {
  const existing = {
    _id: 'tt1', name: 'One', type: 'movie', poster: 'keep', removed: true, temp: false, customField: 'keep',
    state: { lastWatched: new Date(1).toISOString(), timeOffset: 1, overallTimeWatched: 500, video_id: 'tt1', noNotif: true }
  };
  const copy = structuredClone(existing);
  const { changes } = await plan({ library: [{ content_id: 'tt1', content_type: 'movie', name: 'Other name', poster: 'other' }] }, [existing]);
  assert.deepEqual(existing, copy);
  assert.equal(changes[0].poster, 'keep');
  assert.equal(changes[0].customField, 'keep');
  assert.equal(changes[0].state.overallTimeWatched, 500);
  assert.equal(changes[0].removed, false);
  assert.equal(changes[0].temp, false);
  assert.equal(changes[0]._mtime, new Date(NOW).toISOString(), 'a change needs a newer time to win on other devices');
});

test('running it twice changes nothing the second time', async () => {
  const source = {
    library: [{ content_id: 'tt7', content_type: 'series', name: 'Show' }],
    progress: [{ content_id: 'tt7', content_type: 'series', season: 1, episode: 2, position: 1000000, duration: 3000000, last_watched: 900 }],
    watched: [{ content_id: 'tt7', content_type: 'series', season: 1, episode: 1, watched_at: 800 }]
  };
  const first = await plan(source);
  assert.equal(first.changes.length, 1);
  const second = await plan(source, first.changes);
  assert.equal(second.changes.length, 0);
  assert.equal(second.stats.unchanged, 1);
});

test('a watched movie is flagged once', async () => {
  const { changes } = await plan({ watched: [{ content_id: 'tt1', content_type: 'movie', title: 'One', watched_at: 5 }] });
  assert.equal(changes[0].state.flaggedWatched, 1);
  assert.equal(changes[0].state.timesWatched, 1);
  assert.equal(changes[0].name, 'One');
});

test('watched episodes reach the field the apps read', async () => {
  const { changes, stats } = await plan({
    watched: [
      { content_id: 'tt7', content_type: 'series', season: 1, episode: 1, watched_at: 1 },
      { content_id: 'tt7', content_type: 'series', season: 1, episode: 2, watched_at: 2 },
      { content_id: 'tt7', content_type: 'series', season: 9, episode: 9, watched_at: 3 }
    ]
  });
  assert.equal(stats.watchedEpisodes, 2);
  assert.equal(stats.episodesNotFound, 1);
  const decoded = await decodeField(changes[0].state.watched);
  assert.equal(decoded.anchor, 'tt7:1:2');
  assert.deepEqual(decoded.bits.slice(0, 4), [0, 1, 1, 0]);
});

test('episodes already marked stay marked', async () => {
  const start = await mergeWatched('', videos, ['tt7:2:1']);
  const more = await mergeWatched(start.field, videos, ['tt7:1:1']);
  assert.equal(more.added, 1);
  assert.deepEqual((await decodeField(more.field)).bits.slice(0, 4), [0, 1, 0, 1]);
  const same = await mergeWatched(more.field, videos, ['tt7:1:1']);
  assert.equal(same.added, 0);
  assert.equal(same.field, more.field);
});

test('the field written by the LG app reads the same here', async () => {
  // produced by service/server/watched.js in StremCompat, which matches the official apps
  const field = 'tt7:1:2:3:eJxjAwAABwAH';
  const decoded = await decodeField(field);
  assert.equal(decoded.anchor, 'tt7:1:2');
  assert.equal(decoded.anchorLength, 3);
  assert.deepEqual(decoded.bits.slice(0, 4), [0, 1, 1, 0]);
  assert.deepEqual(orderedIds(videos), ['tt7:0:1', 'tt7:1:1', 'tt7:1:2', 'tt7:2:1']);
});

test('episodes added later do not shift what is marked', async () => {
  const field = (await mergeWatched('', videos, ['tt7:1:1', 'tt7:1:2'])).field;
  const grown = [...videos, { id: 'tt7:0:0', season: 0, episode: 0 }];
  const merged = await mergeWatched(field, grown, ['tt7:2:1']);
  assert.deepEqual((await decodeField(merged.field)).bits.slice(0, 5), [0, 0, 1, 1, 1]);
});

test('an unreadable field counts as empty', async () => {
  const merged = await mergeWatched('tt7:1:1:not-base64!', videos, ['tt7:1:1']);
  assert.equal(merged.added, 1);
});

test('dates in either form are read', () => {
  assert.equal(toMs(1711600000000), 1711600000000);
  assert.equal(toMs('2026-01-01T00:00:00Z'), Date.UTC(2026, 0, 1));
  assert.equal(toMs(null), 0);
});
