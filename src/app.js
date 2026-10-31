// The screens. All text goes through textContent, since addon names and titles are other
// people's data. Passwords leave the inputs as soon as they are used.
import { currentLanguage, hasText, t, toggleLanguage } from './i18n.js';
import { addonHost, collectTitles, matchTitle, mergedAddons, planLibrary, sortAddons, usableId } from './plan.js';
import { mergedNuvioAddons, planNuvioAddons, planToNuvio, sameAddonList } from './plan-nuvio.js';
import * as api from './services.js';

const REPOSITORY_URL = 'https://github.com/Alexesmm/nuvio-to-stremio';
const PROFILE_URL = 'https://github.com/Alexesmm';

const state = {
  direction: 'toStremio',
  theme: 'dark',
  screen: 'start',
  nuvio: null,
  stremio: null,
  profiles: [],
  profile: null,
  linkMode: false,
  link: null,
  linkTimer: null,
  busy: '',
  error: '',
  source: null,
  before: null,
  addons: null,
  plan: null,
  includeAddons: true,
  includeLibrary: true,
  backupDone: false,
  result: null,
  finished: false
};

const root = document.getElementById('app');

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'on') for (const [name, fn] of Object.entries(value)) node.addEventListener(name, fn);
    else if (value === true) node.setAttribute(key, '');
    else if (value !== false && value != null) node.setAttribute(key, value);
  }
  for (const child of children.flat()) if (child != null && child !== false) node.append(child);
  return node;
}

/* Text that differs when copying to Nuvio lives under the same key with this ending. */
function td(key, ...values) {
  const other = `${key}ToNuvio`;
  return state.direction === 'toNuvio' && hasText(other) ? t(other, ...values) : t(key, ...values);
}

