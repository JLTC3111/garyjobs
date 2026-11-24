import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
import {showDelayedLattice, bindDocumentNavigation, LATTICE_REVEAL_MS} from '../dist/lattice-loader.js';

const visaRoot = new URL('../../../gary_visa_service/website/dist/', import.meta.url);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test('monochrome lattice assets match Gary Visa', () => {
  const css = fs.readFileSync(new URL('../dist/lattice-loader.css', import.meta.url), 'utf8');
  const js = fs.readFileSync(new URL('../dist/lattice-loader.js', import.meta.url), 'utf8');
  assert.match(css, /--ll-color:\s*#111111/);
  assert.match(css, /--ll-color:\s*#ffffff/);
  assert.match(css, /prefers-reduced-motion:\s*reduce[\s\S]*animation:\s*none!important/);
  assert.doesNotMatch(css, /#22c55e|#ef4444|gradient|lavender/i);
  assert.equal(css, fs.readFileSync(new URL('lattice-loader.css', visaRoot), 'utf8'));
  assert.equal(js, fs.readFileSync(new URL('lattice-loader.js', visaRoot), 'utf8'));
});

test('workspace and connection patterns use the same delayed reveal', async () => {
  const dom = new JSDOM('<div id="ripple"></div>');
  const slot = dom.window.document.getElementById('ripple');
  const stop = showDelayedLattice(slot, {pattern: 'ripple', grid: 4, label: 'Đang tải hồ sơ…', status: true});
  assert.equal(slot.querySelector('.lattice-loader'), null);
  assert.equal(LATTICE_REVEAL_MS, 200);
  stop();
  await wait(LATTICE_REVEAL_MS + 30);
  assert.equal(slot.querySelector('.lattice-loader'), null);
  assert.equal(bindDocumentNavigation(dom.window.document), undefined);
  dom.window.close();
});
