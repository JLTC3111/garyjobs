import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { glassHeroEnvelope as e, measureGlassHeroLayout } from '../src/components/glass-hero-layout.js';

async function moduleFor(entry, globals = {}, extra = '') {
  const file = resolve(entry);
  const source = extra ? { stdin: { contents: await readFile(file, 'utf8') + '\n' + extra, resolveDir: dirname(file), sourcefile: file, loader: 'tsx' } } : { entryPoints: [file] };
  const bundle = await build({ ...source, bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external', loader: { '.css': 'empty' }, jsx: 'automatic' });
  const module = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require: createRequire(import.meta.url), process, console, ...globals });
  return module.exports;
}

function assertSafe(layout, width, height) {
  assert.ok(layout, `${width}×${height} must fit`);
  const { size, gap, rowGap, padding: p, columns, rows, labelWidth, labelOffset, labelTail, gridWidth, gridHeight, frameWidth, frameHeight } = layout;
  assert.equal(columns * rows, 6);
  assert.ok(size >= 44);
  assert.ok(frameWidth <= width && frameHeight <= height);
  assert.ok(gridWidth + p.left + p.right <= frameWidth + 0.01);
  assert.ok(gridHeight + p.top + p.bottom <= frameHeight + 0.01);
  // Original plate/parallax bounds, focus breathing and two-line tooltip tail.
  assert.ok(p.left >= e.left * size + e.breathing - 0.02);
  assert.ok(p.right >= e.right * size + e.breathing - 0.02);
  assert.ok(p.top >= e.top * size + e.breathing - 0.02);
  assert.equal(labelTail, labelOffset + e.labelHeight);
  assert.ok(labelOffset >= e.introFaceShift * size + e.focusReach + 2);
  assert.ok(p.bottom >= labelTail + e.breathing);
  assert.ok(gap >= (e.right + e.left) * size + e.breathing - 0.02, 'independent rear plates must not collide at opposing parallax extremes');
  assert.ok(gap + size >= labelWidth + e.breathing - 0.02, 'simultaneous touch labels must not overlap');
  assert.ok(rowGap >= e.top * size + labelTail + e.breathing - 0.02, 'labels must clear the next tilted plate');
  assert.ok(p.left + size / 2 - labelWidth / 2 >= e.breathing - 0.02);
  assert.ok(p.right + size / 2 - labelWidth / 2 >= e.breathing - 0.02);
}

test('wide desktop sizing derives from both dimensions and distributes the grid through eighty percent of the column', () => {
  const desktop = measureGlassHeroLayout(604, 630);
  assertSafe(desktop, 604, 630);
  assert.ok(desktop.size >= 96 && desktop.size <= 112);
  assert.ok(desktop.heightRatio >= 0.75 && desktop.heightRatio <= 0.85);
  assert.equal(desktop.columns, 3);
  const wider = measureGlassHeroLayout(700, 690);
  const shorter = measureGlassHeroLayout(604, 480);
  assert.ok(wider.size > desktop.size, 'the initial target is not a hard-coded maximum');
  assert.ok(shorter.size < desktop.size, 'height constrains geometry instead of clipping it');
  assert.notEqual(desktop.rowGap, desktop.gap, 'rows fill available height independently');
});

test('laptop/tablet/mobile resize matrix keeps all plate, focus and touch-label envelopes inside the measured box', () => {
  for (const width of [232, 270, 280, 320, 342, 390, 419, 420, 480, 560, 604, 640, 700, 900]) {
    for (const height of [440, 480, 560, 630, 690]) {
      const layout = measureGlassHeroLayout(width, height);
      assertSafe(layout, width, height);
      assert.equal(layout.columns, width < 420 ? 2 : 3);
      if (width >= 420) assert.ok(layout.heightRatio >= 0.75 && layout.heightRatio <= 0.85);
    }
  }
  assert.equal(measureGlassHeroLayout(0, 500), null);
  assert.equal(measureGlassHeroLayout(500, 0), null);
  assert.equal(measureGlassHeroLayout(100, 120), null, 'do not shrink six controls below usable target size');
  assert.equal(measureGlassHeroLayout(NaN, 500), null);
});

