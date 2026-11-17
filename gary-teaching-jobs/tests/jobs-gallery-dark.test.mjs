import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { build } from 'esbuild';
import React from 'react';
import { JSDOM } from 'jsdom';

const css = await readFile(new URL('../src/components/PhotoGallery.css', import.meta.url), 'utf8');
const photos = JSON.parse(await readFile(new URL('../src/data/photos.json', import.meta.url), 'utf8'));
const darkStart = css.indexOf('/* Gallery-only dark roles.');
const endMarker = '/* End gallery-only dark roles. */';
const darkEnd = css.indexOf(endMarker) + endMarker.length + 1;
const sheet = new JSDOM(`<style>${css}</style>`).window.document.styleSheets[0];
const rule = selector => [...sheet.cssRules].find(value => value.selectorText === selector);
const base = 'html[data-jobs-theme=dark] ';
const roles = rule(`${base}.photo-gallery`).style;
const variables = Object.fromEntries(Array.from({ length:roles.length }, (_,i) => roles[i]).map(key => [key, roles.getPropertyValue(key).trim()]));
function resolve(value) {
  return value.replace(/var\((--[\w-]+)(?:,\s*([^()]+))?\)/g, (_,key,fallback) => resolve(variables[key] || fallback));
}
function contrast(a,b) {
  const luminance = hex => {
    const [r,g,blue] = [1,3,5].map(i => parseInt(hex.slice(i,i+2),16)/255).map(x => x <= .04045 ? x/12.92 : ((x+.055)/1.055)**2.4);
    return r*.2126 + g*.7152 + blue*.0722;
  };
  const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);
}

test('gallery dark refinements do not change the original light CSS or gallery layout', () => {
  assert.ok(darkStart >= 0 && darkEnd > darkStart);
  const original = css.slice(0,darkStart) + css.slice(darkEnd);
  assert.equal(createHash('sha256').update(original).digest('hex'), 'e92a006ce3377f7d6a24578c54010333b71fe4f9538ffa15ff96fc20f457bcc6');
  const added = css.slice(darkStart,darkEnd);
  const addedSheet = new JSDOM(`<style>${added}</style>`).window.document.styleSheets[0];
  const assertDarkScope = rules => {
    for (const current of rules) {
      if (current.cssRules) { assertDarkScope(current.cssRules); continue; }
      assert.ok(current.selectorText?.startsWith(base), current.selectorText);
      assert.doesNotMatch(current.selectorText, /section-heading|h2|photo-gallery-stage|flex-carousel__title/, 'editorial typography and gallery geometry remain untouched');
    }
  };
  assertDarkScope(addedSheet.cssRules);
  const reduced = [...addedSheet.cssRules].find(value => value.conditionText === '(prefers-reduced-motion:reduce)');
  assert.equal(reduced.cssRules[0].selectorText,`${base}.photo-gallery-filter:active`);
  assert.equal(reduced.cssRules[0].style.transform,'none');
  const control=rule(`${base}.photo-gallery-filter`).style;
  assert.equal(control.getPropertyValue('min-height'),'44px');
  assert.equal(control.getPropertyValue('padding'),'10px 14px');
  assert.equal(control.getPropertyValue('border-radius'),'8px');
  assert.equal(rule(`${base}.photo-gallery-filters`).style.gap,'8px');
  assert.equal(rule(`${base}.photo-gallery-filter>span`).style.opacity,'1');
});

test('actual dark filter colors, counts and interactive states meet text/control contrast', () => {
  assert.equal(variables['--gallery-filter-surface'],'#191d2e');
  assert.equal(variables['--gallery-filter-ink'],'#dfe3f4');
  assert.equal(variables['--gallery-filter-selected'],'#aebbff');
  assert.equal(variables['--gallery-filter-selected-ink'],'#10172e');
  for (const [ink,surface] of [
    ['--gallery-filter-ink','--gallery-filter-surface'],
    ['--gallery-filter-ink','--gallery-filter-hover'],
    ['--gallery-filter-count','--gallery-filter-count-surface'],
    ['--gallery-filter-selected-ink','--gallery-filter-selected'],
    ['--gallery-filter-selected-ink','--gallery-filter-selected-hover'],
    ['--gallery-filter-selected-ink','--gallery-filter-count-selected']
  ]) assert.ok(contrast(resolve(variables[ink]),resolve(variables[surface]))>=4.5,`${ink} / ${surface}`);
  for (const [line,surface] of [
    ['--gallery-filter-line','--gallery-filter-surface'],
    ['--gallery-filter-hover-line','--gallery-filter-hover'],
    ['--gallery-filter-focus','--gallery-filter-surface']
  ]) assert.ok(contrast(resolve(variables[line]),resolve(variables[surface]))>=3,`${line} / ${surface}`);
  assert.ok(contrast(resolve(variables['--gallery-muted']),'#090b16')>=4.5);
  assert.equal(rule(`${base}.photo-gallery-filter:focus-visible`).style.outline,'3px solid var(--gallery-filter-focus)');
  assert.equal(rule(`${base}.photo-gallery-filter:focus-visible`).style.getPropertyValue('outline-offset'),'3px');
  assert.equal(rule(`${base}.photo-gallery-filter:active`).style.transform,'translateY(1px)');
  assert.equal(rule(`${base}.gary-photo-carousel :is(.flex-carousel__subtitle,.flex-carousel__count)`).style.opacity,'1');
});

