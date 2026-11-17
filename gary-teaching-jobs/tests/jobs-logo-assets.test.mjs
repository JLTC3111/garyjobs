import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
const directory = new URL('../dist/assets/', import.meta.url);
test('transparent SVG variants retain original artwork and lettering geometry without font substitution', async () => {
  const [light,dark,provenance,original] = await Promise.all([
    readFile(new URL('teaching-jobs-logo-light.svg',directory),'utf8'),
    readFile(new URL('teaching-jobs-logo-dark.svg',directory),'utf8'),
    readFile(new URL('teaching-jobs-logo-provenance.json',directory),'utf8'),
    readFile(new URL('gary-agency-logo.png',directory))
  ]);
  const records = JSON.parse(provenance);
  assert.match(records.format,/not an original vector master/);
  assert.equal(createHash('sha256').update(original).digest('hex'),records.sha256);
  const l = new JSDOM(light,{contentType:'image/svg+xml'}), d = new JSDOM(dark,{contentType:'image/svg+xml'});
  try {
    assert.equal(l.window.document.documentElement.getAttribute('viewBox'),'0 0 772 394');
    assert.equal(d.window.document.documentElement.getAttribute('viewBox'),'0 0 772 394');
    for (const document of [l.window.document,d.window.document]) {
      assert.equal(document.querySelectorAll('image,rect,text,filter,script,foreignObject').length,0);
      assert.ok(document.querySelectorAll('path').length>1);
    }
    assert.equal(l.window.document.querySelector('#brand-art').outerHTML,d.window.document.querySelector('#brand-art').outerHTML);
    const lp=l.window.document.querySelector('#brand-lettering'),dp=d.window.document.querySelector('#brand-lettering');
    assert.equal(lp.getAttribute('d'),dp.getAttribute('d'));
    assert.equal(lp.getAttribute('fill'),'#25478f');assert.equal(dp.getAttribute('fill'),'#f7f5fb');
  } finally {l.window.close();d.window.close();}
});