test('actual intro corner rotation, opposing parallax and moving focus outlines cannot overlap neighboring plates or labels', () => {
  const bounds = (size, degrees, shift) => {
    const angle = degrees * Math.PI / 180;
    const points = [[0, 0], [size, 0], [size, size], [0, size]].map(([x, y]) => size + (x - size) * Math.cos(angle) - (y - size) * Math.sin(angle) + shift);
    return { min: Math.min(...points), max: Math.max(...points) };
  };
  for (const [width, height] of [[420, 480], [560, 620], [604, 630], [700, 690], [342, 486]]) {
    const { size, gap, labelOffset } = measureGlassHeroLayout(width, height);
    for (const previousAngle of [0, 5, 15, 25, 30]) for (const nextAngle of [0, 5, 15, 25, 30]) {
      const previous = bounds(size, previousAngle, size * 0.07);
      const next = bounds(size, nextAngle, -size * 0.07);
      assert.ok(previous.max + 8 <= size + gap + next.min + 0.02, `${width}×${height}: ${previousAngle}°/ ${nextAngle}°`);
    }
    for (const enter of [0, 0.1, 0.3, 0.35, 0.6, 0.85, 1]) {
      const progress = Math.min(1, Math.max(0, (enter - 0.25) / 0.75));
      const glyphRise = Math.pow(1 - progress, 3) * 0.1 * size;
      assert.ok(glyphRise + 6 + 2 <= labelOffset, 'intro focus outline has at least two pixels before the label');
    }
  }
});

test('upstream rowGap extension preserves original defaults and all six layered, accessible destinations', async () => {
  const { default: GlassIcons } = await moduleFor('src/components/react-bits/GlassIcons.tsx');
  const { glassHeroItems, glassHeroSettings } = await moduleFor('src/components/GlassHero.jsx');
  assert.equal('size' in glassHeroSettings, false);
  assert.equal('gap' in glassHeroSettings, false);
  const items = glassHeroItems('vi');
  for (const [extra, expected] of [[{ rowGap: 150 }, '150px'], [{}, '70px'], [{ labels: 'always' }, '96px']]) {
    const dom = new JSDOM(renderToStaticMarkup(React.createElement(GlassIcons, { ...glassHeroSettings, items, size: 100, gap: 70, columns: 3, ...extra })));
    const d = dom.window.document;
    assert.equal(d.querySelector('.glass-icons').style.getPropertyValue('--glass-icons-row-gap'), expected);
    assert.equal(d.querySelectorAll('.glass-icon-plate--tilt').length, 6);
    assert.equal(d.querySelectorAll('.glass-icon-glass').length, 6);
    assert.equal(d.querySelectorAll('a[aria-label]').length, 6);
    dom.window.close();
  }
});

