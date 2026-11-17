import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { vacancyCard, vacancySlug, escapeText, safeLink } from '../dist/jobs-public-content.js';
const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
const init = await readFile(new URL('../dist/jobs-theme-init.js', import.meta.url), 'utf8');
const app = (await readFile(new URL('../dist/app.js', import.meta.url), 'utf8')).split('\n').filter(line => !line.startsWith('import ')).join('\n');
const css = await readFile(new URL('../dist/jobs-public-theme.css', import.meta.url), 'utf8');
async function moduleFor(entry, globals = {}) {
  const bundle = await build({ entryPoints: [entry], bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external', loader: { '.css': 'empty' }, jsx: 'automatic' });
  const module = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require: createRequire(import.meta.url), process, console, ...globals });
  return module.exports;
}
function preferences({ dark = false, stored } = {}) {
  const dom = new JSDOM(html, { url: 'https://jobs.garyhome.vn/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window; const query = { matches: dark, listeners: [], addEventListener(_, fn) { this.listeners.push(fn); } };
  w.matchMedia = () => query;
  if (stored) w.localStorage.setItem('gary-jobs-theme', stored);
  w.eval(init); return { dom, w, d: w.document, query };
}
async function page(options) {
  const h = preferences(options), { w } = h;
  w.IntersectionObserver = class { observe() {} disconnect() {} };
  w.HTMLElement.prototype.scrollIntoView = function() {};
  w.scrollTo = () => {};
  w.HTMLDialogElement.prototype.showModal = function() { this.open = true; };
  w.HTMLDialogElement.prototype.close = function() { this.open = false; };
  Object.assign(w, { mountGaryApps: () => ({ unmount() {} }), mountPhotoGallery: () => ({ unmount() {} }), mountGlassHero: () => ({ unmount() {}, update() {} }), vacancyCard, vacancySlug, escapeText, safeLink, publicContent: async () => [] });
  vm.runInContext(app, h.dom.getInternalVMContext());
  await new Promise(resolve => setTimeout(resolve, 10)); return h;
}

test('actual GlassIcons retains six layered plates and exported optical and press settings', async () => {
  const { default: GlassIcons } = await moduleFor('src/components/react-bits/GlassIcons.tsx');
  const { glassHeroItems, glassHeroSettings } = await moduleFor('src/components/GlassHero.jsx');
  assert.deepEqual(JSON.parse(JSON.stringify(glassHeroSettings)), { roundness:.6,refraction:.8,bevel:.6,dispersion:0,frost:.2,shine:.85,tint:'#dfdfdf',tintOpacity:.2,plate:'tilt',tilt:30,spread:.5,parallax:1,hover:'press',labels:'hover',intro:true });
  for (const key of ['size','gap','columns']) assert.equal(key in glassHeroSettings, false, `${key} is measured, not fixed in the optical preset`);
  const items = glassHeroItems('en');
  assert.deepEqual(Array.from(items, item => item.color), ['blue','purple','red','indigo','orange','green']);
  const markup = renderToStaticMarkup(React.createElement(GlassIcons, { ...glassHeroSettings, size:104, gap:72, rowGap:180, columns:3, items, theme:'light', iconColor:'#102d58' }));
  const dom = new JSDOM(markup), d = dom.window.document;
  assert.equal(d.querySelectorAll('.glass-icon-plate--tilt').length, 6);
  assert.equal(d.querySelectorAll('.glass-icon-glass').length, 6);
  assert.equal(d.querySelectorAll('.glass-icon-face svg').length, 6);
  assert.ok(d.querySelector('.glass-icons--labels-hover'));
  assert.equal(d.querySelectorAll('a[aria-label]').length, 6);
  assert.match(d.querySelector('.glass-icons').getAttribute('style'), /--glass-icons-ink:#102d58/);
  assert.equal(d.querySelector('.glass-icons').style.getPropertyValue('--glass-icons-size'), '104px');
  assert.equal(d.querySelector('.glass-icons').style.getPropertyValue('--glass-icons-row-gap'), '180px');
  dom.window.close();
});

test('all six icon destinations are existing meaningful sections or the real Visa site', async () => {
  const { glassHeroItems } = await moduleFor('src/components/GlassHero.jsx');
  const h = await page();
  for (const locale of ['en','vi']) {
    const items = glassHeroItems(locale);
    for (const item of items) {
      assert.ok(item.label.length > 0);
      if (item.href.startsWith('#')) assert.ok(h.d.querySelector(item.href), item.href);
      else assert.equal(item.href, 'https://visa.garyhome.vn/');
    }
  }
  assert.equal(glassHeroItems('en', '#published-guides')[1].href, '#published-guides');
  h.dom.window.close();
});

test('theme initializes before CSS, follows System, and persists explicit choices independently', () => {
  assert.ok(html.indexOf('jobs-theme-init.js') < html.indexOf('href="styles.css"'));
  const h = preferences({ dark:true });
  assert.equal(h.d.documentElement.dataset.jobsTheme, 'dark');
  h.query.matches = false; h.query.listeners.forEach(listener => listener());
  assert.equal(h.d.documentElement.dataset.jobsTheme, 'light');
  h.w.setGaryJobsTheme('dark'); assert.equal(h.w.localStorage.getItem('gary-jobs-theme'), 'dark');
  assert.equal(h.w.localStorage.getItem('gary-visa-theme'), null);
  assert.equal(h.w.localStorage.getItem('gary-home-theme'), null);
  h.dom.window.close();
});

test('theme and bilingual controls preserve the functional search and six-link hub', async () => {
  const h = await page(), {d,w} = h;
  d.querySelector('#keyword').value='science';
  d.querySelector('[data-jobs-theme-choice=dark]').click();
  assert.equal(d.documentElement.dataset.jobsTheme,'dark');
  assert.match(d.querySelector('#hero-title').textContent,/Build your career/);
  assert.equal(d.querySelector('#keyword').value,'science');
  d.querySelector('[data-language=vi]').click();
  assert.equal(d.documentElement.lang,'vi');assert.match(d.querySelector('#hero-title').textContent,/Phát triển sự nghiệp/);
  assert.equal(d.querySelector('#keyword').value,'science');
  assert.equal(d.querySelector('[data-jobs-theme-choice=dark]').getAttribute('aria-pressed'),'true');
  assert.equal(d.querySelectorAll('#job-search').length,1);
  assert.equal(d.querySelectorAll('#jobs-glass-hero a').length,6);
  assert.equal(d.querySelector('.jobs-logo-light').getAttribute('src'),'assets/teaching-jobs-logo-light.svg');
  assert.equal(d.querySelector('.jobs-logo-dark').getAttribute('src'),'assets/teaching-jobs-logo-dark.svg');
  assert.equal(d.querySelectorAll('.hero-trust li').length,3);
  h.dom.window.close();
});

test('desktop tooltips stay conditional; touch labels, square search and reduced motion are explicit', async () => {
  const sourceCss=await readFile(new URL('../src/components/react-bits/GlassIcons.css',import.meta.url),'utf8');
  assert.match(sourceCss,/glass-icons--labels-hover \.glass-icon-label\s*\{\s*opacity: 0/);
  assert.match(sourceCss,/:focus-visible \.glass-icon-label/);
  assert.match(css,/@media\(hover:none\)/);
  assert.match(css,/border-radius:0 2px 2px 0/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
});


test('actual glass mount keeps one rendering context request through theme and locale updates and cleans up', async () => {
  const dom = new JSDOM('<div id="hub"></div>', { url:'https://jobs.garyhome.vn/', pretendToBeVisual:true });
  const w=dom.window, saved={window:globalThis.window,document:globalThis.document,act:globalThis.IS_REACT_ACT_ENVIRONMENT};
  let contextRequests=0;
  w.HTMLCanvasElement.prototype.getContext=function(type){if(type==='webgl2')contextRequests++;return null};
  w.matchMedia=query=>({matches:query.includes('reduced-motion'),addEventListener(){},removeEventListener(){}});
  const IO=class{constructor(callback){this.callback=callback}observe(){this.callback([{isIntersecting:true}])}disconnect(){}};
  const RO=class{observe(){}disconnect(){}};
  Object.assign(globalThis,{window:w,document:w.document,IS_REACT_ACT_ENVIRONMENT:true});
  try{
    const {mountGlassHero}=await moduleFor('src/components/GlassHero.jsx',{window:w,document:w.document,IntersectionObserver:IO,ResizeObserver:RO,requestAnimationFrame:w.requestAnimationFrame.bind(w),cancelAnimationFrame:w.cancelAnimationFrame.bind(w),performance:w.performance});
    const host=w.document.querySelector('#hub');let mount;
    Object.defineProperties(host,{clientWidth:{get:()=>600},clientHeight:{get:()=>640}});
    host.getBoundingClientRect=()=>({width:600,height:640,left:0,top:0,right:600,bottom:640,x:0,y:0});
    await React.act(async()=>{mount=mountGlassHero(host)});
    assert.equal(host.querySelectorAll('.glass-icon-plate--tilt').length,6);
    assert.equal(contextRequests,1);
    await React.act(async()=>{w.document.documentElement.dataset.jobsTheme='dark';w.document.dispatchEvent(new w.CustomEvent('gary-jobs:theme'));mount.update({locale:'vi'});});
    assert.equal(contextRequests,1);
    assert.equal(host.querySelector('.glass-icons').style.getPropertyValue('--glass-icons-ink').trim(),'#ffffff');
    assert.equal(host.querySelector('a').getAttribute('aria-label'),'Tìm việc');
    await React.act(async()=>{mount.unmount();mount.unmount();});assert.equal(host.children.length,0);
    await new Promise(resolve=>setTimeout(resolve,0));
  }finally{
    if(saved.window===undefined)delete globalThis.window;else globalThis.window=saved.window;
    if(saved.document===undefined)delete globalThis.document;else globalThis.document=saved.document;
    if(saved.act===undefined)delete globalThis.IS_REACT_ACT_ENVIRONMENT;else globalThis.IS_REACT_ACT_ENVIRONMENT=saved.act;
    dom.window.close();
  }
});


test('icon-only search keeps its translated accessible name without laying out the text label', async () => {
  const h=await page(),{d,w}=h;
  try{
    const styles=d.createElement('style');styles.textContent=css;d.head.append(styles);
    const button=d.querySelector('.search-button'),text=button.querySelector('.sr-only');
    assert.equal(button.getAttribute('aria-label'),'Find teaching roles');
    assert.equal(w.getComputedStyle(text).position,'absolute');
    assert.equal(w.getComputedStyle(text).width,'1px');
    assert.equal(w.getComputedStyle(text).clipPath,'inset(50%)');
    assert.equal(w.getComputedStyle(button).justifyContent,'center');
    assert.equal(w.getComputedStyle(button).gap,'0');
    d.querySelector('[data-language=vi]').click();
    assert.equal(d.querySelector('.search-button').getAttribute('aria-label'),'Tìm việc giảng dạy');
    assert.equal(d.querySelector('.search-button .sr-only').textContent,'Tìm việc giảng dạy');
  }finally{h.dom.window.close();}
});
