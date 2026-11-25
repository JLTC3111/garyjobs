import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import {bindFeedbackDom} from './helpers/feedback-dom.mjs';
import {staffPortal} from './helpers/jobs-staff-portal.mjs';
import { vacancyCard, vacancySlug, escapeText, safeLink } from '../dist/jobs-public-content.js';
import * as jobsSeo from '../dist/jobs-seo.js';
import {mountJobsPublicAccount} from '../dist/jobs-public-account.js';
import {mountSquishSwitches} from '../dist/squish-switch.js';
const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
const init = await readFile(new URL('../dist/jobs-theme-init.js', import.meta.url), 'utf8');
const app = (await readFile(new URL('../dist/app.js', import.meta.url), 'utf8')).split('\n').filter(line => !line.startsWith('import ')).join('\n');
async function page({ stored = {}, dark = false, squish = false, path = '/', records = [{kind:'location',slug:'hanoi',title_en:'Hanoi',title_vi:'Hà Nội'}] } = {}) {
  const dom = new JSDOM(html, { url: `https://jobs.garyhome.vn${path}`, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window, query = {
    matches: dark,
    listeners: [],
    addEventListener(_, fn) { this.listeners.push(fn); },
    removeEventListener(_, fn) { this.listeners = this.listeners.filter(listener => listener !== fn); },
  };
  bindFeedbackDom(dom.window);

  for (const [key,value] of Object.entries(stored)) w.localStorage.setItem(key,value);
  w.matchMedia = () => query;
  w.IntersectionObserver = class { observe() {} disconnect() {} };
  w.HTMLElement.prototype.scrollIntoView = function() {};
  w.scrollTo = () => {};
  w.HTMLDialogElement.prototype.showModal = function() { this.open = true; };
  w.HTMLDialogElement.prototype.close = function() { this.open = false; };
  Object.assign(w,jobsSeo);
 Object.assign(w, { mountGaryApps: element => { element.innerHTML='<details class="gary-apps-menu"><summary>Shared platforms</summary><a href="https://garyhome.vn/">Gary Home</a></details>';return { unmount() {} }; }, mountPhotoGallery: () => ({ unmount() {} }), mountGlassHero: () => ({ unmount() {}, update() {} }), vacancyCard, vacancySlug, escapeText, safeLink, publicContent: async () => records });
  w.eval(init);
  const switches=squish?mountSquishSwitches(w.document):null;
  vm.runInContext(app,dom.getInternalVMContext());
  mountJobsPublicAccount(w.document,{onAuthStateChange:callback=>callback('INITIAL_SESSION',null)});
  await new Promise(resolve=>setTimeout(resolve,10));
  return {dom,w,d:w.document,query,switches};
}
test('Squish Switch keeps the Jobs public language control focused across a translated render', async () => {
  const h=await page({squish:true}),{d,w}=h;
  try {
    d.querySelector('#keyword').value='science';
    d.querySelector('#location').value='hanoi';
    d.querySelector('#jobs-preferences-trigger').click();
    const button=d.querySelector('#jobs-preferences-panel [role=switch]');
    assert.equal(d.activeElement,button);
    assert.equal(button.getAttribute('aria-checked'),'false');
    button.click();
    assert.equal(d.documentElement.lang,'vi');
    assert.equal(w.localStorage.getItem('gary-language'),'"vi"');
    assert.equal(d.querySelector('#jobs-preferences-panel').hidden,false);
    assert.equal(d.querySelector('#jobs-preferences-panel [role=switch]'),button);
    assert.equal(d.activeElement,button);
    assert.equal(button.getAttribute('aria-label'),'Dùng tiếng Việt');
    assert.equal(button.getAttribute('aria-checked'),'true');
    assert.equal(d.querySelector('#keyword').value,'science');
    assert.equal(d.querySelector('#location').value,'hanoi');
  } finally {h.switches.destroy();h.dom.window.close();}
});
test('Squish Switch keeps the Jobs vacancy route, reading preferences and keyboard focus', async () => {
  const path='/jobs/science-teacher';
  const h=await page({squish:true,path,records:[{kind:'vacancy',id:'fixture',slug:'science-teacher',title_en:'Science Teacher',title_vi:'Giáo viên khoa học'}]}),{d,w}=h;
  try {
    const button=d.querySelector('#detail-dialog[open] [role=switch]');
    assert.ok(button);
    const style=d.querySelector('#vacancy-style');
    style.value='modern-slate';
    style.dispatchEvent(new w.Event('change',{bubbles:true}));
    button.focus();
    button.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));
    assert.equal(w.location.pathname,path);
    assert.equal(d.querySelector('#dialog-title').textContent,'Giáo viên khoa học');
    assert.equal(d.querySelector('#vacancy-style').value,'modern-slate');
    assert.equal(d.querySelector('#detail-dialog[open] [role=switch]'),button);
    assert.equal(d.activeElement,button);
    assert.equal(button.getAttribute('aria-checked'),'true');
  } finally {h.switches.destroy();h.dom.window.close();}
});
test('Jobs mounts the dashboard Squish Switch for signed-in staff and candidates', async () => {
  for (const access of ['staff','candidate']) {
    const h=await staffPortal({access,view:access==='staff'?'cms':'mine'});
    try {
      const selector='.jobs-portal-header #portal-language[role=switch]';
      const button=h.doc.querySelector(selector),route=h.w.location.search;
      assert.equal(h.doc.querySelector('#signed-panel').hidden,false);
      assert.equal(button.disabled,false);
      assert.equal(button.getAttribute('aria-checked'),'false');
      button.focus();
      await h.click(selector);
      assert.equal(h.doc.documentElement.lang,'vi');
      assert.equal(h.w.localStorage.getItem('gary-language'),'"vi"');
      assert.equal(button.getAttribute('aria-checked'),'true');
      assert.equal(button.getAttribute('aria-label'),'Dùng tiếng Việt');
      assert.equal(h.doc.activeElement,button);
      assert.equal(h.w.location.search,route);
    } finally {await h.close();}
  }
});
test('one globe opens a nonmodal preferences dialog; Escape and close restore focus', async () => {
  const h=await page(),{d,w}=h;
  try {
    assert.equal(d.querySelectorAll('#jobs-preferences-trigger').length,1);
    assert.equal(d.querySelectorAll('#gary-apps-header').length,1);
    assert.equal(d.querySelectorAll('#gary-apps-mobile').length,0);
    assert.equal(d.querySelectorAll('.language-button,[data-jobs-theme-select]').length,0);
    assert.equal(d.querySelectorAll('.jobs-preferences-panel fieldset').length,2);
    const trigger=d.querySelector('#jobs-preferences-trigger'),panel=d.querySelector('#jobs-preferences-panel');
    assert.equal(trigger.getAttribute('aria-controls'),panel.id);assert.equal(trigger.getAttribute('aria-haspopup'),'dialog');
    assert.equal(panel.hidden,true);
    d.querySelector('.jobs-login-menu').open=true;d.querySelector('.gary-apps-menu').open=true;
    trigger.click();
    assert.equal(panel.hidden,false);assert.equal(trigger.getAttribute('aria-expanded'),'true');
    assert.equal(d.activeElement.dataset.language,'en');
    assert.equal(d.querySelector('.jobs-login-menu').open,false);assert.equal(d.querySelector('.gary-apps-menu').open,false);
    d.activeElement.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
    assert.equal(panel.hidden,true);assert.equal(d.activeElement,trigger);
    trigger.click();d.querySelector('[data-action=close-preferences]').click();
    assert.equal(panel.hidden,true);assert.equal(d.activeElement,trigger);
  } finally {h.dom.window.close();}
});
test('outside pointer and Tab focus dismiss without stealing focus; inside choices remain usable', async () => {
  const h=await page(),{d,w}=h;
  try {
    const trigger=d.querySelector('#jobs-preferences-trigger'),panel=d.querySelector('#jobs-preferences-panel');trigger.click();
    d.querySelector('[data-jobs-theme-choice=dark]').dispatchEvent(new w.Event('pointerdown',{bubbles:true}));assert.equal(panel.hidden,false);
    d.querySelector('[data-jobs-theme-choice=dark]').click();assert.equal(panel.hidden,false);
    d.querySelector('#keyword').focus();assert.equal(panel.hidden,true);assert.equal(d.activeElement.id,'keyword');
    trigger.click();d.querySelector('#main').dispatchEvent(new w.Event('pointerdown',{bubbles:true}));assert.equal(panel.hidden,true);
    trigger.click();d.querySelector('[data-action=menu]').click();assert.equal(panel.hidden,true);assert.equal(d.querySelector('#mobile-nav').hidden,false);
  } finally {h.dom.window.close();}
});
test('language changes retain open preferences, search state, theme and active focus', async () => {
  const h=await page(),{d,w}=h;
  try {
    d.querySelector('#keyword').value='science';d.querySelector('#location').value='hanoi';
    d.querySelector('#jobs-preferences-trigger').click();d.querySelector('[data-jobs-theme-choice=dark]').click();
    d.querySelector('[data-language=vi]').click();
    assert.equal(d.documentElement.lang,'vi');assert.equal(w.localStorage.getItem('gary-language'),'"vi"');
    assert.equal(d.querySelector('#jobs-preferences-panel').hidden,false);
    assert.equal(d.querySelector('#jobs-preferences-title').textContent,'Tùy chọn website');
    assert.equal(d.activeElement.dataset.language,'vi');
    assert.equal(d.querySelector('#keyword').value,'science');assert.equal(d.querySelector('#location').value,'hanoi');
    assert.equal(d.querySelector('[data-jobs-theme-choice=dark]').getAttribute('aria-pressed'),'true');
    assert.equal(d.querySelectorAll('#jobs-glass-hero').length,1);
    assert.ok(d.querySelector('a[href="portal.html?access=candidate"]'));assert.ok(d.querySelector('a[href="portal.html?access=staff"]'));
  } finally {h.dom.window.close();}
});
test('all language and appearance combinations persist independently across a fresh page', async () => {
  for (const language of ['en','vi']) for (const theme of ['light','dark','system']) {
    const h=await page({dark:true}),{d,w}=h;
    d.querySelector('#jobs-preferences-trigger').click();d.querySelector(`[data-language=${language}]`).click();d.querySelector(`[data-jobs-theme-choice=${theme}]`).click();
    const stored={'gary-language':w.localStorage.getItem('gary-language'),'gary-jobs-theme':w.localStorage.getItem('gary-jobs-theme')};
    const reloaded=await page({stored,dark:true});
    assert.equal(reloaded.d.documentElement.lang,language);
    assert.equal(reloaded.w.garyJobsTheme.preference,theme);
    assert.equal(reloaded.d.documentElement.dataset.jobsTheme,theme==='system'?'dark':theme);
    assert.equal(reloaded.d.querySelector(`[data-jobs-theme-choice=${theme}]`).getAttribute('aria-pressed'),'true');
    assert.equal(reloaded.d.querySelector('#jobs-preferences-panel').hidden,true);
    if(theme==='system'){reloaded.query.matches=false;reloaded.query.listeners.forEach(fn=>fn());assert.equal(reloaded.d.documentElement.dataset.jobsTheme,'light');}
    h.dom.window.close();reloaded.dom.window.close();
  }
});
test('the preselected theme exposes the correct transparent logo variant immediately through CSS', async () => {
  const css=await readFile(new URL('../dist/jobs-public-theme.css',import.meta.url),'utf8');
  for (const theme of ['light','dark']) {
    const h=await page({stored:{'gary-jobs-theme':theme},dark:theme==='light'});
    try {
      const style=h.d.createElement('style');style.textContent=css;h.d.head.append(style);
      const light=h.d.querySelector('.jobs-logo-light'),dark=h.d.querySelector('.jobs-logo-dark');
      assert.equal(h.w.getComputedStyle(light).display,theme==='light'?'block':'none');
      assert.equal(h.w.getComputedStyle(dark).display,theme==='dark'?'block':'none');
      assert.equal(h.w.getComputedStyle(h.d.querySelector('.brand')).backgroundColor,'rgba(0, 0, 0, 0)');
      assert.equal(h.d.querySelector('.jobs-preferences-trigger').getAttribute('aria-label'),'Website preferences');
    } finally {h.dom.window.close();}
  }
});
