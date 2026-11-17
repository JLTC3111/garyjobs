import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
const component = await readFile(new URL('../dist/jobs-platform-theme.css', import.meta.url), 'utf8');
const host = await readFile(new URL('../dist/jobs-public-theme.css', import.meta.url), 'utf8');
const sheet = css => new JSDOM(`<style>${css}</style>`).window.document.styleSheets[0];
const declarations = style => Object.fromEntries(Array.from({length:style.length}, (_,i)=>style[i]).filter(key=>key.startsWith('--')).map(key=>[key,style.getPropertyValue(key).trim()]));
const rule = (stylesheet, selector) => [...stylesheet.cssRules].find(value=>value.selectorText===selector);
const styles = sheet(component), hostStyles = sheet(host);
function resolve(value, variables) {
  return value.replace(/var\((--[\w-]+)\)/g, (_, key) => { assert.ok(variables[key], `Missing ${key}`);return resolve(variables[key], variables); });
}
function luminance(hex) {
  const rgb = [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);
  return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
}
const contrast = (a,b)=>(Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05);
test('Jobs shared switcher overrides connected and fallback colors through active host tokens',()=>{
  const adapter = declarations(rule(styles,'body.jobs-public .gary-apps-menu').style);
  for(const value of Object.values(adapter))assert.match(value,/^var\(--jobs-/);
  for(const current of styles.cssRules){
    if(!current.style)continue;
    for(let i=0;i<current.style.length;i++){
      const property=current.style[i];if(property.startsWith('--'))continue;
      assert.doesNotMatch(current.style.getPropertyValue(property),/#[\da-f]{3,8}\b/i,`${current.selectorText}: ${property}`);
    }
  }
  for(const selector of ['.gary-apps-menu-heading>strong','.gary-apps-menu-heading>p','.gary-app-menu-host','.gary-app-menu-item>svg','.gary-app-menu-item strong>small']){
    const role=rule(styles,`body.jobs-public .gary-apps-menu ${selector}`);assert.match(role?.style.color||'',/var\(--gary-app-/);
  }
  assert.match(component,/gary-app-menu-item:is\(:hover,:focus-visible\)/);
  assert.match(component,/\.gary-apps-menu a:focus-visible/);
});
test('actual Jobs light and dark menus preserve text, active badge, glyph and focus contrast',()=>{
 const light=declarations(rule(hostStyles,'html').style),dark=declarations(rule(hostStyles,'html[data-jobs-theme=dark]').style);
 const hostLight=declarations(rule(styles,'body.jobs-public').style),hostDark=declarations(rule(styles,'html[data-jobs-theme=dark] body.jobs-public').style),adapter=declarations(rule(styles,'body.jobs-public .gary-apps-menu').style);
 for(const [theme,palette] of [['light',{...light,...hostLight}],['dark',{...light,...dark,...hostLight,...hostDark}]]){
  const values={...palette,...adapter},color=name=>resolve(values[name],values);
  for(const [foreground,background] of [['--gary-app-ink','--gary-app-surface'],['--gary-app-muted','--gary-app-surface'],['--gary-app-muted','--gary-app-hover'],['--gary-app-action','--gary-app-raised'],['--gary-app-action','--gary-app-hover'],['--gary-platform-home','--gary-app-surface'],['--gary-platform-jobs','--gary-app-surface'],['--gary-platform-visa','--gary-app-surface']]){
   const ratio=contrast(color(foreground),color(background));assert.ok(ratio>=4.5,`${theme}: ${foreground} / ${background}: ${ratio.toFixed(2)}`);
  }
  for(const foreground of ['--gary-app-focus','--gary-app-control-border'])assert.ok(contrast(color(foreground),color('--gary-app-surface'))>=3,`${theme} ${foreground}`);
 }
});
