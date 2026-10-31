// The screens. All text goes through textContent, since addon names and titles are other
// people's data. Passwords leave the inputs as soon as they are used.
import { currentLanguage, t, toggleLanguage } from './i18n.js';
import { addonHost, collectTitles, matchTitle, mergedAddons, planLibrary, sortAddons, usableId } from './plan.js';
import * as api from './services.js';

const state = {
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

function errorText(error) {
  const key = { login: 'errLogin', network: 'errNetwork', rate: 'errRate', expired: 'errExpired', read: 'errRead', write: 'errWrite' }[error && error.code];
  return t(key || 'errUnknown');
}

function setBusy(text) {
  state.busy = text;
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
  if (state.error) return el('p', { class: 'error', role: 'alert' }, state.error);
  if (state.busy) return el('p', { class: 'busy', role: 'status' }, el('span', { class: 'spinner', 'aria-hidden': 'true' }), state.busy);
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
            state.error = t('errEmpty');
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
  setBusy(t('signingIn'));
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

function screenStart() {
  return el(
    'section',
    { class: 'card', 'aria-labelledby': 'h-nuvio' },
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
  setBusy(t('signingIn'));
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
  setBusy(t('signingIn'));
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
    el('h2', { id: 'h-profile' }, t('profile')),
    el('p', {}, t('profileHelp')),
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
    (done, total) => setBusy(t('matching', done, total))
  );
  return ids;
}

async function loadEverything() {
  state.error = '';
  state.screen = 'profile';
  setBusy(t('reading'));
  try {
    const labels = { addons: 'readAddons', library: 'readLibrary', progress: 'readProgress', watched: 'readWatched' };
    state.source = await api.nuvioData(state.nuvio, state.profile, (step) => setBusy(t(labels[step])));
    setBusy(t('readStremio'));
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
      (done, total) => setBusy(t('readManifests', done, total))
    );
    /* keep the order they have in Nuvio */
    const order = sorted.add.map((entry) => entry.url);
    ready.sort((a, b) => order.indexOf(a.url) - order.indexOf(b.url));
    state.addons = { ready, failed, already: sorted.already, disabled: sorted.disabled };

    const titles = collectTitles(state.source);
    const ids = await matchIds(titles);
    setBusy(t('planning'));
    const cache = new Map();
    const videosOf = (id) => {
      if (!cache.has(id)) cache.set(id, api.seriesVideos(id).catch(() => []));
      return cache.get(id);
    };
    state.plan = await planLibrary({ titles, ids, stremioItems: library, videosOf });
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
  return el('div', { class: 'stat' }, el('strong', {}, String(value)), el('span', {}, label));
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
  const data = {
    createdAt: new Date().toISOString(),
    nuvio: state.source,
    stremioBefore: state.before
  };
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

async function applyChanges() {
  state.error = '';
  const result = { addons: 0, titles: 0, failed: false };
  try {
    if (state.includeAddons && state.addons.ready.length) {
      setBusy(t('applyAddons'));
      await api.stremioSetAddons(state.stremio, mergedAddons(state.before.addons, state.addons.ready));
      result.addons = state.addons.ready.length;
    }
    if (state.includeLibrary && state.plan.changes.length) {
      setBusy(t('applyLibrary', 0, state.plan.changes.length));
      await api.stremioPutLibrary(state.stremio, state.plan.changes, (done, total) => {
        result.titles = done;
        setBusy(t('applyLibrary', done, total));
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
    { class: 'card', 'aria-labelledby': 'h-review' },
    el('h2', { id: 'h-review' }, t('reviewTitle')),
    el(
      'div',
      { class: 'stats' },
      stat(t('addonsNew'), ready.length),
      stat(t('titlesNew'), stats.added),
      stat(t('libraryAdd'), stats.addedToLibrary),
      stat(t('progressNew'), stats.progress),
      stat(t('watchedNew'), stats.watchedEpisodes),
      stat(t('unchanged'), stats.unchanged)
    ),
    el(
      'fieldset',
      {},
      el('legend', {}, t('include')),
      el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: state.includeAddons, on: { change: (e) => { state.includeAddons = e.target.checked; render(); } } }), t('includeAddons')),
      el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: state.includeLibrary, on: { change: (e) => { state.includeLibrary = e.target.checked; render(); } } }), t('includeLibrary'))
    ),
    ready.length ? details(t('addonListNew', ready.length), nameList(ready, addonLabel), true) : null,
    failed.length ? details(t('addonListFailed', failed.length), [el('p', { class: 'muted' }, t('addonFailedHelp')), nameList(failed, addonLabel)], true) : null,
    already.length ? details(t('addonListAlready', already.length), nameList(already, addonLabel)) : null,
    disabled.length ? details(t('addonListDisabled', disabled.length), nameList(disabled, addonLabel)) : null,
    unresolved.length
      ? details(
          t('unresolvedTitle', unresolved.length),
          [el('p', { class: 'muted' }, t('unresolvedHelp')), nameList(unresolved, (item) => `${item.name || item.contentId}${item.year ? ` (${item.year})` : ''}`)],
          true
        )
      : null,
    details(t('notCopiedTitle'), el('p', { class: 'muted' }, t('notCopied'))),
    statusLine(),
    changes.length || ready.length
      ? el(
          'div',
          { class: 'actions' },
          el('button', { class: 'secondary', type: 'button', disabled: !!state.busy, on: { click: downloadBackup } }, state.backupDone ? t('backupDone') : t('backup')),
          el('button', { class: 'primary', type: 'button', disabled: !!state.busy || !hasWork(), on: { click: applyChanges } }, t('apply')),
          el('p', { class: 'muted full' }, t('backupHelp'))
        )
      : el('div', { class: 'stack' }, el('p', { class: 'ok' }, t('nothing')), el('button', { class: 'primary', type: 'button', on: { click: finish } }, t('finish')))
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
    el('p', {}, result.failed ? t('partialHelp') : t('doneHelp')),
    el('ul', { class: 'names' }, el('li', {}, t('doneAddons', result.addons)), el('li', {}, t('doneTitles', result.titles))),
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
      el('button', { class: 'link lang', type: 'button', lang: currentLanguage() === 'pt' ? 'en' : 'pt', on: { click: () => { toggleLanguage(); render(); } } }, t('language'))
    ),
    el('h1', {}, t('title')),
    el('p', { class: 'lead' }, t('lead')),
    state.screen === 'start'
      ? el('section', { class: 'note' }, el('h2', {}, t('howTitle')), el('ul', {}, el('li', {}, t('how1')), el('li', {}, t('how2')), el('li', {}, t('how3'))))
      : null,
    stepList(),
    screens[state.screen](),
    el('footer', {}, el('p', {}, t('disclaimer')), el('p', {}, t('footerLicense')))
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
