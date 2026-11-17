import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountCms} from '../dist/cms-foundation/index.js';

const settle = async () => { for (let index = 0; index < 16; index++) await new Promise(resolve => setImmediate(resolve)); };
const collection = {kind:'vacancy',label:{en:'Vacancies',vi:'Tin tuyển dụng'},automaticSlug:true,publicPath:'/jobs/',directPublish:true,publishTextFields:['title_en','body_en'],publishMinimums:{title:1,body:1},fields:[]};
const clone = value => structuredClone(value);
const base = {id:'existing-vacancy',kind:'vacancy',slug:'existing-teacher',title_en:'English teacher',title_vi:'Giáo viên tiếng Anh',summary_en:'',summary_vi:'',body_en:'Teach English and support learners.',body_vi:'Hỗ trợ học viên học tiếng Anh.',status:'draft',version:1,data:{},updated_at:'2026-11-17T10:00:00Z'};

function harness(options = {}) {
  const dom = new JSDOM('<main id="cms"></main>', {url:'https://jobs.garyhome.vn/portal.html?access=staff',pretendToBeVisual:true});
  const win = dom.window, doc = win.document, root = doc.querySelector('main');
  Object.defineProperty(win,'innerWidth',{value:1440,writable:true});
  Object.defineProperty(win,'innerHeight',{value:960,writable:true});
  win.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  win.HTMLDialogElement.prototype.close = function () { this.open = false; };
  win.HTMLElement.prototype.scrollIntoView = function () {};
  win.confirm = () => true;
  const focusCalls = [], focus = win.HTMLElement.prototype.focus;
  win.HTMLElement.prototype.focus = function (settings) { focusCalls.push({node:this,settings}); return focus.call(this,settings); };
  let timerId = 90000;
  const timers = new Map(), originalSetTimeout = win.setTimeout.bind(win), originalClearTimeout = win.clearTimeout.bind(win);
  win.setTimeout = (callback,delay,...args) => {
    if (Number(delay) === 5000) { const id = ++timerId; timers.set(id,() => callback(...args)); return id; }
    return originalSetTimeout(callback,delay,...args);
  };
  win.clearTimeout = id => { if (!timers.delete(id)) originalClearTimeout(id); };
  const state = {entries:clone(options.entries || []),calls:{lists:[],saves:[],transitions:[],revisions:[]}};
  const adapter = {
    capabilities:async () => ({read:true,edit:true,publish:true,media:true}),
    errorText:error => error?.message || 'Publication failed',
    async list(input) {
      state.calls.lists.push(clone(input));
      if (options.list) return options.list(input,state);
      const records = state.entries.filter(record => (!input.status || input.status === record.status) && (!input.query || record.title_en.includes(input.query)));
      return {records:clone(records),total:records.length};
    },
    async save(record,input) {
      state.calls.saves.push({record:clone(record),input:clone(input)});
      const next = options.save ? await options.save(record,input,state) : {...clone(record),id:record.id || 'new-vacancy',version:Number(record.version || 0)+1};
      const previous = state.entries.findIndex(entry => entry.id === next.id);
      if (previous < 0) state.entries.push(clone(next)); else state.entries[previous] = clone(next);
      return clone(next);
    },
    async transition(id,status,input) {
      state.calls.transitions.push({id,status,input:clone(input)});
      const record = state.entries.find(entry => entry.id === id);
      const next = options.transition ? await options.transition(id,status,input,state) : {...clone(record),status,version:Number(record.version)+1};
      const previous = state.entries.findIndex(entry => entry.id === next?.id);
      if (previous >= 0) state.entries[previous] = clone(next);
      return clone(next);
    },
    async revisions(id) { state.calls.revisions.push(id); return options.revisions ? options.revisions(id,state) : []; },
    validatePublication:async record => options.validate ? options.validate(record,state) : [],
  };
  const cms = mountCms(root,{appId:'jobs',language:options.language || 'en',collections:[collection],adapter});
  const find = selector => doc.querySelector(selector);
  const click = async selector => { const target = find(selector); assert.ok(target,selector); target.click(); await settle(); };
  const input = (name,value) => {
    const target = find(`[name="${name}"]`); assert.ok(target,name); target.value = value;
    target.dispatchEvent(new win.Event('input',{bubbles:true})); return target;
  };
  const fill = () => { input('title_en','English teacher'); input('title_vi','Giáo viên tiếng Anh'); input('body_en','Teach English and support learners.'); input('body_vi','Hỗ trợ học viên học tiếng Anh.'); };
  return {dom,win,doc,root,cms,state,focusCalls,timers,find,click,input,fill,
    async open() { await cms.ready; await click(options.entries?.length ? '[data-action="edit"]' : '[data-action="new"]'); },
    async expire() { for (const [id,callback] of [...timers]) { timers.delete(id); callback(); } await settle(); },
    close() { cms.destroy({force:true}); dom.window.close(); },
  };
}

