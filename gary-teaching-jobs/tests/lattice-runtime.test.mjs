import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {JSDOM, VirtualConsole} from 'jsdom';
import {bindFeedbackDom} from './helpers/feedback-dom.mjs';
import {mountJobsAccountMenu} from '../dist/jobs-account-menu.js';
import {vacancyCard, vacancySlug, escapeText, safeLink} from '../dist/jobs-public-content.js';
import * as jobsSeo from '../dist/jobs-seo.js';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', () => {});
const latticeCss = fs.readFileSync(new URL('../dist/lattice-loader.css', import.meta.url), 'utf8');
const latticeSource = fs.readFileSync(new URL('../dist/lattice-loader.js', import.meta.url), 'utf8').replace(/^export /gm, '');
const portalSource = fs.readFileSync(new URL('../dist/jobs-portal.js', import.meta.url), 'utf8').split('\n').filter(line => !line.startsWith('import ')).join('\n');
const publicSource = fs.readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8').split('\n').filter(line => !line.startsWith('import ')).join('\n');
const portalHtml = fs.readFileSync(new URL('../dist/portal.html', import.meta.url), 'utf8');
const indexHtml = fs.readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
const candidate = {id: '10000000-0000-4000-8000-000000000001', email: 'candidate@example.test'};
const published = [{id: 'employer', kind: 'employer', slug: 'school', title_en: 'School', title_vi: 'Trường'}, {id: 'location', kind: 'location', slug: 'hanoi', title_en: 'Hanoi', title_vi: 'Hà Nội'}, {id: 'category', kind: 'category', slug: 'public', title_en: 'Public schools', title_vi: 'Trường công'}, {id: '10000000-0000-4000-8000-000000000001', kind: 'vacancy', slug: 'teacher', title_en: 'New teacher vacancy', title_vi: 'Tuyển giáo viên mới', summary_en: 'A current teaching vacancy', summary_vi: 'Tin tuyển dụng đang mở', body_en: 'Details', body_vi: 'Chi tiết', published_at: '2026-11-13T00:00:00Z', data: {location_slug: 'hanoi', category_slug: 'public', employer_slug: 'school', hours: 60, contact_email: 'jobs@example.test'}}];
const application = {id: 'app-1', vacancy_title: 'Teacher', receipt_code: 'GJ-1', created_at: '2026-11-01T00:00:00Z', stage: 'submitted', jobs_candidates: {full_name: 'A'}};

