import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {enhanceGaryApps} from '../src/gary-apps/brand-adapter.js';
const pause=()=>new Promise(resolve=>setTimeout(resolve,0));
const markup=()=>['home','jobs','visa'].map(app=>`<a class="gary-app-menu-item gary-app-${app}" href="https://${app==='home'?'garyhome.vn':app+'.garyhome.vn'}/" target="_blank" rel="noopener noreferrer"><span class="gary-app-mark" aria-hidden="true"><svg data-runtime-icon></svg></span><span><strong>Gary ${app}</strong><span>Existing localized description</span><small class="gary-app-menu-host">${app}</small></span></a>`).join('')+'<a data-all-services href="https://garyhome.vn/services#gary-services">All services</a><a data-travel href="https://jobs.garyhome.vn/#life">Travel</a>';
test('Jobs mounts an app-local menu and the shipped entry has no remote release loader',async()=>{
 const [mount,bundle]=await Promise.all(['src/components/GaryAppsMount.jsx','dist/photo-gallery.js'].map(path=>readFile(new URL('../'+path,import.meta.url),'utf8')));
 assert.match(mount,/root.render\(<GaryAppsMenu/);
 assert.doesNotMatch(mount,/connectGaryApps/);
 assert.doesNotMatch(bundle,/shared\/gary-apps\/v1\/manifest\.json|Invalid Gary Apps manifest/);
});
test('host branding preserves navigation and runtime nodes while adding distinctive monochrome marks',()=>{
 const dom=new JSDOM('<main>'+markup()+'</main>'),root=dom.window.document.querySelector('main');
 const links=[...root.querySelectorAll('a')].map(link=>({node:link,href:link.href,target:link.target,rel:link.rel})),originals=[...root.querySelectorAll('[data-runtime-icon]')];
 const adapter=enhanceGaryApps(root);try{
  assert.equal(root.querySelectorAll('[data-gary-brand-mark]').length,3);
  assert.equal(new Set([...root.querySelectorAll('[data-gary-brand-mark]')].map(node=>node.innerHTML)).size,3);
  assert.ok(originals.every(node=>node.isConnected),'Shared React-owned nodes remain mounted');
  for(const link of links){assert.equal(link.node.href,link.href);assert.equal(link.node.target,link.target);assert.equal(link.node.rel,link.rel);}
  adapter.refresh();assert.equal(root.querySelectorAll('[data-gary-brand-mark]').length,3);
  assert.match(root.textContent,/Teaching & recruitment/);
 }finally{adapter.disconnect();dom.window.close();}
});
test('branding follows connected release replacement and language without replacing service links',async()=>{
 const dom=new JSDOM('<main>'+markup()+'</main>'),d=dom.window.document,root=d.querySelector('main'),adapter=enhanceGaryApps(root);try{
  root.innerHTML=markup();await pause();assert.equal(root.querySelectorAll('[data-gary-brand-mark]').length,3);
  d.documentElement.lang='vi';await pause();assert.match(root.textContent,/Giảng dạy & tuyển dụng/);assert.match(root.textContent,/Nhà ở & cho thuê/);
  assert.equal(root.querySelector('[data-all-services]').href,'https://garyhome.vn/services#gary-services');
  assert.equal(root.querySelector('[data-travel]').href,'https://jobs.garyhome.vn/#life');
  adapter.disconnect();root.innerHTML=markup();await pause();assert.equal(root.querySelectorAll('[data-gary-brand-mark]').length,0);
 }finally{adapter.disconnect();dom.window.close();}
});