function assertManagerFocus(h) {
  assert.ok(h.doc.activeElement.matches('[data-action="new"],[data-action="edit"],[data-action="refresh"]'),'dismissal restores a content-manager control');
  const call = h.focusCalls.findLast(item => item.node === h.doc.activeElement);
  assert.equal(call?.settings?.preventScroll,true,'restoring focus must not reset page scroll');
}

test('confirmed Publish closes only the editor, refreshes the list and shows title with the authoritative public URL',async () => {
  const h = harness({transition:async (id,status,input,state) => ({...state.entries.find(entry => entry.id === id),status,slug:'confirmed-public-url',version:input.expectedVersion+1})});
  try {
    await h.open(); h.fill();
    const before = h.state.calls.lists.length;
    await h.click('[data-action="publish"]');
    assert.equal(h.state.calls.saves.length,1); assert.equal(h.state.calls.transitions.length,1);
    assert.equal(h.find('.cms-dialog')?.open,false); assert.equal(h.cms.isDirty(),false);
    assert.ok(h.state.calls.lists.length > before,'publication refreshes without a page reload');
    const success = h.find('[data-cms-success]'); assert.ok(success?.open);
    assert.match(success.textContent,/English teacher/); assert.match(success.textContent,/published/i);
    assert.equal(success.querySelector('a').href,'https://jobs.garyhome.vn/jobs/confirmed-public-url');
    assert.equal(success.querySelector('[data-gw-toggle],[data-gw-edge]'),null,'compact confirmation is not another resizable editor');
    assert.equal(h.root.querySelector('[data-editor-notice]'),null,'obsolete inline success notice is removed with the editor');
    assert.match(h.root.querySelector('tbody').textContent,/Published/);
    assert.ok(h.find('[data-success-close]'));
    await h.click('[data-success-close]');
    assert.ok(!success.open || !success.isConnected); assertManagerFocus(h);
    assert.equal(h.timers.size,0,'manual dismissal cancels pending auto-dismissal');
  } finally { h.close(); }
});

test('a pending Publish blocks duplicate submissions and shows no success until authoritative confirmation',async () => {
  let resolveTransition;
  const pending = new Promise(resolve => { resolveTransition = resolve; });
  const h = harness({transition:() => pending});
  try {
    await h.open(); h.fill(); const editor = h.find('.cms-dialog'),title = h.find('[name="title_en"]');
    const publish = h.find('[data-action="publish"]'); publish.click(); publish.click(); await settle();
    assert.equal(h.state.calls.saves.length,1); assert.equal(h.state.calls.transitions.length,1);
    assert.equal(editor.open,true); assert.equal(h.find('[name="title_en"]'),title); assert.equal(publish.disabled,true);
    assert.equal(h.find('[data-cms-success]')?.open || false,false);
    resolveTransition({...h.state.entries[0],status:'published',version:2}); await settle();
    assert.ok(h.find('[data-cms-success]')?.open); assert.equal(h.find('.cms-dialog')?.open,false);
  } finally { resolveTransition?.({...base,status:'published'}); h.close(); }
});

test('successful publication retains existing content filters and query while updating its published status',async () => {
  const h = harness();
  try {
    await h.cms.ready;
    const status = h.find('[data-cms-status]'); status.value = 'draft'; status.dispatchEvent(new h.win.Event('change',{bubbles:true})); await settle();
    h.find('[data-cms-search]').value = 'English'; await h.click('[data-action="search"]');
    await h.click('[data-action="new"]'); h.fill(); await h.click('[data-action="publish"]');
    assert.equal(h.state.calls.lists.at(-1).status,'draft'); assert.equal(h.state.calls.lists.at(-1).query,'English');
    assert.equal(h.find('[data-cms-status]').value,'draft'); assert.equal(h.find('[data-cms-search]').value,'English');
    assert.ok(h.find('[data-cms-success]')?.open); assert.equal(h.state.entries[0].status,'published');
    assert.equal(h.root.querySelector('[data-action="edit"]'),null,'published records correctly leave a Draft-only view');
  } finally { h.close(); }
});

