import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergedNuvioAddons, planNuvioAddons, planToNuvio, sameAddonList } from '../src/plan-nuvio.js';
import { mergeWatched, watchedIds } from '../src/watched.js';

const videos = [
  { id: 'tt7:1:1', season: 1, episode: 1 },
  { id: 'tt7:1:2', season: 1, episode: 2 },
  { id: 'tt7:2:1', season: 2, episode: 1 }
];
const empty = { addons: [], library: [], progress: [], watched: [] };
const AT = Date.UTC(2026, 5, 1);

function plan(items, nuvio = {}) {
  return planToNuvio({ stremioItems: items, nuvio: { ...empty, ...nuvio }, videosOf: async () => videos });
}

function item(extra = {}, state = {}) {
  return { _id: 'tt1', name: 'One', type: 'movie', removed: false, temp: false, _ctime: new Date(AT).toISOString(), state, ...extra };
}

test('only addons Nuvio lacks are added, and local ones stay behind', () => {
  const planned = planNuvioAddons(
    [
      { transportUrl: 'https://new.example/KEY/manifest.json', manifest: { name: 'New' } },
      { transportUrl: 'https://have.example/manifest.json', manifest: { name: 'Have' } },
      { transportUrl: 'http://127.0.0.1:11470/local-addon/manifest.json', manifest: { name: 'Local' } },
      { transportUrl: 'https://new.example/KEY/manifest.json', manifest: { name: 'Twice' } }
    ],
    [{ url: 'https://have.example', name: 'Have' }]
  );
  assert.deepEqual(planned.add.map((a) => a.name), ['New']);
  assert.equal(planned.add[0].url, 'https://new.example/KEY/manifest.json', 'the key in the link must travel');
  assert.deepEqual(planned.already.map((a) => a.name), ['Have']);
  assert.deepEqual(planned.skipped.map((a) => a.name), ['Local']);
});

test('the addon push carries the whole list, since Nuvio deletes what is missing', () => {
  const rows = [
    { url: 'https://b.example', name: 'B', enabled: false, sort_order: 1 },
    { url: 'https://a.example', name: 'A', enabled: true, sort_order: 0 }
  ];
  const merged = mergedNuvioAddons(rows, [{ url: 'https://c.example/manifest.json', name: 'C' }]);
  assert.deepEqual(merged, [
    { url: 'https://a.example', enabled: true, name: 'A', sort_order: 0 },
    { url: 'https://b.example', enabled: false, name: 'B', sort_order: 1 },
    { url: 'https://c.example/manifest.json', enabled: true, name: 'C', sort_order: 2 }
  ]);
});

test('a list that changed since the review is noticed', () => {
  const rows = [{ url: 'https://a.example' }, { url: 'https://b.example' }];
  assert.equal(sameAddonList(rows, [{ url: 'https://b.example/manifest.json' }, { url: 'https://a.example' }]), true);
  assert.equal(sameAddonList(rows, [{ url: 'https://a.example' }]), false);
});

test('library titles go across; watched-only and removed ones do not', async () => {
  const { library, stats } = await plan([
    item({ poster: 'p', posterShape: 'landscape', year: '2010' }),
    item({ _id: 'tt2', temp: true }),
    item({ _id: 'tt3', removed: true }),
    item({ _id: 'x', type: 'other' })
  ]);
  assert.equal(library.length, 1);
  assert.deepEqual(library[0], {
    content_id: 'tt1',
    content_type: 'movie',
    name: 'One',
    poster: 'p',
    poster_shape: 'LANDSCAPE',
    release_info: '2010',
    added_at: AT
  });
  assert.equal(stats.library, 1);
});

test('a title already there, even under another id, is not repeated', async () => {
  const same = await plan([item()], { library: [{ content_id: 'tt1', content_type: 'movie', name: 'One' }] });
  assert.equal(same.library.length, 0);
  assert.equal(same.stats.unchanged, 1);
  const other = await plan([item({ year: '2010' })], { library: [{ content_id: 'tmdb:9', content_type: 'movie', name: 'ONE', release_info: '2010' }] });
  assert.equal(other.library.length, 0);
  const remake = await plan([item({ year: '2020' })], { library: [{ content_id: 'tmdb:9', content_type: 'movie', name: 'One', release_info: '1990' }] });
  assert.equal(remake.library.length, 1, 'another year is another title');
});

