import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/gary-apps/client.js', import.meta.url), 'utf8');
const manifestUrl = 'https://garyhome.vn/shared/gary-apps/v1/manifest.json';
const hashA = '0123456789abcdef';
const hashB = 'fedcba9876543210';
const manifest = release => ({ schemaVersion: 1, release, module: `./runtime.${release}.js`, stylesheet: `./styles.${release}.css` });
const settle = () => new Promise(resolve => setTimeout(resolve, 15));

class Element extends EventTarget {
  constructor(document, tagName) { super(); this.ownerDocument = document; this.tagName = tagName; this.children = []; this.style = {}; this.dataset = {}; }
  append(...children) {
    for (const child of children) {
      child.parentElement = this;
      this.children.push(child);
      if (this.tagName === 'head' && child.tagName === 'link') queueMicrotask(() => child.onload?.());
    }
  }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; }
  querySelector(selector) { return selector === 'details[open]' && this.openMenu ? {} : null; }
  contains(node) { return node != null && (node === this || this.children.some(child => child.contains(node))); }
}
class Document extends EventTarget {
  constructor() { super(); this.baseURI = 'https://jobs.garyhome.vn/'; this.visibilityState = 'visible'; this.head = this.createElement('head'); this.activeElement = null; this.visibilityListeners = 0; }
  createElement(tagName) { return new Element(this, tagName); }
  addEventListener(name, callback, options) { super.addEventListener(name, callback, options); if (name === 'visibilitychange') this.visibilityListeners++; }
  removeEventListener(name, callback, options) { super.removeEventListener(name, callback, options); if (name === 'visibilitychange') this.visibilityListeners--; }
  refresh() { this.dispatchEvent(new Event('visibilitychange')); }
}
async function setup({ fetchManifest, loadModule } = {}) {
  const document = new Document();
  const calls = { fetch: [], imports: [], mounts: [], unmounts: [], updates: [] };
  globalThis.fetch = async (url, options) => {
    calls.fetch.push({ url, options });
    return { ok: true, json: async () => fetchManifest ? fetchManifest() : manifest(hashA) };
  };
  globalThis.__garyAppsImport = async url => {
    calls.imports.push(url);
    if (loadModule) return loadModule(url, calls);
    return { mount(target, props) {
      const entry = { target, props, url };
      calls.mounts.push(entry);
      return { update: next => calls.updates.push(next), unmount: () => calls.unmounts.push(entry) };
    } };
  };
  const instrumented = source.replace('import(/* webpackIgnore: true */ /* @vite-ignore */ manifest.module)', 'globalThis.__garyAppsImport(manifest.module)') + `\n// isolate ${Math.random()}`;
  const { connectGaryApps } = await import(`data:text/javascript;base64,${Buffer.from(instrumented).toString('base64')}`);
  return { document, calls, connect: (target, props = {}, options = {}) => connectGaryApps(target, { kind: 'menu', currentApp: 'jobs', language: 'en', ...props }, options) };
}

test('deduplicates remote assets, strips framework renderers and releases shared resources after last unmount', async () => {
  const env = await setup();
  const first = env.document.createElement('div'), second = env.document.createElement('div');
  let ready = 0;
  const a = env.connect(first, { renderLink() {} }, { onReady: () => ready++ });
  const b = env.connect(second);
  try {
    await settle();
    assert.equal(env.calls.fetch.length, 1);
    assert.equal(env.calls.imports.length, 1);
    assert.equal(env.calls.mounts.length, 2);
    assert.equal(env.document.head.children.length, 1);
    assert.equal(first.dataset.garyRelease, hashA);
    assert.equal(ready, 1);
    assert.equal('renderLink' in env.calls.mounts[0].props, false);
    assert.equal(env.calls.fetch[0].options.credentials, 'omit');
    assert.equal(env.calls.fetch[0].options.cache, 'no-store');
    a.update({ language: 'vi' });
    assert.equal(env.calls.updates.at(-1).language, 'vi');
    a.unmount();
    assert.equal(env.document.head.children.length, 1);
    b.unmount();
    assert.equal(env.document.head.children.length, 0);
    assert.equal(env.document.visibilityListeners, 0);
  } finally { a.unmount(); b.unmount(); }
});

test('defers initial replacement while host fallback is busy, then upgrades after it closes', async () => {
  const env = await setup();
  const target = env.document.createElement('div');
  let hostBusy = true;
  const handle = env.connect(target, {}, { isBusy: () => hostBusy });
  try {
    await settle();
    assert.equal(env.calls.mounts.length, 0);
    hostBusy = false;
    target.dispatchEvent(new Event('toggle'));
    await settle();
    assert.equal(env.calls.mounts.length, 1);
  } finally { handle.unmount(); }
});