test('success confirmation translates live, dismisses after five seconds, and restores manager focus without scrolling',async () => {
  const h = harness();
  try {
    await h.open(); h.fill(); await h.click('[data-action="publish"]');
    assert.equal(h.timers.size,1,'the confirmation has one five-second timer');
    h.cms.setLanguage('vi'); await settle();
    const success = h.find('[data-cms-success]'); assert.ok(success?.open); assert.match(success.textContent,/Giáo viên tiếng Anh/);
    assert.match(success.textContent,/Đã đăng|được đăng|tuyển dụng/i); assert.match(success.querySelector('[data-success-close]').textContent,/Đóng/);
    assert.equal(h.find('.cms-dialog')?.open,false,'language changes do not reopen a cleared editor');
    await h.expire(); assert.ok(!success.open || !success.isConnected); assertManagerFocus(h);
  } finally { h.close(); }
});

test('Escape/native cancel dismisses success, while destroying the CMS cleans up its timer and dialog',async () => {
  const h = harness();
  try {
    await h.open(); h.fill(); await h.click('[data-action="publish"]');
    const success = h.find('[data-cms-success]');
    const cancel = new h.win.Event('cancel',{bubbles:false,cancelable:true}); success.dispatchEvent(cancel); await settle();
    assert.ok(!success.open || !success.isConnected); assertManagerFocus(h); assert.equal(h.timers.size,0);
    await h.click('[data-action="new"]'); h.fill(); await h.click('[data-action="publish"]');
    const second = h.find('[data-cms-success]'); assert.ok(second?.open);
    h.cms.destroy({force:true}); assert.equal(h.timers.size,0); assert.ok(!second.open || !second.isConnected);
    await h.expire(); assert.equal(h.root.childElementCount,0);
  } finally { h.close(); }
});

test('interaction pauses automatic dismissal and Escape remains available to keyboard users',async () => {
  const h = harness();
  try {
    await h.open(); h.fill(); await h.click('[data-action="publish"]');
    const success = h.find('[data-cms-success]');
    success.dispatchEvent(new h.win.Event('pointerenter')); assert.equal(h.timers.size,0);
    await h.expire(); assert.ok(success.open,'an interacting editor can read or use the public link without a timeout');
    const close = success.querySelector('[data-success-close]'); close.focus();
    close.dispatchEvent(new h.win.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})); await settle();
    assert.ok(!success.open || !success.isConnected); assertManagerFocus(h);
  } finally { h.close(); }
});

test('validation and server failures retain editor values and distinguish field errors from success',async () => {
  const h = harness({transition:async () => { throw new Error('Server unavailable'); }});
  try {
    await h.open(); h.input('title_en','Unsaved English role'); h.input('title_vi','Bản dịch vẫn được giữ');
    const title = h.find('[name="title_en"]'),editor = h.find('.cms-dialog');
    await h.click('[data-action="publish"]');
    assert.equal(h.state.calls.saves.length,0); assert.equal(h.state.calls.transitions.length,0);
    assert.equal(h.find('[name="title_en"]'),title); assert.ok(h.find('[data-error-for="body_en"]').textContent);
    assert.equal(editor.open,true); assert.equal(h.find('[data-cms-success]')?.open || false,false);
    h.input('body_en','Complete English details'); await h.click('[data-action="publish"]');
    assert.equal(h.find('.cms-dialog').open,true); assert.equal(h.find('[name="title_en"]'),title,'server failure must retain the original input node'); assert.equal(h.find('[name="title_en"]').value,'Unsaved English role');
    assert.equal(h.find('[name="title_vi"]').value,'Bản dịch vẫn được giữ'); assert.equal(h.find('[name="body_en"]').value,'Complete English details');
    assert.match(h.find('[data-editor-notice]').textContent,/Server unavailable/); assert.equal(h.find('[data-editor-notice]').getAttribute('role'),'alert');
    assert.equal(h.find('[data-cms-success]')?.open || false,false);
  } finally { h.close(); }
});