function icon(paths) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  for (const [name, value] of Object.entries({ viewBox: '0 0 24 24', width: '18', height: '18', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' }))
    svg.setAttribute(name, value);
  for (const d of paths) {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

const GLOBE = ['M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18', 'M3 12h18', 'M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9s1.3-6.4 3.8-9'];
const SUN = ['M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8', 'M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4'];
const MOON = ['M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5'];

function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  if (state.theme === 'light') document.documentElement.setAttribute('data-theme', 'light');
  else document.documentElement.removeAttribute('data-theme');
  render();
}

function errorText(error) {
  const key = { login: 'errLogin', network: 'errNetwork', rate: 'errRate', expired: 'errExpired', read: 'errRead', write: 'errWrite', changed: 'errChanged' }[error && error.code];
  return key || 'errUnknown';
}

function setBusy(key, ...values) {
  state.busy = key ? { key, values } : '';
  render();
}

function stepList() {
  const steps = ['step1', 'step2', 'step3', 'step4'];
  const current = { start: 0, stremio: 1, profile: 1, review: 2, done: 3 }[state.screen] ?? 0;
  return el(
    'ol',
    { class: 'steps' },
    steps.map((key, i) =>
      el('li', { class: i === current ? 'now' : i < current ? 'past' : '', 'aria-current': i === current ? 'step' : null }, el('span', { class: 'num' }, String(i + 1)), el('span', { class: 'label' }, t(key)))
    )
  );
}

function statusLine() {
  if (state.error) return el('p', { class: 'error', role: 'alert' }, t(state.error));
  if (state.busy) return el('p', { class: 'busy', role: 'status' }, el('span', { class: 'spinner', 'aria-hidden': 'true' }), t(state.busy.key, ...state.busy.values));
  return null;
}

function signInForm(idPrefix, onSubmit) {
  const email = el('input', { id: `${idPrefix}-email`, type: 'email', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', required: true });
  const password = el('input', { id: `${idPrefix}-password`, type: 'password', autocomplete: 'off', required: true });
  const show = el('input', { type: 'checkbox', id: `${idPrefix}-show`, on: { change: () => (password.type = show.checked ? 'text' : 'password') } });
  return el(
    'form',
    {
      class: 'stack',
      novalidate: true,
      on: {
        submit: (event) => {
          event.preventDefault();
          const typed = { email: email.value.trim(), password: password.value };
          if (!typed.email || !typed.password) {
            state.error = 'errEmpty';
            render();
            return;
          }
          password.value = '';
          onSubmit(typed);
        }
      }
    },
    el('div', { class: 'field' }, el('label', { for: email.id }, t('email')), email),
    el('div', { class: 'field' }, el('label', { for: password.id }, t('password')), password),
    el('label', { class: 'check' }, show, t('showPassword')),
    el('button', { class: 'primary', type: 'submit', disabled: !!state.busy }, t('signIn'))
  );
}

/* ------------------------------- screens ------------------------------- */

async function signInNuvio(typed) {
  state.error = '';
  setBusy('signingIn');
  try {
    state.nuvio = await api.nuvioSignIn(typed.email, typed.password);
    state.profiles = await api.nuvioProfiles(state.nuvio);
    if (!state.profiles.length) state.profiles = [{ index: 1, name: '', usesPrimaryAddons: false, locked: false }];
    state.profile = state.profiles[0];
    state.screen = 'stremio';
  } catch (error) {
    state.nuvio = null;
    state.error = errorText(error);
  }
  setBusy('');
}

function directionChoice() {
  const option = (value, label) =>
    el(
      'label',
      { class: `direction-option${state.direction === value ? ' on' : ''}` },
      el('input', { id: `direction-${value}`, type: 'radio', name: 'direction', checked: state.direction === value, on: { change: () => { state.direction = value; state.error = ''; render(); } } }),
      label
    );
  return el('fieldset', { class: 'direction' }, el('legend', {}, t('directionTitle')), option('toStremio', t('directionToStremio')), option('toNuvio', t('directionToNuvio')));
}

function screenStart() {
  return el(
    'section',
    { class: 'card', 'aria-labelledby': 'h-nuvio' },
    directionChoice(),
    el('h2', { id: 'h-nuvio' }, t('step1')),
    statusLine(),
    signInForm('nuvio', signInNuvio)
  );
}

function stopLink() {
  clearTimeout(state.linkTimer);
  state.linkTimer = null;
}

async function pollLink(code) {
  if (state.linkMode === false || !state.link || state.link.code !== code) return;
  let session = null;
  try {
    session = await api.stremioLinkRead(code);
  } catch {
    // a failed check is simply tried again
  }
  if (!state.link || state.link.code !== code) return;
  if (session) {
    stopLink();
    state.link = null;
    state.linkMode = false;
    await stremioSignedIn(session);
    return;
  }
  state.linkTimer = setTimeout(() => pollLink(code), 3000);
}

async function startLink() {
  state.linkMode = true;
  state.error = '';
  state.link = null;
  setBusy('signingIn');
  try {
    state.link = await api.stremioLinkCreate();
    pollLink(state.link.code);
  } catch (error) {
    state.error = errorText(error);
  }
  setBusy('');
}

async function stremioSignedIn(session) {
  state.stremio = session;
  state.screen = 'profile';
  if (state.profiles.length < 2) await loadEverything();
  else render();
}

async function signInStremio(typed) {
  state.error = '';
  setBusy('signingIn');
  try {
    const session = await api.stremioSignIn(typed.email, typed.password);
    state.busy = '';
    await stremioSignedIn(session);
    return;
  } catch (error) {
    state.error = errorText(error);
  }
  setBusy('');
}

function screenStremio() {
  const body = state.linkMode
    ? el(
        'div',
        { class: 'stack' },
        el('p', {}, t('linkHelp')),
        state.link && state.link.qrcode ? el('img', { class: 'qr', src: state.link.qrcode, alt: '', width: '220', height: '220' }) : null,
        state.link ? el('a', { href: state.link.link, target: '_blank', rel: 'noopener noreferrer' }, t('linkOpen')) : null,
        state.link ? el('p', { class: 'busy', role: 'status' }, el('span', { class: 'spinner', 'aria-hidden': 'true' }), t('linkWaiting')) : null,
        el('button', { class: 'link', type: 'button', on: { click: () => { stopLink(); state.link = null; state.linkMode = false; render(); } } }, t('useEmail'))
      )
    : el(
        'div',
        { class: 'stack' },
        signInForm('stremio', signInStremio),
        el('button', { class: 'link', type: 'button', disabled: !!state.busy, on: { click: startLink } }, t('useLink'))
      );
  return el(
    'section',
    { class: 'card', 'aria-labelledby': 'h-stremio' },
    el('p', { class: 'ok' }, t('signedInAs', state.nuvio.email)),
    el('h2', { id: 'h-stremio' }, t('step2')),
    statusLine(),
    body
  );
}

function screenProfile() {
  if (state.busy || state.error) {
    return el('section', { class: 'card' }, statusLine(), state.error ? el('button', { class: 'primary', type: 'button', on: { click: loadEverything } }, t('retry')) : null);
  }
  return el(
    'section',
    { class: 'card', 'aria-labelledby': 'h-profile' },
    el('h2', { id: 'h-profile' }, td('profile')),
    el('p', {}, td('profileHelp')),
    el(
      'div',
      { class: 'stack', role: 'radiogroup', 'aria-labelledby': 'h-profile' },
      state.profiles.map((profile) =>
        el(
          'label',
          { class: 'check' },
          el('input', {
            type: 'radio',
            name: 'profile',
            checked: state.profile === profile,
            on: { change: () => (state.profile = profile) }
          }),
          `${profile.name || t('profileName', profile.index)}${profile.locked ? ` (${t('locked')})` : ''}`
        )
      )
    ),
    el('button', { class: 'primary', type: 'button', on: { click: loadEverything } }, t('continue'))
  );
}

/* Titles whose id Stremio does not know: the exact name and year in its catalog, or nothing. */
async function matchIds(titles) {
  const ids = new Map();
  const pending = [...titles.values()].filter((title) => !usableId(title.contentId) && title.name);
  await api.mapLimit(
    pending,
    4,
    async (title) => {
      try {
        const found = matchTitle(await api.searchCatalog(title.type, title.name), title.name, title.year);
        if (found) ids.set(title.contentId, found);
      } catch {
        // stays unmatched and is listed for the person
      }
    },
    (done, total) => setBusy('matching', done, total)
  );
  return ids;
}

function seriesCache() {
  const cache = new Map();
  return (id) => {
    if (!cache.has(id)) cache.set(id, api.seriesVideos(id).catch(() => []));
    return cache.get(id);
  };
}

async function loadToNuvio() {
  state.error = '';
  state.screen = 'profile';
  setBusy('reading');
  try {
    const labels = { addons: 'readAddons', library: 'readLibrary', progress: 'readProgress', watched: 'readWatched' };
    state.source = await api.nuvioData(state.nuvio, state.profile, (step) => setBusy(labels[step]));
    setBusy('readStremio');
    const [addons, library] = await Promise.all([api.stremioAddons(state.stremio), api.stremioLibrary(state.stremio)]);
    state.before = { addons, library };
    const planned = planNuvioAddons(addons, state.source.addons);
    state.addons = { ready: planned.add, failed: planned.skipped, already: planned.already, disabled: [] };
    setBusy('planning');
    state.plan = await planToNuvio({ stremioItems: library, nuvio: state.source, videosOf: seriesCache() });
    state.includeAddons = true;
    state.includeLibrary = true;
    state.backupDone = false;
    state.screen = 'review';
  } catch (error) {
    state.error = errorText(error);
  }
  setBusy('');
}

async function loadEverything() {
  if (state.direction === 'toNuvio') return loadToNuvio();
  state.error = '';
  state.screen = 'profile';
  setBusy('reading');
  try {
    const labels = { addons: 'readAddons', library: 'readLibrary', progress: 'readProgress', watched: 'readWatched' };
    state.source = await api.nuvioData(state.nuvio, state.profile, (step) => setBusy(labels[step]));
    setBusy('readStremio');
    const [addons, library] = await Promise.all([api.stremioAddons(state.stremio), api.stremioLibrary(state.stremio)]);
    state.before = { addons, library };

    const sorted = sortAddons(state.source.addons, addons);
    const failed = [...sorted.invalid];
    const ready = [];
    await api.mapLimit(
      sorted.add,
      4,
      async (entry) => {
        try {
          ready.push({ ...entry, manifest: await api.addonManifest(entry.url) });
        } catch {
          failed.push(entry);
        }
      },
      (done, total) => setBusy('readManifests', done, total)
    );
    /* keep the order they have in Nuvio */
    const order = sorted.add.map((entry) => entry.url);
    ready.sort((a, b) => order.indexOf(a.url) - order.indexOf(b.url));
    state.addons = { ready, failed, already: sorted.already, disabled: sorted.disabled };

    const titles = collectTitles(state.source);
    const ids = await matchIds(titles);
    setBusy('planning');
    state.plan = await planLibrary({ titles, ids, stremioItems: library, videosOf: seriesCache() });
    state.includeAddons = true;
    state.includeLibrary = true;
    state.backupDone = false;
    state.screen = 'review';
  } catch (error) {
    state.error = errorText(error);
  }
  setBusy('');
}

function stat(label, value) {
  return el('div', { class: 'stat' }, el('dt', {}, label), el('dd', {}, String(value)));
}

function nameList(items, nameOf) {
  return el('ul', { class: 'names' }, items.map((item) => el('li', {}, nameOf(item))));
}

function details(summary, content, open = false) {
  return el('details', { open }, el('summary', {}, summary), content);
}

function addonLabel(entry) {
  const host = addonHost(entry.url || entry.source);
  const name = (entry.manifest && entry.manifest.name) || entry.name;
  return name ? `${name} (${host})` : host;
}

function downloadBackup() {
  const data = state.direction === 'toNuvio'
    ? { createdAt: new Date().toISOString(), direction: state.direction, stremio: state.before, nuvioBefore: state.source }
    : { createdAt: new Date().toISOString(), direction: state.direction, nuvio: state.source, stremioBefore: state.before };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = el('a', { href: url, download: `accounts-backup-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  state.backupDone = true;
  render();
}

function hasWork() {
  return (state.includeAddons && state.addons.ready.length > 0) || (state.includeLibrary && state.plan.changes.length > 0);
}

async function applyToNuvio() {
  state.error = '';
  const result = { addons: 0, titles: 0, failed: false };
  const { library, progress, watched } = state.plan;
  const total = library.length + progress.length + watched.length;
  const sent = (count) => {
    result.titles += count;
    setBusy('applyLibrary', result.titles, total);
  };
  try {
    if (state.includeAddons && state.addons.ready.length) {
      setBusy('applyAddons');
      const profileIndex = state.profile.usesPrimaryAddons ? 1 : state.profile.index;
      /* the push replaces the list: read it again, and stop if it changed since the review */
      const rows = await api.nuvioAddonRows(state.nuvio, profileIndex);
      if (!sameAddonList(rows, state.source.addons)) throw new api.ServiceError('changed');
      await api.nuvioPushAddons(state.nuvio, profileIndex, mergedNuvioAddons(rows, state.addons.ready));
      result.addons = state.addons.ready.length;
    }
    if (state.includeLibrary && total) {
      setBusy('applyLibrary', 0, total);
      await api.nuvioPushLibrary(state.nuvio, state.profile.index, library, sent);
      await api.nuvioPushProgress(state.nuvio, state.profile.index, progress, sent);
      await api.nuvioPushWatched(state.nuvio, state.profile.index, watched, sent);
    }
  } catch (error) {
    result.failed = true;
    state.error = errorText(error);
  }
  state.result = result;
  state.screen = 'done';
  setBusy('');
}

async function applyChanges() {
  if (state.direction === 'toNuvio') return applyToNuvio();
  state.error = '';
  const result = { addons: 0, titles: 0, failed: false };
  try {
    if (state.includeAddons && state.addons.ready.length) {
      setBusy('applyAddons');
      await api.stremioSetAddons(state.stremio, mergedAddons(state.before.addons, state.addons.ready));
      result.addons = state.addons.ready.length;
    }
    if (state.includeLibrary && state.plan.changes.length) {
      setBusy('applyLibrary', 0, state.plan.changes.length);
      await api.stremioPutLibrary(state.stremio, state.plan.changes, (done, total) => {
        result.titles = done;
        setBusy('applyLibrary', done, total);
      });
    }
  } catch (error) {
    result.failed = true;
    state.error = errorText(error);
  }
  state.result = result;
  state.screen = 'done';
  setBusy('');
}

function screenReview() {
  const { ready, failed, already, disabled } = state.addons;
  const { stats, unresolved, changes } = state.plan;
  return el(
    'section',
    { class: 'card review', 'aria-labelledby': 'h-review' },
    el('h2', { id: 'h-review' }, td('reviewTitle')),
    el(
      'div', { class: 'review-group', 'data-included': state.includeAddons },
      el('label', { class: 'scope-choice' },
        el('input', { id: 'include-addons', type: 'checkbox', checked: state.includeAddons, on: { change: (e) => { state.includeAddons = e.target.checked; render(); } } }),
        el('span', { class: 'scope-title' }, t('includeAddons')),
        el('strong', { class: 'scope-count' }, String(ready.length))
      ),
      el('p', { class: 'scope-caption' }, t('addonsNew')),
      el('div', { class: 'review-details' },
        ready.length ? details(t('addonListNew', ready.length), nameList(ready, addonLabel)) : null,
        failed.length ? details(t('addonListFailed', failed.length), [el('p', { class: 'muted' }, td('addonFailedHelp')), nameList(failed, addonLabel)], true) : null,
        already.length ? details(t('addonListAlready', already.length), nameList(already, addonLabel)) : null,
        disabled.length ? details(t('addonListDisabled', disabled.length), nameList(disabled, addonLabel)) : null,
        state.direction === 'toNuvio' && state.profile.usesPrimaryAddons && ready.length ? el('p', { class: 'muted' }, t('sharedAddons')) : null
      )
    ),
    el(
      'div', { class: 'review-group', 'data-included': state.includeLibrary },
      el('label', { class: 'scope-choice' },
        el('input', { id: 'include-library', type: 'checkbox', checked: state.includeLibrary, on: { change: (e) => { state.includeLibrary = e.target.checked; render(); } } }),
        el('span', { class: 'scope-title' }, t('includeLibrary'))
      ),
      state.direction === 'toNuvio'
        ? el('dl', { class: 'stats' },
            stat(t('libraryAdd'), stats.library),
            stat(t('progressNew'), stats.progress),
            stat(t('watchedNewToNuvio'), stats.watched),
            stat(t('unchanged'), stats.unchanged)
          )
        : el('dl', { class: 'stats' },
            stat(t('titlesNew'), stats.added),
            stat(t('libraryAdd'), stats.addedToLibrary),
            stat(t('progressNew'), stats.progress),
            stat(t('watchedNew'), stats.watchedEpisodes),
            stat(t('unchanged'), stats.unchanged)
          ),
      unresolved.length ? details(
        t('unresolvedTitle', unresolved.length),
        [el('p', { class: 'muted' }, t('unresolvedHelp')), nameList(unresolved, (item) => `${item.name || item.contentId}${item.year ? ` (${item.year})` : ''}`)],
        true
      ) : null
    ),
    el('div', { class: 'review-limits' }, details(t('notCopiedTitle'), el('p', { class: 'muted' }, td('notCopied')))),
    statusLine(),
    changes.length || ready.length
      ? el(
          'div',
           { class: 'review-actions' },
           el('div', { class: 'backup-area' },
             el('button', { class: 'secondary', type: 'button', disabled: !!state.busy, on: { click: downloadBackup } }, state.backupDone ? t('backupDone') : t('backup')),
             el('p', { class: 'muted' }, t('backupHelp'))
           ),
          el('button', { class: 'primary', type: 'button', disabled: !!state.busy || !hasWork(), on: { click: applyChanges } }, td('apply')),
        )
      : el('div', { class: 'stack' }, el('p', { class: 'ok' }, td('nothing')), el('button', { class: 'primary', type: 'button', on: { click: finish } }, t('finish')))
  );
}

async function finish() {
  stopLink();
  const { nuvio, stremio } = state;
  state.finished = true;
  Object.assign(state, { nuvio: null, stremio: null, source: null, before: null, plan: null, addons: null, profiles: [], profile: null, result: null, screen: 'done', error: '' });
  render();
  if (nuvio) await api.nuvioSignOut(nuvio);
  if (stremio) await api.stremioSignOut(stremio);
}

function screenDone() {
  if (state.finished) {
    return el(
      'section',
      { class: 'card' },
      el('h2', {}, t('step4')),
      el('p', { class: 'ok', role: 'status' }, t('finished')),
      el('button', { class: 'secondary', type: 'button', on: { click: () => location.reload() } }, t('startOver'))
    );
  }
  const result = state.result;
  return el(
    'section',
    { class: 'card', 'aria-labelledby': 'h-done' },
    el('h2', { id: 'h-done' }, result.failed ? t('partialTitle') : t('doneTitle')),
    statusLine(),
    el('p', {}, result.failed ? t('partialHelp') : td('doneHelp')),
    el('ul', { class: 'names' }, el('li', {}, t('doneAddons', result.addons)), el('li', {}, td('doneTitles', result.titles))),
    el(
      'div',
      { class: 'actions' },
      result.failed ? el('button', { class: 'secondary', type: 'button', on: { click: loadEverything } }, t('retry')) : null,
      el('button', { class: 'primary', type: 'button', on: { click: finish } }, t('finish'))
    )
  );
}

function render() {
  const active = document.activeElement && document.activeElement.id;
  const keep = {};
  for (const input of root.querySelectorAll('input[type="email"], input[type="password"], input[type="text"]')) keep[input.id] = input.value;
  const screens = { start: screenStart, stremio: screenStremio, profile: screenProfile, review: screenReview, done: screenDone };
  document.title = t('title');
  const page = [
    el(
      'header',
      { class: 'top' },
      el('button', { id: 'theme-button', class: 'link top-button', type: 'button', on: { click: toggleTheme } }, icon(state.theme === 'dark' ? SUN : MOON), t(state.theme === 'dark' ? 'themeLight' : 'themeDark')),
      el('button', { id: 'language-button', class: 'link top-button lang', type: 'button', lang: currentLanguage() === 'pt' ? 'en' : 'pt', on: { click: () => { toggleLanguage(); render(); } } }, icon(GLOBE), t('language'))
    ),
    el('div', { class: 'layout' },
      el('div', { class: 'intro' },
        el('h1', {}, t('title')),
        el('p', { class: 'lead' }, td('lead')),
        state.screen === 'start'
          ? el('section', { class: 'note' }, el('h2', {}, t('howTitle')), el('ul', {}, el('li', {}, t('how1')), el('li', {}, t('how2')), el('li', {}, td('how3'))))
          : null
      ),
      el('div', { class: 'flow' }, stepList(), screens[state.screen]())
    ),
    el('footer', {},
      el('p', {}, t('disclaimer')),
      el('p', {}, t('footerLicense')),
      el('p', { class: 'footer-links' },
        el('a', { href: REPOSITORY_URL, target: '_blank', rel: 'noopener noreferrer' }, t('repositoryLink')),
        el('a', { href: PROFILE_URL, target: '_blank', rel: 'noopener noreferrer' }, t('developerGithub'))
      )
    )
  ];
  root.replaceChildren(...page.filter(Boolean));
  for (const [id, value] of Object.entries(keep)) {
    const input = document.getElementById(id);
    if (input) input.value = value;
  }
  if (active) document.getElementById(active)?.focus();
}

if (typeof CompressionStream === 'undefined' || typeof DecompressionStream === 'undefined' || typeof structuredClone === 'undefined') {
  root.replaceChildren(el('p', { class: 'error', role: 'alert' }, t('errBrowser')));
} else {
  document.documentElement.lang = currentLanguage() === 'pt' ? 'pt-BR' : 'en';
  render();
}