test('progress goes in Nuvio units, with the episode', async () => {
  const { progress } = await plan([
    item({ _id: 'tt7', type: 'series' }, { lastWatched: new Date(AT).toISOString(), timeOffset: 1200000, duration: 3600000, video_id: 'tt7:2:1' })
  ]);
  assert.deepEqual(progress, [
    { content_id: 'tt7', content_type: 'series', video_id: 'tt7:2:1', position: 1200000, duration: 3600000, last_watched: AT, season: 2, episode: 1 }
  ]);
});

test('whichever device watched last wins', async () => {
  const state = { lastWatched: new Date(AT).toISOString(), timeOffset: 5000, duration: 3600000, video_id: 'tt1' };
  const newer = await plan([item({}, state)], { progress: [{ content_id: 'tt1', last_watched: AT + 1000, season: null, episode: null }] });
  assert.equal(newer.progress.length, 0);
  const older = await plan([item({}, state)], { progress: [{ content_id: 'tt1', last_watched: AT - 1000, season: null, episode: null }] });
  assert.equal(older.progress.length, 1);
});

test('nothing unusable goes as progress', async () => {
  const at = new Date(AT).toISOString();
  const { progress } = await plan([
    item({}, { lastWatched: at, timeOffset: 0, duration: 3600000 }),
    item({ _id: 'tt2' }, { lastWatched: at, timeOffset: 10, duration: 30000 }),
    item({ _id: 'tt3' }, { timeOffset: 10, duration: 3600000 }),
    item({ _id: 'tt4', removed: true }, { lastWatched: at, timeOffset: 10, duration: 3600000 })
  ]);
  assert.equal(progress.length, 0);
});

test('watched movies go once', async () => {
  const at = new Date(AT).toISOString();
  const first = await plan([item({}, { flaggedWatched: 1, lastWatched: at })]);
  assert.deepEqual(first.watched, [{ content_id: 'tt1', content_type: 'movie', title: 'One', watched_at: AT }]);
  const again = await plan([item({}, { flaggedWatched: 1, lastWatched: at })], { watched: [{ content_id: 'tt1', season: null, episode: null }] });
  assert.equal(again.watched.length, 0);
});

test('watched episodes are read from the field the apps write', async () => {
  const field = (await mergeWatched('', videos, ['tt7:1:1', 'tt7:2:1'])).field;
  assert.deepEqual(await watchedIds(field, videos), ['tt7:1:1', 'tt7:2:1']);
  const { watched } = await plan([item({ _id: 'tt7', type: 'series', name: 'Show' }, { watched: field, lastWatched: new Date(AT).toISOString() })], {
    watched: [{ content_id: 'tt7', season: 1, episode: 1 }]
  });
  assert.deepEqual(watched, [{ content_id: 'tt7', content_type: 'series', title: 'Show S02E01', season: 2, episode: 1, watched_at: AT }]);
});

test('an unreadable watched field adds nothing', async () => {
  assert.deepEqual(await watchedIds('tt7:1:1:not-base64!', videos), []);
  assert.deepEqual(await watchedIds('', videos), []);
});

test('running it twice changes nothing the second time', async () => {
  const field = (await mergeWatched('', videos, ['tt7:1:1'])).field;
  const at = new Date(AT).toISOString();
  const items = [item({ _id: 'tt7', type: 'series', name: 'Show' }, { watched: field, lastWatched: at, timeOffset: 900, duration: 3600000, video_id: 'tt7:1:2' })];
  const first = await plan(items);
  assert.equal(first.changes.length, 3);
  const second = await plan(items, {
    library: first.library,
    progress: first.progress,
    watched: first.watched
  });
  assert.equal(second.changes.length, 0);
  assert.equal(second.stats.unchanged, 1);
});