test('save-success/publish-failure retains saved identity and retries without creating a duplicate record',async () => {
  let attempts = 0;
  const h = harness({transition:async (id,status,input,state) => {
    if (++attempts === 1) throw new Error('Publication interrupted');
    return {...state.entries.find(entry => entry.id === id),status,version:input.expectedVersion+1};
  }});
  try {
    await h.open(); h.fill(); await h.click('[data-action="publish"]');
    assert.equal(h.state.entries.length,1); const saved = clone(h.state.entries[0]);
    assert.equal(saved.status,'draft'); assert.equal(h.find('.cms-dialog').open,true);
    await h.click('[data-action="publish"]');
    assert.equal(h.state.entries.length,1); assert.equal(h.state.calls.saves.length,1,'retry reuses already saved draft');
    assert.equal(h.state.calls.transitions[1].id,saved.id); assert.equal(h.state.calls.transitions[1].input.expectedVersion,saved.version);
    assert.ok(h.find('[data-cms-success]')?.open); assert.equal(h.state.entries[0].status,'published');
  } finally { h.close(); }
});

test('an authoritative response without published status does not close the editor or claim success',async () => {
  let attempts = 0;
  const h = harness({transition:async (id,status,input,state) => ({...state.entries.find(entry => entry.id === id),status:++attempts === 1 ? 'draft' : status,version:input.expectedVersion+1})});
  try {
    await h.open(); h.fill(); await h.click('[data-action="publish"]');
    assert.equal(h.find('.cms-dialog').open,true); assert.equal(h.find('[name="title_en"]').value,'English teacher');
    assert.equal(h.find('[data-cms-success]')?.open || false,false); assert.ok(h.find('[data-editor-notice]').textContent);
    const savedId = h.state.calls.transitions[0].id;
    await h.click('[data-action="publish"]');
    assert.equal(h.state.calls.saves.length,1,'an unconfirmed response must still preserve the already committed save identity');
    assert.equal(h.state.calls.transitions[1].id,savedId); assert.equal(h.state.entries.length,1); assert.ok(h.find('[data-cms-success]')?.open);
  } finally { h.close(); }
});

test('a list/history read failure after committed publication cannot undo the successful publishing result',async () => {
  const h = harness({
    list:async (_input,state) => { if (state.entries.some(entry => entry.status === 'published')) throw new Error('List refresh unavailable'); return {records:clone(state.entries),total:state.entries.length}; },
    revisions:async (_id,state) => { if (state.entries.some(entry => entry.status === 'published')) throw new Error('History unavailable'); return []; },
  });
  try {
    await h.open(); h.fill(); await h.click('[data-action="publish"]');
    assert.equal(h.state.entries[0].status,'published'); assert.equal(h.cms.isDirty(),false);
    assert.equal(h.find('.cms-dialog')?.open,false); assert.ok(h.find('[data-cms-success]')?.open);
    assert.equal(h.find('[data-editor-notice]'),null); assert.equal(h.state.calls.transitions.length,1);
  } finally { h.close(); }
});

test('Save draft and Archive remain separate state transitions instead of triggering vacancy publication confirmation',async () => {
  const h = harness();
  try {
    await h.open(); h.fill();
    h.find('[data-cms-editor]').dispatchEvent(new h.win.Event('submit',{bubbles:true,cancelable:true})); await settle();
    assert.equal(h.state.calls.saves.length,1); assert.equal(h.state.calls.transitions.length,0);
    assert.equal(h.state.entries[0].status,'draft'); assert.equal(h.find('.cms-dialog').open,true); assert.equal(h.cms.isDirty(),false);
    assert.equal(h.find('[data-cms-success]')?.open || false,false);
    await h.click('[data-action="archive"]');
    assert.equal(h.state.calls.transitions.length,1); assert.equal(h.state.calls.transitions[0].status,'archived');
    assert.equal(h.state.entries[0].status,'archived'); assert.doesNotMatch(h.find('[data-cms-success]')?.textContent || '',/Vacancy published!/);
  } finally { h.close(); }
});