test('visibility refresh discovers new releases and waits for open or focused menus', async () => {
  let release = hashA;
  const env = await setup({ fetchManifest: () => manifest(release) });
  const target = env.document.createElement('div');
  const handle = env.connect(target);
  try {
    await settle();
    target.openMenu = true;
    release = hashB;
    env.document.refresh();
    await settle();
    assert.equal(target.dataset.garyRelease, hashA);
    assert.equal(env.calls.mounts.length, 1);
    target.openMenu = false;
    env.document.activeElement = target.children[0];
    target.dispatchEvent(new Event('toggle'));
    await settle();
    assert.equal(target.dataset.garyRelease, hashA);
    env.document.activeElement = null;
    target.dispatchEvent(new Event('focusout'));
    await settle();
    assert.equal(target.dataset.garyRelease, hashB);
    assert.equal(env.calls.mounts.length, 2);
    assert.equal(env.calls.unmounts.length, 1);
    assert.equal(env.document.head.children.length, 1);
  } finally { handle.unmount(); }
});

test('rejects manifest assets outside the release directory and preserves the mounted release', async () => {
  let invalid = false;
  const env = await setup({ fetchManifest: () => invalid ? { ...manifest(hashB), module: 'https://other.example/runtime.js' } : manifest(hashA) });
  const target = env.document.createElement('div');
  const errors = [];
  const handle = env.connect(target, {}, { onError: error => errors.push(error) });
  try {
    await settle();
    invalid = true;
    env.document.refresh();
    await settle();
    assert.equal(target.dataset.garyRelease, hashA);
    assert.equal(env.calls.unmounts.length, 0);
    assert.equal(env.calls.imports.length, 1);
    assert.match(errors.at(-1).message, /Invalid Gary Apps module/);
  } finally { handle.unmount(); }
});

test('retries transient failures without replacing a working component or fallback', async () => {
  let failing = true;
  const env = await setup({ fetchManifest: () => { if (failing) throw new Error('temporary outage'); return manifest(hashA); } });
  const target = env.document.createElement('div');
  const errors = [];
  const handle = env.connect(target, {}, { onError: error => errors.push(error) });
  try {
    await settle();
    assert.equal(env.calls.mounts.length, 0);
    assert.equal(errors.length, 1);
    failing = false;
    env.document.refresh();
    await settle();
    assert.equal(target.dataset.garyRelease, hashA);
  } finally { handle.unmount(); }
});

test('ignores late asset completion and cancels resources when unmounted during load', async () => {
  let finish;
  const env = await setup({ loadModule: () => new Promise(resolve => { finish = resolve; }) });
  const target = env.document.createElement('div');
  let ready = 0, mounted = 0;
  const handle = env.connect(target, {}, { onReady: () => ready++ });
  await settle();
  handle.unmount();
  finish({ mount() { mounted++; return { update() {}, unmount() {} }; } });
  await settle();
  assert.equal(mounted, 0);
  assert.equal(ready, 0);
  assert.equal(target.children.length, 0);
  assert.equal(env.document.head.children.length, 0);
  assert.equal(env.document.visibilityListeners, 0);
});

test('a broken new runtime keeps the previous release mounted and styled', async () => {
  let release = hashA;
  const env = await setup({
    fetchManifest: () => manifest(release),
    loadModule: (url, calls) => ({ mount(target, props) {
      if (url.includes(hashB)) throw new Error('new release failed to mount');
      calls.mounts.push({ target, props, url });
      return { update() {}, unmount: () => calls.unmounts.push(url) };
    } }),
  });
  const target = env.document.createElement('div');
  const errors = [];
  const handle = env.connect(target, {}, { onError: error => errors.push(error) });
  try {
    await settle();
    release = hashB;
    env.document.refresh();
    await settle();
    assert.equal(target.dataset.garyRelease, hashA);
    assert.equal(target.children.length, 1);
    assert.equal(env.calls.unmounts.length, 0);
    assert.equal(env.calls.mounts.length, 1);
    assert.match(errors.at(-1).message, /failed to mount/);
    assert.ok(env.document.head.children.some(link => link.dataset.garyAppsRelease === hashA));
  } finally { handle.unmount(); }
});

test('a rollback cancels a deferred upgrade before the user closes the active menu', async () => {
  let release = hashA;
  const env = await setup({ fetchManifest: () => manifest(release) });
  const target = env.document.createElement('div');
  const handle = env.connect(target);
  try {
    await settle();
    target.openMenu = true;
    release = hashB;
    env.document.refresh();
    await settle();
    assert.equal(target.dataset.garyRelease, hashA);
    assert.equal(env.document.head.children.length, 2);
    release = hashA;
    env.document.refresh();
    await settle();
    target.openMenu = false;
    target.dispatchEvent(new Event('toggle'));
    await settle();
    assert.equal(target.dataset.garyRelease, hashA);
    assert.equal(env.calls.mounts.length, 1);
    assert.equal(env.calls.unmounts.length, 0);
    assert.equal(env.document.head.children.length, 1);
  } finally { handle.unmount(); }
});

test('a failed render waits for a manifest refresh before retrying', async () => {
  let attempts = 0;
  const env = await setup({ loadModule: () => ({ mount() { attempts++; throw new Error('broken release'); } }) });
  const target = env.document.createElement('div');
  const handle = env.connect(target);
  try {
    await settle();
    assert.equal(attempts, 1);
    target.dispatchEvent(new Event('toggle'));
    handle.update({ language: 'vi' });
    await settle();
    assert.equal(attempts, 1);
    env.document.refresh();
    await settle();
    assert.equal(attempts, 2);
  } finally { handle.unmount(); }
});
