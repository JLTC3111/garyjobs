import assert from 'node:assert/strict';
import test from 'node:test';
import {JSDOM} from 'jsdom';
import {createHoloBackground} from '../dist/jobs-hero-background.js';
import {mountHoloMosaic} from '../dist/jobs-holo-mosaic.js';

test('the renderer keeps Chrome defaults and releases its WebGL resources', () => {
  const dom = new JSDOM('<div id="hero"></div>', {pretendToBeVisual: true});
  const {window} = dom;
  const {document} = window;
  const host = document.querySelector('#hero');
  const frames = new Map(), uniforms = new Map(), deleted = [];
  let raf = 0, released = 0, disconnected = 0, draws = 0;
  const gl = {
    getExtension: name => name === 'WEBGL_lose_context' ? {loseContext() { released++; }} : null,
    createShader: () => ({}),
    createVertexArray: () => ({}),
    createProgram: () => ({}),
    getProgramParameter: () => true,
    getUniformLocation: (_program, name) => name,
    isContextLost: () => false,
    deleteShader: () => deleted.push('shader'),
    deleteProgram: () => deleted.push('program'),
    deleteVertexArray: () => deleted.push('vertex array'),
    drawArrays: () => draws++,
  };
  for (const fn of ['shaderSource','compileShader','attachShader','linkProgram','viewport','disable','useProgram','bindVertexArray']) gl[fn] = () => {};
  for (const fn of ['uniform1f','uniform2f','uniform3f','uniform4f','uniform4fv']) gl[fn] = (name, ...values) => uniforms.set(name, values);
  window.HTMLCanvasElement.prototype.getContext = kind => kind === 'webgl2' ? gl : null;
  class Observer {
    observe() {}
    disconnect() { disconnected++; }
  }
  const globals = {
    window, document, ResizeObserver: Observer, IntersectionObserver: Observer,
    requestAnimationFrame: callback => (frames.set(++raf, callback), raf),
    cancelAnimationFrame: id => frames.delete(id),
  };
  const previous = Object.getOwnPropertyDescriptors(globalThis);
  Object.assign(globalThis, globals);
  let effect;
  try {
    effect = mountHoloMosaic(host, {});
    assert.ok(host.querySelector('canvas[aria-hidden=true]'));
    for (const [name, value] of Object.entries({uTile:52,uGap:0.08,uRound:0.15,uBevel:0.35,uIntensity:1.25,uGlitter:0.85,uOpacity:1,uLightMode:0})) {
      assert.deepEqual(uniforms.get(name), [value], name);
    }
    for (const time of [1000, 1040]) {
      const [id, next] = frames.entries().next().value;
      frames.delete(id);
      next(time);
    }
    assert.equal(uniforms.get('uTime')[0], 17.02);
    assert.equal(draws, 3);
  } finally {
    effect?.destroy();
    for (const name of Object.keys(globals)) {
      if (previous[name]) Object.defineProperty(globalThis, name, previous[name]);
      else delete globalThis[name];
    }
    window.close();
  }
  assert.equal(frames.size, 0);
  assert.equal(host.children.length, 0);
  assert.equal(disconnected, 2);
  assert.deepEqual(deleted, ['shader','shader','vertex array','program']);
  assert.equal(released, 1);
});

test('switching Off during the lazy load leaves WebGL unmounted', async () => {
  let finishLoading, mounts = 0;
  const sync = createHoloBackground(() => new Promise(resolve => { finishLoading = resolve; }));
  sync({isConnected: true}, 'dark');
  sync(null, 'dark');
  finishLoading({mountHoloMosaic() { mounts++; }});
  await Promise.resolve();
  assert.equal(mounts, 0);
});