test('the real gallery preserves location filtering, counts, native buttons and bilingual content', async () => {
  const dom=new JSDOM('<div id="gallery"></div>',{url:'https://jobs.garyhome.vn/',pretendToBeVisual:true});
  const w=dom.window,saved={window:globalThis.window,document:globalThis.document,act:globalThis.IS_REACT_ACT_ENVIRONMENT};
  const IO=class { constructor(callback){this.callback=callback;} observe(){this.callback([{isIntersecting:true}]);} disconnect(){} };
  w.HTMLCanvasElement.prototype.getContext=()=>null;
  w.HTMLElement.prototype.scrollIntoView=function(){};
  Object.assign(globalThis,{window:w,document:w.document,IS_REACT_ACT_ENVIRONMENT:true});
  const result=await build({entryPoints:['src/components/PhotoGallery.jsx'],bundle:true,write:false,format:'cjs',platform:'node',packages:'external',loader:{'.css':'empty'},jsx:'automatic'});
  const module={exports:{}};
  try {
    vm.runInNewContext(result.outputFiles[0].text,{module,exports:module.exports,require:createRequire(import.meta.url),process,console,document:w.document,window:w,IntersectionObserver:IO,KeyboardEvent:w.KeyboardEvent});
    for (const locale of ['en','vi']) {
      let mounted,explored;
      await React.act(async()=>{mounted=module.exports.mountPhotoGallery(w.document.getElementById('gallery'),{locale,onExploreRegion:region=>explored=region});});
      const buttons=[...w.document.querySelectorAll('.photo-gallery-filter')];
      assert.equal(buttons.length,4);
      assert.equal(buttons[0].textContent.replace(/\d+$/,''),locale==='en'?'All photos':'Tất cả ảnh');
      assert.equal(w.document.querySelector('.photo-gallery-filters').getAttribute('aria-label'),locale==='en'?'Choose a photo album':'Chọn album ảnh');
      for (const [i,key] of ['all','hagiang','hoian','hanoi'].entries()) {
        const expected=photos.filter(photo=>key==='all'||photo.region===key);
        buttons[i].focus();
        await React.act(async()=>buttons[i].click());
        assert.equal(w.document.activeElement,buttons[i]);
        assert.equal(buttons[i].getAttribute('aria-pressed'),'true');
        assert.equal(w.document.querySelectorAll('.photo-gallery-filter[aria-pressed=true]').length,1);
        assert.equal(buttons[i].getAttribute('aria-controls'),'vietnam-photo-stage');
        assert.equal(Number(buttons[i].querySelector('span').textContent),expected.length);
        const gallery=w.document.querySelector('.photo-gallery');
        assert.equal(gallery.dataset.album,key);assert.equal(Number(gallery.dataset.photoCount),expected.length);
        const images=[...w.document.querySelectorAll('.photo-gallery-fallback img')];
        assert.deepEqual(images.map(image=>image.getAttribute('src')),expected.map(photo=>photo.src));
        assert.deepEqual(images.map(image=>image.alt),expected.map(photo=>photo.alt[locale]));
      }
      await React.act(async()=>w.document.querySelector('.photo-gallery-explore').click());
      assert.equal(explored,'hanoi');
      await React.act(async()=>mounted.unmount());
      assert.equal(w.document.getElementById('gallery').children.length,0);
    }
  } finally {
    if(saved.window===undefined)delete globalThis.window;else globalThis.window=saved.window;
    if(saved.document===undefined)delete globalThis.document;else globalThis.document=saved.document;
    if(saved.act===undefined)delete globalThis.IS_REACT_ACT_ENVIRONMENT;else globalThis.IS_REACT_ACT_ENVIRONMENT=saved.act;
    dom.window.close();
  }
});
