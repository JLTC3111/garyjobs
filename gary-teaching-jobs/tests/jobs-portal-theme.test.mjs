import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {mountPortalAppearance} from '../dist/jobs-portal-appearance.js';
import {mountSquishSwitches} from '../dist/squish-switch.js';
import {staffPortal,settle} from './helpers/jobs-staff-portal.mjs';
const root=new URL('../dist/',import.meta.url);
const [html,init,publicCss,portalCss,componentCss,cmsCss,sidebarCss]=await Promise.all(['portal.html','jobs-theme-init.js','jobs-public-theme.css','jobs-portal-theme.css','jobs-portal.css','cms-foundation/styles.css','jobs-staff-sidebar.css'].map(name=>readFile(new URL(name,root),'utf8')));
function appearance(h,{stored='system',dark=true}={}){
 const query={matches:dark,listeners:[],addEventListener(_,fn){this.listeners.push(fn);}};
 h.w.matchMedia=()=>query;h.w.localStorage.setItem('gary-jobs-theme',stored);h.w.eval(init);
 return{query,controller:mountPortalAppearance(h.doc||h.d),change(value){const select=(h.doc||h.d).querySelector('#portal-appearance');select.value=value;select.dispatchEvent(new h.w.Event('change',{bubbles:true}));}};
}
test('staff and candidate use one persisted Light/Dark/System preference, live system/storage updates, and EN/VI controls',async()=>{
 for(const access of ['staff','candidate'])for(const language of ['en','vi']){
  const h=await staffPortal({access,view:access==='staff'?'cms':'mine'}),a=appearance(h);
  try{
   if(language==='vi'){await h.click('#portal-language');await settle();}
   assert.equal(h.doc.querySelector('#portal-appearance').getAttribute('aria-label'),language==='vi'?'Giao diện':'Appearance');
   for(const preference of ['light','dark','system']){
    a.change(preference);assert.equal(h.w.garyJobsTheme.preference,preference);assert.equal(h.doc.documentElement.dataset.jobsTheme,preference==='light'?'light':'dark');assert.equal(h.w.localStorage.getItem('gary-jobs-theme'),preference);
   }
   a.query.matches=false;a.query.listeners.forEach(fn=>fn());assert.equal(h.doc.documentElement.dataset.jobsTheme,'light');
   a.change('dark');a.query.listeners.forEach(fn=>fn());assert.equal(h.doc.documentElement.dataset.jobsTheme,'dark','explicit preference ignores system changes');
   h.w.localStorage.setItem('gary-jobs-theme','light');h.w.dispatchEvent(new h.w.StorageEvent('storage',{key:'gary-jobs-theme'}));assert.equal(h.doc.documentElement.dataset.jobsTheme,'light');assert.equal(h.doc.querySelector('#portal-appearance').value,'light');
   assert.equal(h.w.localStorage.getItem('gary-home-theme'),null);assert.equal(h.w.localStorage.getItem('gary-visa-theme'),null);
  }finally{a.controller.destroy();await h.close();}
 }
});
test('theme switches preserve open editor, errors, maximized state, candidate application fields and selected uploads',async()=>{
 for(const access of ['staff','candidate']){
  const h=await staffPortal({access,view:access==='staff'?'cms':'apply'}),a=appearance(h);
  try{
   if(access==='staff'){await h.click('[data-action=new]');h.input('title_en','A draft stays here');await h.click('[data-action=publish]');h.doc.querySelector('[data-gw-toggle]').click();}
   const form=h.doc.querySelector(access==='staff'?'[data-cms-editor]':'#persistent-application'),field=form.querySelector(access==='staff'?'[name=title_en]':'[name=full_name]');
   field.value='Unsaved bilingual draft';field.dispatchEvent(new h.w.Event('input',{bubbles:true}));
   const upload=form.querySelector('input[type=file]'),file=new h.w.File(['CV'],'teacher.pdf',{type:'application/pdf'});if(upload)Object.defineProperty(upload,'files',{value:[file]});
   const error=h.doc.querySelector('[data-error-for=body_en]');
   for(const mode of ['light','dark','system'])a.change(mode);
   assert.equal(h.doc.querySelector(access==='staff'?'[data-cms-editor]':'#persistent-application'),form);assert.equal(field.value,'Unsaved bilingual draft');
   if(upload)assert.equal(upload.files[0],file);
   if(access==='staff'){assert.ok(h.doc.querySelector('dialog.gw-maximized'));assert.ok(error.textContent);assert.equal(h.cms.isDirty(),true);}
  }finally{a.controller.destroy();await h.close();}
 }
});
test('reload resolves appearance before styles and portal headers reuse original transparent theme logo assets',async()=>{
 assert.ok(html.indexOf('jobs-theme-init.js')<html.indexOf('href="styles.css"'));
 for(const preference of ['light','dark','system']){
  const dom=new JSDOM(html,{url:'https://jobs.garyhome.vn/portal.html?access=candidate',runScripts:'outside-only'}),h={w:dom.window,d:dom.window.document},a=appearance(h,{stored:preference});
  try{
   assert.equal(h.d.querySelector('#portal-appearance').value,preference);assert.equal(h.d.documentElement.style.colorScheme,preference==='light'?'light':'dark');
   const images=h.d.querySelectorAll('.jobs-portal-brand img');assert.equal(images.length,2);assert.equal(images[0].getAttribute('src'),'assets/teaching-jobs-logo-light.svg');assert.equal(images[1].getAttribute('src'),'assets/teaching-jobs-logo-dark.svg');
   assert.equal(images[0].getAttribute('width'),'772');assert.equal(images[0].getAttribute('height'),'394');
  }finally{a.controller.destroy();dom.window.close();}
 }
 const dom=new JSDOM(html,{runScripts:'outside-only',url:'https://jobs.garyhome.vn/portal.html'});try{dom.window.matchMedia=()=>({matches:true,addEventListener(){}});Object.defineProperty(dom.window,'localStorage',{get(){throw Error('blocked');}});assert.doesNotThrow(()=>dom.window.eval(init));assert.equal(dom.window.document.documentElement.dataset.jobsTheme,'dark');}finally{dom.window.close();}
});
const parse=css=>{const dom=new JSDOM(`<style>${css}</style>`,{url:'https://jobs.garyhome.vn/portal.html'});const rules=[...dom.window.document.styleSheets[0].cssRules];dom.window.close();return rules;};
const rules=[...parse(publicCss),...parse(portalCss)];
function palette(dark){const values={};for(const r of rules)if(r.selectorText==='html'||dark&&r.selectorText==='html[data-jobs-theme=dark]')for(let i=0;i<r.style.length;i++){const key=r.style[i];if(key.startsWith('--'))values[key]=r.style.getPropertyValue(key).trim();}return values;}
function resolve(value,p){return value.replace(/var\((--[\w-]+)\)/g,(_,key)=>{assert.ok(p[key],`missing ${key}`);return resolve(p[key],p);});}
function luminance(value){return [1,3,5].map(i=>parseInt(value.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);}
function contrast(a,b){const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
test('portal semantic pairs and actual public vacancy metadata meet AA contrast in both palettes',()=>{
 for(const dark of [false,true]){
  const p=palette(dark),color=name=>resolve(p[name],p),mode=dark?'dark':'light';
  const pairs=[['--jobs-portal-ink','--jobs-portal-bg'],['--jobs-portal-muted','--jobs-portal-bg'],['--jobs-portal-ink','--jobs-portal-surface'],['--jobs-portal-muted','--jobs-portal-surface'],['--jobs-portal-muted','--jobs-portal-soft'],['--jobs-portal-action','--jobs-portal-surface'],['--jobs-action-ink','--jobs-portal-action'],['--jobs-portal-accent','--jobs-portal-selected'],['--jobs-success','--jobs-success-bg'],['--jobs-error','--jobs-error-bg'],['--jobs-warning','--jobs-warning-bg'],['--jobs-muted','--jobs-surface'],['--jobs-muted','--jobs-soft'],['--jobs-ink','--jobs-surface'],['--jobs-text','--jobs-bg'],['--jobs-text','--jobs-surface'],['--jobs-text','--jobs-soft'],['--jobs-text','--jobs-raised'],['--jobs-text-secondary','--jobs-bg'],['--jobs-text-secondary','--jobs-surface'],['--jobs-text-secondary','--jobs-soft'],['--jobs-text-secondary','--jobs-raised']];
  for(const [fg,bg]of pairs)assert.ok(contrast(color(fg),color(bg))>=4.5,`${mode} ${fg}/${bg}: ${contrast(color(fg),color(bg))}`);
  for(const fg of ['--jobs-control-line','--jobs-focus'])assert.ok(contrast(color(fg),color('--jobs-portal-surface'))>=3,`${mode} ${fg}`);
 }
 assert.match(publicCss,/\.job-location,\.job-employer,\.job-workplace\) \{ color:var\(--jobs-text-secondary\)/);
 assert.match(publicCss,/\.job-benefit \{ color:var\(--jobs-text\)/);
 assert.match(publicCss,/\.job-card-bottom strong \{ color:var\(--jobs-text\)/);
 assert.match(publicCss,/\.job-card h3 :is\(a,button\) \{ color:var\(--jobs-ink\)/);
 assert.match(publicCss,/\.job-tags>span \{ color:var\(--jobs-text-secondary\);background:var\(--jobs-soft\)/);
 assert.match(publicCss,/\.check-list>li,\.dialog-small,\.application-note,\.contact-options small/);
 assert.match(publicCss,/color:var\(--jobs-text-secondary\)/);
 assert.match(publicCss,/\.body-copy,\.section-intro,\.hero-description,\.dialog-intro,\.benefit-row p,\.process-step p,\.faq-item p,\.support-card p\) \{ color:var\(--jobs-text\)/);
 for(const r of [...parse(componentCss),...parse(sidebarCss),...parse(cmsCss)])if(r.style)for(let i=0;i<r.style.length;i++){
  const property=r.style[i];if(property.startsWith('--'))continue;
  assert.doesNotMatch(r.style.getPropertyValue(property),/#[\da-f]{3,8}\b|\bwhite\b|\bblack\b/i,`${r.selectorText} ${property} must consume semantic roles`);
 }
 assert.match(cmsCss,/\.cms-dialog\{background:var\(--cms-surface\)/);assert.match(cmsCss,/\.cms-badge-published\{background:var\(--cms-success-bg\);color:var\(--cms-success\)/);
});
test('portal appearance Squish Switch keeps Light, Dark and System with the existing preference', async () => {
  const dom=new JSDOM(html,{url:'https://jobs.garyhome.vn/portal.html?access=candidate',runScripts:'outside-only'});
  const h={w:dom.window,d:dom.window.document},a=appearance(h,{stored:'system',dark:true});
  const switches=mountSquishSwitches(h.d);
  try {
    const theme=h.d.querySelector('[data-squish-key="jobs-portal-theme"] [role=radiogroup]');
    const select=h.d.querySelector('#portal-appearance');
    assert.equal(select.hidden,true);
    assert.equal(theme.dataset.choice,'system');
    assert.equal(theme.dataset.resolved,'dark');
    assert.equal(theme.getAttribute('aria-label'),'Appearance, System, currently dark');
    theme.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true,cancelable:true}));
    assert.equal(select.value,'dark');
    assert.equal(h.w.garyJobsTheme.preference,'dark');
    assert.equal(h.w.localStorage.getItem('gary-jobs-theme'),'dark');
    a.query.matches=false;a.query.listeners.forEach(fn=>fn());
    assert.equal(h.d.documentElement.dataset.jobsTheme,'dark');
    a.change('system');
    assert.equal(theme.dataset.choice,'system');
    a.query.listeners.forEach(fn=>fn());
    assert.equal(h.d.documentElement.dataset.jobsTheme,'light');
    assert.equal(theme.dataset.resolved,'light');
    assert.equal(theme.getAttribute('aria-label'),'Appearance, System, currently light');
    h.d.documentElement.lang='vi';
    await new Promise(resolve=>h.w.queueMicrotask(resolve));
    assert.equal(theme.querySelector('[role=radio][aria-checked=true]').textContent,'Hệ thống');
  } finally {switches.destroy();a.controller.destroy();dom.window.close();}
});
const successCss=await readFile(new URL('cms-foundation/success-notification.css',root),'utf8');
function specificity(selector){
 const plain=selector.replace(/::[a-z-]+/g,'').replace(/:[a-z-]+(\([^)]*\))?/g,'.p');
 return [(plain.match(/#[\w-]+/g)||[]).length,(plain.match(/\.[\w-]+|\[[^\]]+\]/g)||[]).length,(plain.match(/[a-z][\w-]*/g)||[]).length];
}
function beats(winner,loser){const a=specificity(winner),b=specificity(loser);for(let i=0;i<3;i++)if(a[i]!==b[i])return a[i]>b[i];return false;}
test('toast controls retain readable ink and distinct tones across portal palettes',()=>{
 const sheet=new JSDOM(`<style>${successCss}</style>`,{url:'https://jobs.garyhome.vn/portal.html'}).window.document.styleSheets[0];
 const rules=[...sheet.cssRules].filter(rule=>rule.selectorText);
 const link=rules.find(rule=>rule.selectorText.includes('[data-success-link]'));
 const close=rules.find(rule=>rule.selectorText.endsWith('[data-success-close]'));
 assert.ok(beats(link.selectorText,'.jobs-portal-body :is(a,.jobs-link-button)'));
 assert.equal(link.style.getPropertyValue('color'),'inherit');
 assert.equal(close.style.getPropertyValue('color'),'inherit');
 assert.match(successCss,/prefers-reduced-motion/);
 for(const dark of [false,true]){
  const p=palette(dark),color=name=>resolve(p[name],p),mode=dark?'dark':'light';
  for(const tone of ['success','warning','error']){
   const surface=color(`--jobs-${tone}-bg`);
   assert.ok(contrast(color('--jobs-portal-ink'),surface)>=4.5,`${mode} ${tone} text`);
   assert.ok(contrast(color(`--jobs-${tone}`),surface)>=3,`${mode} ${tone} border`);
  }
 }
});