test('actual observed resize changes rows, sizes and spacing without another WebGL context or losing theme/locale links', async () => {
  const dom = new JSDOM('<div id="hub"></div>', { url: 'https://jobs.garyhome.vn/', pretendToBeVisual: true });
  const w = dom.window, saved = { window: globalThis.window, document: globalThis.document, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  const observers = [], frames = new Map();
  let width = 0, height = 0, request = 0, stamp = 1000, contextRequests = 0;
  w.requestAnimationFrame = callback => { const id = ++request; frames.set(id, callback); return id; };
  w.cancelAnimationFrame = id => frames.delete(id);
  w.HTMLCanvasElement.prototype.getContext = function(type) { if (type === 'webgl2') contextRequests++; return null; };
  w.matchMedia = query => ({ matches: query.includes('reduced-motion'), addEventListener() {}, removeEventListener() {} });
  const RO = class { constructor(callback) { this.callback = callback; observers.push(this); } observe(target) { this.target = target; } disconnect() { this.disconnected = true; } };
  const IO = class { constructor(callback) { this.callback = callback; } observe() { this.callback([{ isIntersecting: true }]); } disconnect() {} };
  Object.assign(globalThis, { window: w, document: w.document, IS_REACT_ACT_ENVIRONMENT: true });
  try {
    const { mountGlassHero } = await moduleFor('src/components/GlassHero.jsx', { window: w, document: w.document, ResizeObserver: RO, IntersectionObserver: IO, requestAnimationFrame: w.requestAnimationFrame, cancelAnimationFrame: w.cancelAnimationFrame, performance: w.performance });
    const host = w.document.getElementById('hub');
    host.getBoundingClientRect = () => ({ width, height, top: 0, left: 0, right: width, bottom: height });
    let mount;
    await React.act(async () => { mount = mountGlassHero(host); });
    assert.equal(contextRequests, 0, 'a hidden/unmeasured box must not allocate WebGL');
    assert.equal(host.querySelectorAll('a').length, 6);
    const observer = observers.find(item => item.target === host);
    async function flush() {
      await React.act(async () => {
        const pending = [...frames.values()]; frames.clear(); stamp += 1000;
        pending.forEach(callback => callback(stamp));
      });
    }
    async function resize(nextWidth, nextHeight) {
      width = nextWidth; height = nextHeight;
      await React.act(async () => { observer.callback(); observer.callback(); w.dispatchEvent(new w.Event('resize')); });
      await flush();
      return host.querySelector('.jobs-glass-frame');
    }
    let frame = await resize(604, 630);
    assert.equal(contextRequests, 1);
    assert.equal(frame.dataset.glassColumns, '3');
    const initialSize = Number(frame.dataset.glassSize);
    const firstIcon = host.querySelector('[data-glass-icon]');
    firstIcon.focus();
    frame = await resize(342, 486);
    assert.equal(frame.dataset.glassColumns, '2');
    assert.ok(Number(frame.dataset.glassSize) < initialSize);
    assert.equal(w.document.activeElement, firstIcon, 'resize must retain native keyboard focus');
    assert.equal(contextRequests, 1);
    frame = await resize(700, 690);
    assert.equal(frame.dataset.glassColumns, '3');
    assert.ok(Number(frame.dataset.glassSize) > initialSize);
    await React.act(async () => {
      w.document.documentElement.dataset.jobsTheme = 'dark';
      w.document.dispatchEvent(new w.CustomEvent('gary-jobs:theme'));
      mount.update({ locale: 'vi' });
    });
    assert.equal(contextRequests, 1);
    assert.equal(host.querySelector('a').getAttribute('aria-label'), 'Tìm việc');
    assert.equal(host.querySelector('.glass-icons').style.getPropertyValue('--glass-icons-ink'), '#ffffff');
    assert.equal(host.querySelectorAll('.glass-icon-plate--tilt').length, 6);
    await React.act(async () => { observer.callback(); mount.unmount(); mount.unmount(); });
    assert.equal(host.children.length, 0);
    assert.equal(frames.size, 0, 'both pending host measurement and renderer animation are cancelled');
    assert.ok(observers.every(item => item.disconnected));
  } finally {
    for (const [key, value] of Object.entries({ window: saved.window, document: saved.document, IS_REACT_ACT_ENVIRONMENT: saved.act })) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
    dom.window.close();
  }
});

test('actual optical-map cache stays bounded during many icon sizes and retains recently reused maps', async () => {
  let allocations = 0;
  const document = { createElement() {
    const id = ++allocations;
    return { getContext: () => ({ createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }), putImageData() {} }), toDataURL: () => `data:image/png,${id}` };
  } };
  const { inspectBuildMaps: mapsFor, inspectMaps: cache } = await moduleFor('src/components/react-bits/GlassIcons.tsx', { document }, 'export { buildMaps as inspectBuildMaps, MAPS as inspectMaps };');
  for (let size = 24; size < 54; size++) mapsFor(size, 5, 3);
  assert.equal(cache.size, 16);
  assert.equal(cache.has('24:5:3'), false);
  const recent = mapsFor(38, 5, 3), before = allocations;
  assert.equal(mapsFor(38, 5, 3), recent);
  assert.equal(allocations, before);
  mapsFor(54, 5, 3);
  assert.equal(cache.size, 16);
  assert.equal(cache.has('38:5:3'), true);
  assert.equal(cache.has('39:5:3'), false);
});