function installLattice(dom) {
  vm.runInContext(latticeSource, dom.getInternalVMContext());
  const style = dom.window.document.createElement('style');
  style.textContent = latticeCss;
  dom.window.document.head.append(style);
}
function click(node, window) {
  node.dispatchEvent(new window.MouseEvent('click', {bubbles: true, cancelable: true, button: 0}));
}
async function whenSlot(doc, selector) {
  const started = Date.now();
  while (Date.now() - started < 500) {
    const slot = doc.querySelector(selector);
    if (slot) return slot;
    await wait(10);
  }
  throw new Error(`missing ${selector}`);
}
function visibleLoaders(doc, pattern) {
  return [...doc.querySelectorAll(`.lattice-loader[data-pattern="${pattern}"]`)].filter(node => {
    for (let el = node; el; el = el.parentElement) {
      if (el.hidden) return false;
      if (el.tagName === 'DIALOG' && !el.open) return false;
    }
    const style = doc.defaultView.getComputedStyle(node);
    return style.display !== 'none' && style.visibility !== 'hidden';
  });
}
function appliedAnimation(doc, element) {
  let value = element.style.animation || '';
  for (const sheet of [...doc.styleSheets]) {
    for (const rule of [...(sheet.cssRules || [])]) {
      if (!rule.selectorText || !rule.style?.animation) continue;
      try { if (element.matches(rule.selectorText)) value = rule.style.animation; } catch { /* ignore invalid selectors */ }
    }
  }
  return value;
}
function assertPattern(doc, pattern, grid) {
  const found = visibleLoaders(doc, pattern);
  assert.equal(found.length, 1);
  assert.equal(doc.querySelectorAll('.lattice-loader').length, 1);
  const loader = found[0];
  assert.equal(loader.dataset.grid, String(grid));
  assert.equal(loader.style.getPropertyValue('--ll-color'), '');
  assert.notEqual(doc.defaultView.getComputedStyle(loader).display, 'none');
  const cells = [...loader.querySelectorAll('.lattice-loader__run .lattice-loader__cell')];
  assert.equal(cells.length, grid * grid);
  assert.equal(cells.filter(cell => cell.hasAttribute('data-hole')).length, pattern === 'orbit' ? 1 : 0);
  const lit = cells.find(cell => !cell.hasAttribute('data-hole'));
  assert.match(lit.style.animationDelay, /^\d+ms$/);
  assert.match(appliedAnimation(doc, lit), /^lattice-on\b/);
  assert.match(doc.defaultView.getComputedStyle(lit).animation, /^lattice-on\b/);
  assert.equal(doc.defaultView.getComputedStyle(loader).display, 'inline-flex');
  return loader;
}
async function whenReady(doc, selector) {
  const started = Date.now();
  while (Date.now() - started < 1000) {
    const node = doc.querySelector(selector);
    if (node) return node;
    await wait(10);
  }
  throw new Error(`missing ${selector}`);
}
async function reveal(doc, pattern, grid) {
  assert.equal(doc.querySelector('.lattice-loader'), null);
  await wait(160);
  assert.equal(doc.querySelector('.lattice-loader'), null);
  await wait(90);
  return assertPattern(doc, pattern, grid);
}
function assertMonochrome(doc, loader) {
  const color = () => doc.defaultView.getComputedStyle(loader).getPropertyValue('--ll-color').trim();
  doc.documentElement.dataset.jobsTheme = 'light';
  assert.equal(color(), '#111111');
  doc.documentElement.dataset.jobsTheme = 'dark';
  assert.equal(color(), '#ffffff');
  doc.documentElement.dataset.jobsTheme = 'light';
}
function bootPortal(options = {}) {
  const dom = new JSDOM(portalHtml, {url: options.url || 'https://jobs.garyhome.vn/portal.html?view=mine', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole});
  const w = dom.window;
  if (options.language) w.localStorage.setItem('gary-language', JSON.stringify(options.language));
  installLattice(dom);
  bindFeedbackDom(w);
  w.mountJobsAccountMenu = mountJobsAccountMenu;
  w.HTMLElement.prototype.scrollIntoView = function() {};
  w.errorText = error => error.message || 'error';
  w.unwrap = result => { if (result?.error) throw result.error; return result.data; };
  w.capabilities = options.capabilities || (async () => options.caps || {});
  w.collections = options.collections || [];
  w.createCmsAdapter = () => ({});
  w.STAGES = ['submitted', 'screening'];
  w.STAGE_LABELS = {submitted: ['Submitted', 'Đã nộp'], screening: ['Screening', 'Sàng lọc']};
  w.jobsConfig = {cvBucket: 'jobs-cv', supabaseUrl: 'https://example.test'};
  w.createStaffAdapter = () => ({overview: async () => ({viewer: {}, members: [], events: []})});
  w.mountStaffManagement = options.mountStaffManagement || (root => { root.textContent = 'Staff'; return {ready: Promise.resolve(), destroy() {}, setLanguage() {}}; });
  w.createTalentAdapter = () => ({list: async () => ({records: [], total: 0, writable: false})});
  w.mountTalentPool = options.mountTalentPool || (root => { root.innerHTML = '<h1 id="talent-title">Talent</h1>'; return {ready: Promise.resolve(), canLeave: () => true, destroy() {}, setLanguage() {}}; });
  w.mountCms = options.mountCms || (root => { root.textContent = 'CMS'; return {ready: Promise.resolve(), canLeave: () => true, destroy() {}, setLanguage() {}, navigationState: () => ({kind: 'vacancy', view: 'content'})}; });
  w.applicationList = options.applicationList || (async () => ({records: [], total: 0}));
  w.submitApplication = async () => ({receipt_code: 'GJ-1'});
  w.uploadCv = async () => {};
  w.transitionApplication = async () => ({});
  const user = options.user === undefined ? candidate : options.user;
  let authListener;
  w.db = {
    auth: {
      getUser: options.getUser || (async () => ({data: {user}})),
      signInWithPassword: options.signInWithPassword || (async () => ({data: {user: candidate}})),
      signUp: options.signUp || (async () => ({data: {}})),
      resetPasswordForEmail: options.resetPasswordForEmail || (async () => ({data: {}})),
      updateUser: options.updateUser || (async () => ({data: {user: candidate}})),
      signOut: async () => ({data: {}}),
      onAuthStateChange(callback) { authListener = callback; return {data: {subscription: {unsubscribe() {}}}}; }
    },
    from: options.from || (() => ({select() { return this; }, eq() { return this; }, maybeSingle: async () => ({data: null})})),
    rpc: async () => ({data: []})
  };
  vm.runInContext(portalSource, dom.getInternalVMContext());
  return {dom, w, doc: w.document, emit: event => authListener?.(event, {user: candidate})};
}
function bootPublic({result = published, url = 'https://jobs.garyhome.vn/', language} = {}) {
  const dom = new JSDOM(indexHtml, {url, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole});
  const w = dom.window;
  if (language) w.localStorage.setItem('gary-language', JSON.stringify(language));
  installLattice(dom);
  bindFeedbackDom(w);
  w.IntersectionObserver = class { observe() {} disconnect() {} unobserve() {} };
  w.HTMLElement.prototype.scrollIntoView = function() {};
  w.scrollTo = () => {};
  w.matchMedia = () => ({matches: false, addEventListener() {}, removeEventListener() {}});
  w.HTMLDialogElement.prototype.showModal = function() { this.open = true; };
  w.HTMLDialogElement.prototype.close = function() { if (this.open) { this.open = false; this.dispatchEvent(new w.Event('close')); } };
  w.mountGaryApps = () => ({unmount() {}});
  w.mountPhotoGallery = () => ({unmount() {}});
  w.mountGlassHero = () => ({unmount() {}, update() {}});
  Object.assign(w,jobsSeo);
 w.vacancyCard = vacancyCard;
  w.vacancySlug = vacancySlug;
  w.escapeText = escapeText;
  w.safeLink = safeLink;
  w.publicContent = typeof result === 'function' ? result : () => result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
  vm.runInContext(publicSource, dom.getInternalVMContext());
  return {dom, w, doc: w.document};
}

