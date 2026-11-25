import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { vacancyCard, vacancySlug, escapeText, safeLink } from '../dist/jobs-public-content.js';
import * as jobsSeo from '../dist/jobs-seo.js';

const root = new URL('../dist/', import.meta.url);
const html = await readFile(new URL('index.html', root), 'utf8');
const init = await readFile(new URL('jobs-theme-init.js', root), 'utf8');
const beforeDump = process.env.JOBS_SECTION_BASELINE_DUMP === '1';
const dump = beforeDump || process.env.JOBS_SECTION_CURRENT_DUMP === '1';
const cssRoot = beforeDump ? new URL('file:///private/tmp/jobs-section-contrast-before/') : root;
const [base, theme, appSource] = await Promise.all(['styles.css', 'jobs-public-theme.css', 'app.js'].map(file => readFile(new URL(file, cssRoot), 'utf8')));
const app = appSource.split('\n').filter(line => !line.startsWith('import ')).join('\n');

async function page({ dark = false, stored = {}, locale = 'en' } = {}) {
  const dom = new JSDOM(html, { url: 'https://jobs.garyhome.vn/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window, media = { matches: dark, listeners: [], addEventListener(_, fn) { this.listeners.push(fn); } };
  w.matchMedia = () => media;
  w.IntersectionObserver = class { observe() {} disconnect() {} };
  w.HTMLElement.prototype.scrollIntoView = function() {};
  w.scrollTo = () => {};
  w.HTMLDialogElement.prototype.showModal = function() { this.open = true; };
  w.HTMLDialogElement.prototype.close = function() { this.open = false; };
  for (const [key, value] of Object.entries({ 'gary-language': JSON.stringify(locale), ...stored })) w.localStorage.setItem(key, value);
  Object.assign(w,jobsSeo);
 Object.assign(w, { mountGaryApps: () => ({ unmount() {} }), mountPhotoGallery: () => ({ unmount() {} }), mountGlassHero: () => ({ unmount() {}, update() {} }), vacancyCard, vacancySlug, escapeText, safeLink, publicContent: async () => [] });
  w.eval(init); vm.runInContext(app, dom.getInternalVMContext());
  await new Promise(resolve => setTimeout(resolve, 10));
  return { dom, w, d: w.document, media };
}

function split(value) {
  let depth = 0, start = 0; const out = [];
  for (let i = 0; i < value.length; i++) {
    if ('(['.includes(value[i])) depth++;
    if (')]'.includes(value[i])) depth--;
    if (value[i] === ',' && depth === 0) { out.push(value.slice(start, i).trim()); start = i + 1; }
  }
  out.push(value.slice(start).trim()); return out;
}
const compare = (a, b) => a.findIndex((value, i) => value !== b[i]) < 0 ? 0 : (() => { const i = a.findIndex((value, j) => value !== b[j]); return a[i] - b[i]; })();
function specificity(selector) {
  let extra = [0, 0, 0], plain = selector;
  for (;;) {
    const match = /:(is|where|not|has)\(/.exec(plain); if (!match) break;
    const start = match.index + match[0].length; let end = start, depth = 1;
    while (depth) { if (plain[end] === '(') depth++; if (plain[end] === ')') depth--; end++; }
    if (match[1] !== 'where') {
      const best = split(plain.slice(start, end - 1)).map(specificity).sort(compare).at(-1);
      extra = extra.map((x, i) => x + best[i]);
    }
    plain = plain.slice(0, match.index) + plain.slice(end);
  }
  const attrs = (plain.match(/\[[^\]]*\]/g) || []).length;
  plain = plain.replace(/\[[^\]]*\]/g, '').replace(/\([^)]*\)/g, '');
  const ids = (plain.match(/#[\w-]+/g) || []).length;
  const classes = (plain.match(/\.[\w-]+|(?<!:):(?!:)[\w-]+/g) || []).length;
  const pseudo = (plain.match(/::[\w-]+/g) || []).length;
  const tags = (plain.replace(/#[\w-]+|\.[\w-]+|::?[\w-]+/g, '').match(/(?:^|[\s>+~])\s*[a-zA-Z][\w-]*/g) || []).length;
  return [extra[0] + ids, extra[1] + classes + attrs, extra[2] + tags + pseudo];
}
const parse = text => {
  const dom = new JSDOM(`<style>${text}</style>`), sheet = dom.window.document.styleSheets[0];
  const rules = [...sheet.cssRules]; dom.window.close(); return rules;
};
const sheets = [...parse(base), ...parse(theme)];
function cascade(document, width, state = {}) {
  let order = 0; const rules = [];
  function walk(list) {
    for (const rule of list) {
      if (rule.cssRules) {
        const condition = rule.conditionText || '';
        if (/prefers-reduced-motion\s*:\s*reduce\b/.test(condition) && !state.reducedMotion) continue;
        if (/prefers-reduced-motion\s*:\s*no-preference/.test(condition) && state.reducedMotion) continue;
        if (/hover\s*:\s*none/.test(condition) && width > 720) continue;
        if ([...condition.matchAll(/(min|max)-width\s*:\s*([\d.]+)px/g)].some(([, kind, n]) => kind === 'min' ? width < +n : width > +n)) continue;
        walk(rule.cssRules); continue;
      }
      if (!rule.selectorText) continue;
      for (const selector of split(rule.selectorText)) {
        rules.push({ selector, score: specificity(selector), style: rule.style, order: order++ });
      }
    }
  }
  walk(sheets);
  const cache = new WeakMap(), variableCache = new WeakMap();
  function own(node) {
    if (cache.has(node)) return cache.get(node);
    const result = new Map();
    for (const rule of rules) {
      if (/::|:(?:before|after)\b/.test(rule.selector)) continue;
      const selector = rule.selector.replace(/:(hover|focus-visible|focus|active)\b/g, (_, pseudo) => state[pseudo]?.has(node) ? '' : ':not(*)');
      let matches = false; try { matches = node.matches(selector); } catch { continue; }
      if (!matches) continue;
      for (let i = 0; i < rule.style.length; i++) {
        const key = rule.style[i], important = rule.style.getPropertyPriority(key) ? 1 : 0;
        const score = [important, ...rule.score, rule.order];
        const old = result.get(key);
        if (!old || compare(score, old.score) >= 0) result.set(key, { value: rule.style.getPropertyValue(key).trim(), score });
      }
    }
    cache.set(node, result); return result;
  }
  function resolve(value, vars, stack = []) {
    for (;;) {
      const start = value.indexOf('var('); if (start < 0) return value;
      let end = start + 4, depth = 1;
      while (depth) { if (value[end] === '(') depth++; if (value[end] === ')') depth--; end++; }
      const [key, ...fallback] = split(value.slice(start + 4, end - 1));
      assert.ok(!stack.includes(key), `Cyclic color token ${key}`);
      const replacement = vars[key] ?? fallback.join(',');
      assert.ok(replacement !== undefined && replacement !== '', `Missing color role ${key}`);
      value = value.slice(0, start) + resolve(replacement, vars, [...stack, key]) + value.slice(end);
    }
  }
  function variables(node) {
    if (!node) return {};
    if (variableCache.has(node)) return variableCache.get(node);
    const inherited = variables(node.parentElement), values = { ...inherited };
    for (const [key, entry] of own(node)) if (key.startsWith('--')) values[key] = entry.value;
    const resolved = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, resolve(value, values, [key])]));
    variableCache.set(node, resolved); return resolved;
  }
  function value(node, property) {
    if (!node) return property === 'color' ? '#000000' : 'transparent';
    const keys = property === 'background' ? ['background', 'background-color'] : property === 'border-color' ? ['border', 'border-color'] : property === 'outline-color' ? ['outline', 'outline-color'] : [property];
    const entry = keys.map(key => own(node).get(key)).filter(Boolean).sort((a, b) => compare(a.score, b.score)).at(-1);
    if (!entry || /^(inherit|unset)$/.test(entry.value)) return property === 'color' ? value(node.parentElement, property) : 'transparent';
    let resolved = resolve(entry.value, variables(node));
    if (/currentcolor/i.test(resolved)) resolved = resolved.replace(/currentcolor/ig, property === 'color' ? value(node.parentElement, 'color') : value(node, 'color'));
    return resolved;
  }
  return { value, variables, own };
}

function rgba(value) {
  const hex = /^#([\da-f]{3,8})$/i.exec(value)?.[1];
  if (hex) {
    const full = hex.length <= 4 ? [...hex].map(x => x + x).join('') : hex;
    return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16)).concat(full.length === 8 ? parseInt(full.slice(6), 16) / 255 : 1);
  }
  if (value === 'white') return [255, 255, 255, 1];
  if (value === 'black') return [0, 0, 0, 1];
  if (value === 'transparent' || value === 'none') return [0, 0, 0, 0];
  const numbers = /^rgba?\(([^)]+)\)$/.exec(value)?.[1].split(/[,\s/]+/).map(Number);
  assert.ok(numbers?.length >= 3, `Expected resolved color, got ${value}`);
  return numbers.length === 3 ? [...numbers, 1] : numbers;
}
const blend = (a, b) => a.slice(0, 3).map((x, i) => x * a[3] + b[i] * (1 - a[3])).concat(1);
function backgrounds(node, paint) {
  if (!node) return [[255, 255, 255, 1]];
  const raw = paint.value(node, 'background');
  const colors = raw.match(/#[\da-f]{3,8}\b|rgba?\([^)]+\)|\b(?:white|black|transparent)\b/ig) || ['transparent'];
  const parent = backgrounds(node.parentElement, paint)[0];
  return colors.map(color => blend(rgba(color), parent));
}
const luminance = rgb => rgb.slice(0, 3).map(x => x / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4).reduce((sum, x, i) => sum + x * [.2126, .7152, .0722][i], 0);
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
const textRoles = ['#services h2', '#services h2 em', '#services .eyebrow', '#services .section-intro', '.support-category', '.support-card h3', '.support-card p', '.support-cta', '.support-site-link', '.support-icon', '.final-cta h2', '.final-cta h2 em', '.final-cta .eyebrow', '.cta-inner>p:not(.eyebrow)', '.cta-footnote', '.cta-footnote .icon', '.cta-decoration', '.floating-contact'];
function palette(document, width, state = {}) {
  const paint = cascade(document, width, state);
  return Object.fromEntries(textRoles.map(selector => {
    const node = document.querySelector(selector); assert.ok(node, selector);
    return [selector, { ink: rgba(paint.value(node, 'color')).slice(0, 3).map(Math.round).join(','), surface: backgrounds(node, paint).map(x => x.slice(0, 3).map(Math.round).join(',')) }];
  }));
}
if (dump) {
  const mode=process.env.JOBS_SECTION_DUMP_THEME === 'dark' ? 'dark' : 'light';
  const h = await page({ stored: { 'gary-jobs-theme': mode } });
  const paint=cascade(h.d,1440);
  console.log(JSON.stringify({theme:mode,palette:palette(h.d,1440),indicator:paint.value(h.d.querySelector('.floating-contact>i'),'background')}, null, 2)); h.dom.window.close(); process.exit(0);
}

const LIGHT_BASELINE = {
  "#services h2": {
    "ink": "11,36,87",
    "surface": [
      "237,242,246"
    ]
  },
  "#services h2 em": {
    "ink": "8,61,145",
    "surface": [
      "237,242,246"
    ]
  },
  "#services .eyebrow": {
    "ink": "8,61,145",
    "surface": [
      "237,242,246"
    ]
  },
  "#services .section-intro": {
    "ink": "38,53,77",
    "surface": [
      "237,242,246"
    ]
  },
  ".support-category": {
    "ink": "67,85,117",
    "surface": ["255,255,255"]
  },
  ".support-card h3": {
    "ink": "64,92,124",
    "surface": [
      "255,255,255"
    ]
  },
  ".support-card p": {
    "ink": "67,85,117",
    "surface": [
      "255,255,255"
    ]
  },
  ".support-cta": {
    "ink": "8,61,145",
    "surface": [
      "255,255,255"
    ]
  },
  ".support-site-link": {
    "ink": "8,61,145",
    "surface": [
      "255,255,255"
    ]
  },
  ".support-icon": {
    "ink": "8,61,145",
    "surface": [
      "231,239,252"
    ]
  },
  ".final-cta h2": {
    "ink": "255,255,255",
    "surface": [
      "8,61,145"
    ]
  },
  ".final-cta h2 em": {
    "ink": "223,232,201",
    "surface": [
      "8,61,145"
    ]
  },
  ".final-cta .eyebrow": {
    "ink": "211,222,234",
    "surface": [
      "8,61,145"
    ]
  },
  ".cta-inner>p:not(.eyebrow)": {
    "ink": "211,222,234",
    "surface": [
      "8,61,145"
    ]
  },
  ".cta-footnote": {
    "ink": "211,222,234",
    "surface": [
      "8,61,145"
    ]
  },
  ".cta-footnote .icon": {
    "ink": "223,232,201",
    "surface": [
      "8,61,145"
    ]
  },
  ".cta-decoration": {
    "ink": "202,217,182",
    "surface": [
      "8,61,145"
    ]
  },
  ".floating-contact": {
    "ink": "255,255,255",
    "surface": [
      "8,61,145"
    ]
  }
};

const MOBILE_LIGHT = {...LIGHT_BASELINE, '.support-cta': {ink: '255,255,255', surface: ['8,61,145']}};

test('light mode keeps desktop colors and highlights the mobile support CTA', async () => {
  const h = await page({ stored: { 'gary-jobs-theme': 'light' } });
  try { for (const width of [390, 1440]) assert.deepEqual(palette(h.d, width), width <= 720 ? MOBILE_LIGHT : LIGHT_BASELINE); }
  finally { h.dom.window.close(); }
});

test('real section descendants resolve readable dark foreground/background pairs across responsive widths and states', async () => {
  for (const locale of ['en', 'vi']) {
    const h = await page({ locale, stored: { 'gary-jobs-theme': 'dark' } });
    try {
      for (const width of [320, 390, 768, 1440]) {
        const paint = cascade(h.d, width);
        for (const selector of textRoles) for (const node of h.d.querySelectorAll(selector)) {
          const ink = rgba(paint.value(node, 'color'));
          for (const surface of backgrounds(node, paint)) {
            let opacity = 1; for (let parent = node; parent; parent = parent.parentElement) opacity *= Number(paint.own(parent).get('opacity')?.value || 1);
            const actual = blend([...ink.slice(0, 3), ink[3] * opacity], surface);
            const threshold = selector === '.cta-decoration' ? 3 : 4.5;
            assert.ok(contrast(actual, surface) >= threshold, `${locale} ${width}px ${selector}: ${contrast(actual, surface).toFixed(2)}:1`);
          }
        }
        for (const selector of ['.support-card-main', '.support-site-link', '.final-cta .button', '.floating-contact']) {
          const node = h.d.querySelector(selector);
          for (const state of ['hover', 'active', 'focus-visible']) {
            const active = cascade(h.d, width, { [state]: new Set([node]) });
            for (const surface of backgrounds(node, active)) assert.ok(contrast(rgba(active.value(node, 'color')), surface) >= 4.5, `${selector}:${state}`);
          }
        }
      }
    } finally { h.dom.window.close(); }
  }
});

test('Light → Dark → System and fresh-page reload keep paired section roles and translated controls synchronized', async () => {
  for (const locale of ['en', 'vi']) {
    const h = await page({ locale, dark: true });
    try {
      for (const mode of ['light', 'dark', 'system']) {
        h.d.querySelector(`[data-jobs-theme-choice=${mode}]`).click();
        const expected = mode === 'system' ? 'dark' : mode;
        assert.equal(h.d.documentElement.dataset.jobsTheme, expected);
        assert.equal(h.w.localStorage.getItem('gary-jobs-theme'), mode);
        const values = palette(h.d, 390);
        assert.notEqual(values['#services h2'].ink, values['#services h2'].surface[0]);
        const fresh = await page({ locale, dark: true, stored: { 'gary-jobs-theme': mode } });
        assert.deepEqual(palette(fresh.d, 390), values); fresh.dom.window.close();
      }
      h.media.matches = false; h.media.listeners.forEach(fn => fn());
      assert.equal(h.d.documentElement.dataset.jobsTheme, 'light');
      assert.deepEqual(palette(h.d, 390), MOBILE_LIGHT);
      const title = h.d.querySelector('#services h2').textContent;
      assert.match(title, locale === 'en' ? /More than a job match/ : /Hơn cả một công việc/);
      assert.equal(h.d.querySelectorAll('.support-card').length, 3);
    } finally { h.dom.window.close(); }
  }
});

test('the three service cards localize labels and keep each distinct destination', async () => {
  for (const locale of ['en', 'vi']) {
    const h = await page({locale});
    try {
      const cards = [...h.d.querySelectorAll('#services .support-card')];
      assert.deepEqual(cards.map(card => card.querySelector('.support-category').textContent), locale === 'vi'
        ? ['Hỗ trợ giấy tờ', 'Nhà ở', 'Hỗ trợ địa phương']
        : ['Document support', 'Housing', 'Local assistance']);
      const links = cards.flatMap(card => [...card.querySelectorAll('.support-site-link')]);
      assert.deepEqual(links.map(link => link.href), ['https://visa.garyhome.vn/', 'https://garyhome.vn/']);
      assert.ok(links.every(link => link.target === '_blank' && link.rel.includes('noopener')));
      const dialog = h.d.querySelector('#detail-dialog');
      for (const [index, id] of ['documents','housing','settling'].entries()) {
        const button = cards[index].querySelector('button.support-cta');
        assert.equal(cards[index].lastElementChild, button);
        assert.ok(cards[index].querySelector('.support-icon svg[aria-hidden=true] path'));
        button.click();
        assert.equal(dialog.open, true);
        assert.equal(dialog.querySelector('[data-action=service-enquiry]').dataset.id, id);
      }
    } finally { h.dom.window.close(); }
  }
});

test('service card layout reaches three, two and one columns and respects reduced motion', async () => {
  const h = await page();
  try {
    const grid = h.d.querySelector('.support-grid'), card = grid.firstElementChild;
    for (const [width, columns] of [[1440, /repeat\(3,/], [768, /repeat\(2,/], [320, /^minmax\(/]]) {
      assert.match(cascade(h.d, width).value(grid, 'grid-template-columns'), columns);
      assert.equal(cascade(h.d, width).value(card.querySelector('.support-cta'), 'margin-top'), 'auto');
    }
    const hover = new Set([card]);
    assert.equal(cascade(h.d, 1440, {hover}).value(card, 'transform'), 'translateY(-3px)');
    assert.equal(cascade(h.d, 1440, {hover, reducedMotion: true}).own(card).has('transform'), false);
  } finally { h.dom.window.close(); }
});

test('floating contact keeps its real contact dialog and does not claim unknown agent availability', async () => {
  for (const locale of ['en', 'vi']) {
    const h = await page({ locale, stored: { 'gary-jobs-theme': 'dark' } });
    try {
      const button = h.d.querySelector('.floating-contact'), paint = cascade(h.d, 390);
      assert.equal(paint.value(button, 'background'), '#242d4c');
      assert.equal(paint.value(button, 'color'), '#f5f3ff');
      assert.equal(paint.value(button, 'border-color'), '#697ba7');
      const minHeight = parseFloat(paint.value(button, 'min-height'));
      assert.ok(minHeight >= 44);
      assert.equal(paint.value(button, 'position'), 'fixed');
      assert.equal(paint.value(button, 'border-radius'), '50%', 'retain the existing 47px mobile launcher');
      assert.equal(paint.value(button, 'width'), '47px');
      assert.equal(paint.value(button, 'height'), '47px');
      assert.equal(paint.value(button, 'right'), '16px');
      assert.equal(paint.value(button, 'bottom'), '16px');
      const desktop = cascade(h.d,1440);
      assert.equal(desktop.value(button,'border-radius'),'30px');
      assert.equal(desktop.value(button,'right'),'25px');
      assert.equal(desktop.value(button,'bottom'),'24px');
      assert.ok(contrast(rgba(paint.value(button, 'border-color')), backgrounds(button, paint)[0]) >= 3);
      assert.doesNotMatch(button.textContent + button.getAttribute('aria-label'), /online|trực tuyến/i);
      const indicator = button.querySelector('i');
      if (indicator) {
        assert.notEqual(paint.value(indicator, 'background'), '#c1d8a1', 'an unconditional green dot cannot imply live availability');
        assert.equal(indicator.getAttribute('aria-hidden'), 'true');
        assert.equal(indicator.dataset.availability,'unknown');
      }
      button.focus(); assert.equal(h.d.activeElement, button); button.click();
      assert.equal(h.d.querySelector('#detail-dialog').open, true);
      assert.match(h.d.querySelector('#dialog-title').textContent, locale === 'en' ? /hello/ : /chào/);
      assert.ok(h.d.querySelector('.contact-options a[href="tel:+84356175046"]'));
      assert.ok(h.d.querySelector('.contact-options a[href="https://zalo.me/84356175046"]'));
    } finally { h.dom.window.close(); }
  }
});


test('contact focus and boundary remain visible over both pale and deep page sections', async () => {
  for (const mode of ['light','dark']) {
    const h=await page({stored:{'gary-jobs-theme':mode}});
    try {
      const button=h.d.querySelector('.floating-contact');
      const paint=cascade(h.d,390,{'focus-visible':new Set([button])});
      const vars=paint.variables(button);
      const outer=rgba(vars['--jobs-contact-focus']), inner=rgba(vars['--jobs-contact-focus-edge']);
      assert.match(paint.value(button,'box-shadow'),/0 0 0 2px/);
      assert.equal(paint.value(button,'outline-color'),`3px solid ${vars['--jobs-contact-focus']}`);
      for (const background of ['#ffffff','#edf2f6','#083d91','#090b16','#101727','#211b3b']) {
        assert.ok(Math.max(contrast(outer,rgba(background)),contrast(inner,rgba(background)))>=3,`${mode}: focus on ${background}`);
      }
      if(mode==='dark'){
        const border=rgba(paint.value(button,'border-color'));
        for(const background of ['#ffffff','#edf2f6','#090b16','#101727','#211b3b'])assert.ok(contrast(border,rgba(background))>=3,background);
      }
    } finally { h.dom.window.close(); }
  }
});


test('recruitment journey has four ordered accessible stages and retains all three benefits', async () => {
 const h=await page();try{
  const section=h.d.querySelector('#why-gary'),journey=section.querySelector('ol.recruitment-journey');
  assert.ok(journey.getAttribute('aria-label'));assert.equal(journey.querySelectorAll(':scope > li').length,4);
  assert.deepEqual([...journey.querySelectorAll('h3')].map(node=>node.textContent),['Connect','Get Guidance','Find Your Fit','Move Forward']);
  assert.equal(journey.querySelectorAll('.journey-connector[aria-hidden="true"]').length,3);
  assert.equal(journey.querySelectorAll('button,a,input').length,0,'Informational stages do not pretend to be controls');
  assert.equal(section.querySelector('img'),null);assert.equal(section.querySelector('.photo-footnote'),null);
  assert.deepEqual([...section.querySelectorAll('.benefit-row h3')].map(node=>node.textContent),['Your next role, without the fees','A local team who gets it','More places. More possibilities.']);
  h.d.querySelector('[data-language="vi"]').click();
  assert.deepEqual([...h.d.querySelectorAll('.journey-card h3')].map(node=>node.textContent),['Kết nối','Nhận hướng dẫn','Tìm nơi phù hợp','Tiến bước']);
 }finally{h.dom.window.close();}
});

test('theme switches preserve exact headlines and eyebrows in both languages without replacing content nodes', async () => {
 const h=await page();try{
  const fallback=new JSDOM(html);assert.equal(fallback.window.document.querySelector('#app h1').textContent,'Build your career.Explore a new culture.');assert.equal(fallback.window.document.querySelector('#app .eyebrow').textContent,'VIETNAM ENGLISH TEACHING JOBS');fallback.window.close();
  const expected={en:{hero:'Build your career. Explore a new culture.',eyebrow:'VIETNAM ENGLISH TEACHING JOBS',section:'A recruitment team.In your corner.',sectionEyebrow:'A LITTLE LOCAL KNOWLEDGE GOES A LONG WAY'},vi:{hero:'Phát triển sự nghiệp. Khám phá nền văn hóa mới.',eyebrow:'VIỆC LÀM GIẢNG DẠY TIẾNG ANH TẠI VIỆT NAM',section:'Đội ngũ tuyển dụng.Luôn đồng hành.',sectionEyebrow:'HIỂU ĐỊA PHƯƠNG, ĐỒNG HÀNH LÂU DÀI'}};
  for(const locale of ['en','vi']){
   h.d.querySelector(`[data-language="${locale}"]`).click();
   const title=h.d.querySelector('#hero-title'),section=h.d.querySelector('#why-gary h2'),eyebrow=h.d.querySelector('.hero-copy>.eyebrow'),sectionEyebrow=h.d.querySelector('.why-copy>.eyebrow');
   for(const mode of ['light','dark','system','dark','light']){
    h.w.setGaryJobsTheme(mode);
    assert.equal(h.d.querySelector('#hero-title'),title);assert.equal(h.d.querySelector('#why-gary h2'),section);
    assert.equal(title.textContent,expected[locale].hero);assert.equal(eyebrow.textContent,expected[locale].eyebrow);
    assert.equal(section.textContent,expected[locale].section);assert.equal(sectionEyebrow.textContent,expected[locale].sectionEyebrow);
   }
  }
 }finally{h.dom.window.close();}
});

test('recruitment text contrast and stacked layout survive desktop/mobile and light/dark palettes', async () => {
 for(const dark of [false,true]){
  const h=await page({dark});try{
   for(const width of [360,390,720,1000,1440]){
    const paint=cascade(h.d,width),grid=h.d.querySelector('.why-grid');
    assert.equal(paint.value(grid,'grid-template-columns'),width<=720?'1fr':'1fr 1fr');
    for(const selector of ['.why-copy h2','.why-copy h2 em','.why-copy>.eyebrow','.why-copy>.body-copy','.benefit-row h3','.benefit-row p','.benefit-icon','.journey-index','.journey-card h3','.journey-card p','.journey-symbol','.journey-connector']){
     for(const node of h.d.querySelectorAll(selector)){
      const ink=rgba(paint.value(node,'color'));
      for(const surface of backgrounds(node,paint))assert.ok(contrast(ink,surface)>=4.5,`${dark?'dark':'light'} ${width} ${selector}: ${contrast(ink,surface).toFixed(2)}`);
     }
    }
    for(const card of h.d.querySelectorAll('.journey-card')){
     assert.equal(paint.value(card,'min-width'),'0');assert.equal(paint.value(card,'display'),'flex');
    }
   }
  }finally{h.dom.window.close();}
 }
});

test('footer social links inherit readable glyph, boundary and focus colors across live theme changes', async () => {
 const h=await page();
 try {
  const links=[...h.d.querySelectorAll('.footer-social a')];
  assert.equal(links.length,3);
  assert.match(links[0].href,/facebook\.com/);
  assert.match(links[1].href,/zalo\.me/);
  assert.match(links[2].href,/^mailto:/);
  for(const mode of ['light','dark']){
   h.w.setGaryJobsTheme(mode);
   assert.deepEqual([...h.d.querySelectorAll('.footer-social a')],links);
   for(const link of links){
    const glyph=link.querySelector('svg,.zalo-word');
    assert.ok(link.getAttribute('aria-label')&&glyph);
    if(glyph.tagName==='svg'){
     assert.equal(glyph.getAttribute('stroke'),'currentColor');
     assert.equal(glyph.getAttribute('fill'),'none');
     assert.equal(glyph.getAttribute('aria-hidden'),'true');
     assert.equal(glyph.getAttribute('opacity'),null);
    }
    for(const state of [undefined,'hover','focus-visible']){
     const paint=cascade(h.d,1440,state?{[state]:new Set([link])}:{});
     const ink=rgba(paint.value(glyph,'color'));
     const boundary=rgba(paint.value(link,'border-color').match(/#[\da-f]{6}\b/i)[0]);
     const [surface]=backgrounds(link,paint),[footer]=backgrounds(link.closest('footer'),paint);
     assert.ok(contrast(ink,surface)>=4.5,mode+' '+state+' glyph');
     assert.ok(contrast(boundary,footer)>=3,mode+' '+state+' border');
     if(state==='focus-visible'){
      const ring=rgba(paint.value(link,'outline-color').match(/#[\da-f]{6}\b/i)[0]);
      assert.ok(contrast(ring,footer)>=3,mode+' focus');
     }
    }
    link.focus();assert.equal(h.d.activeElement,link);
   }
  }
 }finally{h.dom.window.close();}
});