test('lattice styling stays monochrome and system theme resolves to light or dark', () => {
  assert.match(latticeCss, /--ll-color:\s*#111111/);
  assert.match(latticeCss, /--ll-color:\s*#ffffff/);
  assert.match(latticeCss, /prefers-reduced-motion:\s*reduce[\s\S]*animation:\s*none!important/);
  assert.match(latticeCss, /pointer-events:\s*none/);
  assert.doesNotMatch(latticeCss, /#22c55e|#ef4444|gradient|lavender|cyan/i);
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {url: 'https://jobs.garyhome.vn/', runScripts: 'outside-only', virtualConsole});
  const w = dom.window;
  w.matchMedia = query => ({matches: query.includes('dark'), addEventListener() {}, removeEventListener() {}});
  w.localStorage.setItem('gary-jobs-theme', 'system');
  vm.runInContext(fs.readFileSync(new URL('../dist/jobs-theme-init.js', import.meta.url), 'utf8'), dom.getInternalVMContext());
  assert.equal(w.document.documentElement.dataset.jobsTheme, 'dark');
  w.setGaryJobsTheme('light');
  assert.equal(w.document.documentElement.dataset.jobsTheme, 'light');
  w.setGaryJobsTheme('system');
  assert.equal(w.document.documentElement.dataset.jobsTheme, 'dark');
  dom.window.close();
});

test('a direct vacancy URL shows Orbit only after 200ms and removes it when the vacancy arrives', async () => {
  let resolveContent;
  const h = bootPublic({url: 'https://jobs.garyhome.vn/jobs/teacher', result: () => new Promise(resolve => { resolveContent = resolve; })});
  try {
    assert.match(h.doc.querySelector('#dialog-title').textContent, /Loading vacancy/);
    assert.equal(h.doc.querySelector('#detail-dialog').open, true);
    assert.equal(h.doc.getElementById('lattice-navigation'), null);
    const loader = await reveal(h.doc, 'orbit', 3);
    assert.ok(h.doc.getElementById('vacancy-lattice').contains(loader));
    assert.equal(h.doc.getElementById('published-lattice'), null);
    assertMonochrome(h.doc, loader);
    assert.ok(h.doc.getElementById('job-grid'));
    resolveContent(published);
    await wait(30);
    assert.equal(h.doc.querySelector('.lattice-loader'), null);
    assert.match(h.doc.querySelector('#dialog-title').textContent, /New teacher vacancy/);
  } finally { h.dom.window.close(); }
});

test('a direct vacancy URL removes Orbit on failure and stays silent when the response is fast', async () => {
  let rejectContent;
  const slow = bootPublic({url: 'https://jobs.garyhome.vn/jobs/teacher', result: () => new Promise((_, reject) => { rejectContent = reject; })});
  try {
    await reveal(slow.doc, 'orbit', 3);
    rejectContent(new Error('offline'));
    await wait(30);
    assert.equal(slow.doc.querySelector('.lattice-loader'), null);
    assert.match(slow.doc.querySelector('#dialog-title').textContent, /could not be loaded/);
  } finally { slow.dom.window.close(); }
  const fast = bootPublic({url: 'https://jobs.garyhome.vn/jobs/teacher', result: () => new Promise(resolve => setTimeout(() => resolve(published), 40))});
  try {
    await wait(180);
    assert.equal(fast.doc.querySelector('.lattice-loader'), null);
    assert.match(fast.doc.querySelector('#dialog-title').textContent, /New teacher vacancy/);
  } finally { fast.dom.window.close(); }
});

test('Vietnamese vacancy loading uses Orbit without a second page overlay', async () => {
  let resolveContent;
  const h = bootPublic({url: 'https://jobs.garyhome.vn/jobs/teacher', language: 'vi', result: () => new Promise(resolve => { resolveContent = resolve; })});
  try {
    assert.match(h.doc.querySelector('#dialog-title').textContent, /Đang tải tin tuyển dụng/);
    await reveal(h.doc, 'orbit', 3);
    assert.equal(h.doc.getElementById('lattice-navigation'), null);
    resolveContent(published);
    await wait(30);
    assert.equal(h.doc.querySelector('.lattice-loader'), null);
    assert.match(h.doc.querySelector('#dialog-title').textContent, /Tuyển giáo viên mới/);
  } finally { h.dom.window.close(); }
});

function installPublishedLatticeCss(doc) {
  const theme = fs.readFileSync(new URL('../dist/jobs-public-theme.css', import.meta.url), 'utf8');
  const rules = theme.match(/\.jobs-public #opportunities \.section-heading \{[^}]+\}|\.jobs-public #published-lattice \{[^}]+\}/g);
  assert.equal(rules?.length, 2);
  assert.match(rules[1], /position:\s*absolute/);
  assert.match(rules[1], /pointer-events:\s*none/);
  const style = doc.createElement('style');
  style.textContent = rules.join('\n');
  doc.head.append(style);
}

test('a slow published-vacancy refresh shows Orbit beside the heading and keeps the current cards', async () => {
  let resolveContent;
  const h = bootPublic({result: () => new Promise(resolve => { resolveContent = resolve; })});
  installPublishedLatticeCss(h.doc);
  try {
    const grid = () => h.doc.getElementById('job-grid').textContent;
    assert.match(grid(), /English Teacher/);
    assert.equal(h.doc.querySelector('.lattice-loader'), null);
    assert.equal(h.doc.getElementById('published-lattice').dataset.reserve, undefined);
    await wait(160);
    assert.equal(h.doc.querySelector('.lattice-loader'), null);
    assert.match(grid(), /English Teacher/);
    await wait(90);
    const loader = assertPattern(h.doc, 'orbit', 3);
    const slot = h.doc.getElementById('published-lattice');
    assert.ok(h.doc.querySelector('#opportunities .section-heading').contains(slot));
    assert.ok(slot.contains(loader));
    assert.equal(slot.getAttribute('role'), 'status');
    assert.match(loader.textContent, /Updating vacancies/);
    assert.match(grid(), /English Teacher/);
    assert.doesNotMatch(grid(), /New teacher vacancy/);
    assert.equal(h.doc.getElementById('lattice-navigation'), null);
    assert.equal(h.doc.defaultView.getComputedStyle(slot).position, 'absolute');
    assert.equal(h.doc.defaultView.getComputedStyle(slot).pointerEvents, 'none');
    assertMonochrome(h.doc, loader);
    click(h.doc.querySelector('[data-action="job"][data-id="bac-giang"]'), h.w);
    assert.match(h.doc.querySelector('#dialog-title').textContent, /English Teacher/);
    assert.equal(h.doc.querySelector('#detail-dialog .lattice-loader'), null);
    assert.equal(h.doc.querySelectorAll('.lattice-loader').length, 1);
    h.doc.querySelector('.dialog-close').click();
    resolveContent(published);
    await wait(30);
    assert.equal(h.doc.querySelector('.lattice-loader'), null);
    assert.equal(h.doc.getElementById('published-lattice'), null);
    assert.match(h.doc.getElementById('job-grid').textContent, /New teacher vacancy/);
    click(h.doc.querySelector('#job-grid [data-action="job"]'), h.w);
    await wait(250);
    assert.equal(h.doc.querySelector('.lattice-loader'), null);
    assert.match(h.doc.querySelector('#dialog-title').textContent, /New teacher vacancy/);
  } finally { h.dom.window.close(); }
});

test('published-vacancy refresh removes Orbit on failure, stays silent when fast, and translates the label', async () => {
  let rejectContent;
  const slow = bootPublic({result: () => new Promise((_, reject) => { rejectContent = reject; })});
  try {
    await reveal(slow.doc, 'orbit', 3);
    assert.match(slow.doc.getElementById('job-grid').textContent, /English Teacher/);
    rejectContent(new Error('offline'));
    await wait(30);
    assert.equal(slow.doc.querySelector('.lattice-loader'), null);
    assert.equal(slow.doc.getElementById('published-lattice'), null);
    assert.match(slow.doc.getElementById('job-grid').textContent, /English Teacher/);
    assert.match(slow.doc.querySelector('.jobs-live-note').textContent, /not available yet/);
  } finally { slow.dom.window.close(); }
  const fast = bootPublic({result: () => new Promise(resolve => setTimeout(() => resolve(published), 40))});
  try {
    await wait(180);
    assert.equal(fast.doc.querySelector('.lattice-loader'), null);
    assert.match(fast.doc.getElementById('job-grid').textContent, /New teacher vacancy/);
  } finally { fast.dom.window.close(); }
  let resolveVi;
  const vi = bootPublic({language: 'vi', result: () => new Promise(resolve => { resolveVi = resolve; })});
  try {
    const loader = await reveal(vi.doc, 'orbit', 3);
    assert.match(loader.textContent, /Đang cập nhật tin tuyển dụng/);
    assert.equal(vi.doc.getElementById('lattice-navigation'), null);
    resolveVi(published);
    await wait(30);
    assert.equal(vi.doc.querySelector('.lattice-loader'), null);
    assert.match(vi.doc.getElementById('job-grid').textContent, /Tuyển giáo viên mới/);
  } finally { vi.dom.window.close(); }
});

test('real page navigation shows delayed Orbit, while a ready vacancy and a hash link do not', async () => {
  let resolveContent;
  const h = bootPublic({result: () => new Promise(resolve => { resolveContent = resolve; })});
  try {
    click(h.doc.querySelector('[data-action="job"][data-id="bac-giang"]'), h.w);
    await wait(250);
    assert.equal(h.doc.querySelector('#detail-dialog .lattice-loader'), null);
    assert.match(h.doc.querySelector('#dialog-title').textContent, /English Teacher/);
    h.doc.querySelector('.dialog-close').click();
    resolveContent(published);
    await wait(30);
    click(h.doc.querySelector('a[href="#opportunities"]'), h.w);
    click(h.doc.querySelector('a[href="https://visa.garyhome.vn/"]'), h.w);
    await wait(250);
    assert.equal(h.doc.querySelector('.lattice-loader'), null);
    click(h.doc.querySelector('#job-grid [data-action="job"]'), h.w);
    await wait(250);
    assert.equal(h.doc.querySelector('.lattice-loader'), null);
    assert.match(h.doc.querySelector('#dialog-title').textContent, /New teacher vacancy/);
    h.doc.querySelector('.dialog-close').click();
    click(h.doc.querySelector('a.nav-cta'), h.w);
    await whenSlot(h.doc, '#lattice-navigation .lattice-slot');
    const loader = await reveal(h.doc, 'orbit', 3);
    assert.match(loader.textContent, /Opening page/);
    assert.equal(h.doc.defaultView.getComputedStyle(h.doc.getElementById('lattice-navigation')).pointerEvents, 'none');
    assert.ok(h.doc.getElementById('job-grid'));
    h.w.dispatchEvent(new h.w.Event('pagehide'));
    assert.equal(h.doc.getElementById('lattice-navigation').hidden, true);
    assert.equal(h.doc.querySelector('.lattice-loader'), null);
  } finally { h.dom.window.close(); }
});

test('session restoration stays text and does not mount Lattice', async () => {
  let release;
  const h = bootPortal({user: null, getUser: () => new Promise(resolve => { release = () => resolve({data: {user: null}}); })});
  try {
    await wait(250);
    assert.equal(h.doc.querySelector('.lattice-loader'), null);
    assert.equal(h.doc.querySelector('.lattice-slot'), null);
    const loading = h.doc.querySelector('#portal-loading');
    assert.equal(loading.hidden, false);
    assert.match(loading.textContent, /Checking your session…/);
    release();
    await wait(30);
    assert.equal(h.doc.querySelector('.lattice-loader'), null);
    assert.match(h.doc.querySelector('#auth-panel').textContent, /Sign in/);
  } finally { h.dom.window.close(); }
});

test('sign-in shows Dots after 200ms and removes them on success or error', async () => {
  let release, session = null;
  const success = bootPortal({user: null, getUser: async () => ({data: {user: session}}), signInWithPassword: () => new Promise(resolve => { release = () => { session = candidate; resolve({data: {user: candidate}}); }; })});
  try {
    const form = await whenReady(success.doc, '#auth-form');
    form.elements.email.value = candidate.email;
    form.elements.password.value = 'correct-password';
    form.dispatchEvent(new success.w.Event('submit', {bubbles: true, cancelable: true}));
    await whenSlot(success.doc, '#auth-form .lattice-slot');
    const loader = await reveal(success.doc, 'dots', 3);
    assert.match(loader.textContent, /Connecting securely…/);
    assert.equal(success.doc.getElementById('auth-panel').hidden, false);
    assert.equal(success.doc.getElementById('lattice-navigation'), null);
    release();
    await wait(40);
    assert.equal(success.doc.querySelector('.lattice-loader'), null);
    assert.match(success.doc.querySelector('#workspace-view').textContent, /My applications/);
  } finally { await wait(30); success.dom.window.close(); }

  let fail;
  const error = bootPortal({user: null, signInWithPassword: () => new Promise(resolve => { fail = () => resolve({error: {message: 'Invalid login', status: 400}}); })});
  try {
    const form = await whenReady(error.doc, '#auth-form');
    form.elements.email.value = candidate.email;
    form.elements.password.value = 'wrong-password';
    form.dispatchEvent(new error.w.Event('submit', {bubbles: true, cancelable: true}));
    await whenSlot(error.doc, '#auth-form .lattice-slot');
    await reveal(error.doc, 'dots', 3);
    fail();
    await wait(30);
    assert.equal(error.doc.querySelector('.lattice-loader'), null);
    assert.match(error.doc.querySelector('#portal-status').textContent, /Invalid login/);
    assert.ok(error.doc.querySelector('#auth-form'));
  } finally { await wait(30); error.dom.window.close(); }
});

test('a fast sign-in never shows Dots', async () => {
  let session = null;
  const h = bootPortal({user: null, getUser: async () => ({data: {user: session}}), signInWithPassword: () => new Promise(resolve => setTimeout(() => { session = candidate; resolve({data: {user: candidate}}); }, 40))});
  try {
    const form = await whenReady(h.doc, '#auth-form');
    form.elements.email.value = candidate.email;
    form.elements.password.value = 'correct-password';
    form.dispatchEvent(new h.w.Event('submit', {bubbles: true, cancelable: true}));
    await wait(180);
    assert.equal(h.doc.querySelector('.lattice-loader'), null);
    assert.match(h.doc.querySelector('#workspace-view').textContent, /My applications/);
  } finally { await wait(30); h.dom.window.close(); }
});

test('registration, password reset, and recovery show Dots and clear them when finished', async () => {
  let releaseSignUp;
  const registration = bootPortal({language: 'vi', user: null, signUp: () => new Promise(resolve => { releaseSignUp = () => resolve({data: {}}); })});
  try {
    const form = await whenReady(registration.doc, '#auth-form');
    form.elements.email.value = candidate.email;
    form.elements.password.value = 'long-password-1';
    click(registration.doc.querySelector('[data-action="register"]'), registration.w);
    await whenSlot(registration.doc, '#auth-form .lattice-slot');
    const loader = await reveal(registration.doc, 'dots', 3);
    assert.match(loader.textContent, /Đang kết nối an toàn…/);
    releaseSignUp();
    await wait(30);
    assert.equal(registration.doc.querySelector('.lattice-loader'), null);
    assert.match(registration.doc.querySelector('#portal-status').textContent, /Kiểm tra email/);
  } finally { await wait(30); registration.dom.window.close(); }

  let releaseReset;
  const reset = bootPortal({user: null, resetPasswordForEmail: () => new Promise(resolve => { releaseReset = () => resolve({data: {}}); })});
  try {
    (await whenReady(reset.doc, '#auth-form')).elements.email.value = candidate.email;
    click(reset.doc.querySelector('[data-action="reset"]'), reset.w);
    await whenSlot(reset.doc, '#auth-form .lattice-slot');
    const loader = await reveal(reset.doc, 'dots', 3);
    assert.match(loader.textContent, /Connecting securely…/);
    releaseReset();
    await wait(30);
    assert.equal(reset.doc.querySelector('.lattice-loader'), null);
    assert.match(reset.doc.querySelector('#portal-status').textContent, /recovery email/);
  } finally { await wait(30); reset.dom.window.close(); }

  let releaseUpdate;
  const recovery = bootPortal({user: null, updateUser: () => new Promise(resolve => { releaseUpdate = () => resolve({data: {user: candidate}}); })});
  try {
    await whenReady(recovery.doc, '#auth-form');
    recovery.emit('PASSWORD_RECOVERY');
    const form = recovery.doc.querySelector('#auth-form');
    form.elements.password.value = 'long-password-1';
    form.dispatchEvent(new recovery.w.Event('submit', {bubbles: true, cancelable: true}));
    await whenSlot(recovery.doc, '#auth-form .lattice-slot');
    await reveal(recovery.doc, 'dots', 3);
    releaseUpdate();
    await wait(40);
    assert.equal(recovery.doc.querySelector('.lattice-loader'), null);
  } finally { await wait(30); recovery.dom.window.close(); }
});

test('an empty application list shows Ripple while pending and the empty state after completion', async () => {
  let release;
  const h = bootPortal({applicationList: () => new Promise(resolve => { release = () => resolve({records: [], total: 0}); })});
  try {
    await whenSlot(h.doc, '#applications-list .lattice-slot');
    const loader = await reveal(h.doc, 'ripple', 4);
    assert.ok(h.doc.querySelector('#applications-list').contains(loader));
    assert.match(loader.textContent, /Loading applications…/);
    assert.equal(h.doc.querySelector('[data-lattice-hold]'), null);
    assert.equal(h.doc.getElementById('lattice-navigation'), null);
    assert.equal(h.doc.querySelector('#applications-list .jobs-empty'), null);
    release();
    await wait(30);
    assert.equal(h.doc.querySelector('.lattice-loader'), null);
    assert.match(h.doc.querySelector('#workspace-view').textContent, /No applications yet/);
  } finally { h.dom.window.close(); }
});

test('a failed or fast application read never leaves a loader in place of the empty state', async () => {
  let rejectList;
  const failed = bootPortal({applicationList: () => new Promise((_, reject) => { rejectList = () => reject(Object.assign(new Error('list down'), {status: 500})); })});
  try {
    await whenSlot(failed.doc, '#applications-list .lattice-slot');
    await reveal(failed.doc, 'ripple', 4);
    rejectList();
    await wait(30);
    assert.equal(failed.doc.querySelector('.lattice-loader'), null);
    assert.equal(failed.doc.querySelector('#applications-list .jobs-empty'), null);
    assert.match(failed.doc.querySelector('#portal-status').textContent, /could not be loaded/);
  } finally { failed.dom.window.close(); }

  const fast = bootPortal({applicationList: () => new Promise(resolve => setTimeout(() => resolve({records: [], total: 0}), 30))});
  try {
    await wait(180);
    assert.equal(fast.doc.querySelector('.lattice-loader'), null);
    assert.match(fast.doc.querySelector('#workspace-view').textContent, /No applications yet/);
  } finally { fast.dom.window.close(); }
});

test('recruitment refresh shows one Ripple over the current list and an empty result replaces it', async () => {
  const calls = [];
  const h = bootPortal({
    url: 'https://jobs.garyhome.vn/portal.html?access=staff&view=applications',
    caps: {recruit: true},
    applicationList: () => new Promise(resolve => calls.push(resolve))
  });
  try {
    await whenSlot(h.doc, '#applications-list .lattice-slot');
    await reveal(h.doc, 'ripple', 4);
    calls[0]({records: [application], total: 1});
    await wait(30);
    assert.equal(h.doc.querySelector('.lattice-loader'), null);
    assert.match(h.doc.querySelector('#applications-list').textContent, /Teacher/);
    h.doc.querySelector('#application-filters').dispatchEvent(new h.w.Event('submit', {bubbles: true, cancelable: true}));
    await whenSlot(h.doc, '#applications-list .lattice-slot');
    const loader = await reveal(h.doc, 'ripple', 4);
    assert.equal(h.doc.querySelectorAll('.lattice-loader').length, 1);
    assert.ok(h.doc.querySelector('#applications-list').contains(loader));
    calls[1]({records: [], total: 0});
    await wait(30);
    assert.equal(h.doc.querySelector('.lattice-loader'), null);
    assert.match(h.doc.querySelector('#applications-list').textContent, /No applications match this view/);
    assert.equal(h.doc.querySelector('#applications-list .jobs-record'), null);
  } finally { h.dom.window.close(); }
});

test('vacancy workspace loading keeps Ripple through the request and sidebar usable', async () => {
  let releaseReady, releaseNavigate;
  const h = bootPortal({
    url: 'https://jobs.garyhome.vn/portal.html?access=staff&view=cms',
    caps: {read: true},
    collections: [{kind: 'vacancy'}, {kind: 'employer'}],
    mountCms(root) {
      root.innerHTML = '<p data-cms>Vacancy table</p>';
      return {
        ready: new Promise(resolve => { releaseReady = resolve; }),
        navigate() { return new Promise(resolve => { releaseNavigate = () => resolve(true); }); },
        navigationState: () => ({kind: 'vacancy', view: 'content'}),
        canLeave: () => true,
        destroy() {},
        setLanguage() {}
      };
    }
  });
  try {
    const slot = await whenSlot(h.doc, '[data-lattice-hold]');
    assert.ok(h.doc.querySelector('[data-cms]'));
    const loader = await reveal(h.doc, 'ripple', 4);
    assert.ok(slot.contains(loader));
    assert.match(loader.textContent, /Loading vacancies…/);
    assert.equal(h.doc.getElementById('lattice-navigation'), null);
    const employer = h.doc.querySelector('[data-collection="employer"]');
    assert.equal(employer.disabled, false);
    assert.equal(employer.closest('[hidden]'), null);
    releaseReady();
    await wait(30);
    assert.equal(h.doc.querySelector('.lattice-loader'), null);
    assert.ok(h.doc.querySelector('[data-cms]'));
    click(employer, h.w);
    await whenSlot(h.doc, '[data-lattice-hold]');
    const next = await reveal(h.doc, 'ripple', 4);
    assert.match(next.textContent, /Loading content…/);
    assert.equal(employer.closest('[hidden]'), null);
    releaseNavigate();
    await wait(30);
    assert.equal(h.doc.querySelector('.lattice-loader'), null);
    click(h.doc.querySelector('[data-collection="vacancy"]'), h.w);
    await whenSlot(h.doc, '[data-lattice-hold]');
    const vacancy = await reveal(h.doc, 'ripple', 4);
    assert.match(vacancy.textContent, /Loading vacancies…/);
    assert.equal(h.doc.querySelectorAll('.lattice-loader').length, 1);
    releaseNavigate();
    await wait(30);
    assert.equal(h.doc.querySelector('.lattice-loader'), null);
    assert.ok(h.doc.querySelector('[data-cms]'));
  } finally { h.dom.window.close(); }
});

test('a fast workspace request stays silent and an unassigned staff account has no loader', async () => {
  const fast = bootPortal({
    url: 'https://jobs.garyhome.vn/portal.html?access=staff&view=cms',
    caps: {read: true},
    collections: [{kind: 'vacancy'}],
    mountCms(root) {
      root.innerHTML = '<p data-cms>Vacancy table</p>';
      return {ready: new Promise(resolve => setTimeout(resolve, 20)), canLeave: () => true, destroy() {}, setLanguage() {}, navigationState: () => ({kind: 'vacancy', view: 'content'})};
    }
  });
  try {
    await wait(180);
    assert.equal(fast.doc.querySelector('.lattice-loader'), null);
    assert.match(fast.doc.querySelector('#workspace-view').textContent, /Vacancy table/);
  } finally { fast.dom.window.close(); }

  const denied = bootPortal({url: 'https://jobs.garyhome.vn/portal.html?access=staff&view=cms', caps: {}});
  try {
    await wait(250);
    assert.equal(denied.doc.querySelector('.lattice-loader'), null);
    assert.match(denied.doc.querySelector('#workspace-view').textContent, /Staff access not assigned/);
  } finally { denied.dom.window.close(); }
});

test('staff, talent, and in-portal vacancy fetches show one Ripple until they settle', async () => {
  let releaseStaff;
  const staff = bootPortal({
    url: 'https://jobs.garyhome.vn/portal.html?access=staff&view=staff',
    caps: {read: true, manage_staff: true},
    mountStaffManagement(root) {
      root.innerHTML = '<p>Loading staff…</p><h1>Staff management</h1>';
      return {ready: new Promise(resolve => { releaseStaff = resolve; }), destroy() {}, setLanguage() {}};
    }
  });
  try {
    await whenSlot(staff.doc, '[data-lattice-hold]');
    const loader = await reveal(staff.doc, 'ripple', 4);
    assert.match(loader.textContent, /Loading staff access…/);
    assert.match(staff.doc.querySelector('#workspace-view').textContent, /Staff management/);
    assert.equal(staff.doc.getElementById('jobs-staff-sidebar').closest('[hidden]'), null);
    releaseStaff();
    await wait(30);
    assert.equal(staff.doc.querySelector('.lattice-loader'), null);
    assert.match(staff.doc.querySelector('#workspace-view').textContent, /Staff management/);
  } finally { staff.dom.window.close(); }

  let releaseTalent;
  const talent = bootPortal({
    url: 'https://jobs.garyhome.vn/portal.html?access=staff&view=talent',
    caps: {recruit: true},
    mountTalentPool(root) {
      root.innerHTML = '<h1 id="talent-title">Talent</h1>';
      return {ready: new Promise(resolve => { releaseTalent = resolve; }), canLeave: () => true, destroy() {}, setLanguage() {}};
    }
  });
  try {
    await whenSlot(talent.doc, '[data-lattice-hold]');
    const loader = await reveal(talent.doc, 'ripple', 4);
    assert.match(loader.textContent, /Loading candidates…/);
    assert.ok(talent.doc.querySelector('#talent-title'));
    releaseTalent();
    await wait(30);
    assert.equal(talent.doc.querySelector('.lattice-loader'), null);
    assert.ok(talent.doc.querySelector('#talent-title'));
  } finally { talent.dom.window.close(); }

  const queries = [];
  const apply = bootPortal({
    url: 'https://jobs.garyhome.vn/portal.html?access=candidate&view=apply&vacancy=job-1',
    from: () => ({select() { return this; }, eq() { return this; }, maybeSingle: () => new Promise(resolve => queries.push(resolve))})
  });
  try {
    await whenSlot(apply.doc, '[data-lattice-hold]');
    const loader = await reveal(apply.doc, 'ripple', 4);
    assert.match(loader.textContent, /Loading vacancy…/);
    assert.equal(apply.doc.querySelector('#persistent-application'), null);
    assert.equal(apply.doc.getElementById('lattice-navigation'), null);
    queries[0]({data: {id: 'job-1', title_en: 'Science teacher', title_vi: 'Giáo viên khoa học'}});
    await wait(20);
    assert.ok(apply.doc.querySelector('.lattice-loader'));
    queries[1]({data: {full_name: 'Ada'}});
    await wait(30);
    assert.equal(apply.doc.querySelector('.lattice-loader'), null);
    assert.match(apply.doc.querySelector('#workspace-view').textContent, /Science teacher/);
  } finally { apply.dom.window.close(); }

  let releaseClosed;
  const closed = bootPortal({
    url: 'https://jobs.garyhome.vn/portal.html?access=candidate&view=apply&vacancy=missing',
    from: () => ({select() { return this; }, eq() { return this; }, maybeSingle: () => new Promise(resolve => { releaseClosed = () => resolve({data: null}); })})
  });
  try {
    await whenSlot(closed.doc, '[data-lattice-hold]');
    await reveal(closed.doc, 'ripple', 4);
    releaseClosed();
    await wait(30);
    assert.equal(closed.doc.querySelector('.lattice-loader'), null);
    assert.match(closed.doc.querySelector('#workspace-view').textContent, /closed or unavailable/);
    assert.equal(closed.doc.querySelector('#persistent-application'), null);
  } finally { closed.dom.window.close(); }
});
