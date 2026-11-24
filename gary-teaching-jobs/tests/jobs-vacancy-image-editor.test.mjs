import test from 'node:test';
import assert from 'node:assert/strict';
import {readdir, readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {PGlite} from '@electric-sql/pglite';
import {emptyEntry} from '../dist/cms-foundation/content.js';
import {vacancyCard} from '../dist/jobs-public-content.js';
import {
  coverCrop, cropZoom, editableVacancyImages, mountVacancyImageEditor, panCropByPointer,
  vacancyImageCrop, vacancyImageCropStyle, zoomedCrop,
} from '../dist/jobs-vacancy-image.js';

const framePattern = /^left:-?\d+(?:\.\d+)?%;top:-?\d+(?:\.\d+)?%;width:\d+(?:\.\d+)?%;height:\d+(?:\.\d+)?%$/;
const photo = (id, extra = {}) => ({id, width:1600, height:1200, alt_en:'Classroom', alt_vi:'Lớp học', cover:false, ...extra});

test('a 16:9 crop stays inside the original and can frame the public card', () => {
  const cover = coverCrop(1600, 1200);
  assert.deepEqual(cover, {x:0, y:0.125, w:1, h:0.75});
  const zoomed = zoomedCrop(1600, 1200, cover, 2);
  assert.equal(zoomed.w, 0.5);
  assert.equal(zoomed.h, 0.375);
  assert.ok(Math.abs(zoomed.x + zoomed.w / 2 - 0.5) < 0.0001);
  assert.ok(Math.abs(zoomed.y + zoomed.h / 2 - 0.5) < 0.0001);
  assert.equal(cropZoom(1600, 1200, zoomed), 2);
  const raised = panCropByPointer(cover, 0, -40, 320, 180, 1600, 1200);
  assert.ok(raised.y > cover.y && raised.y + raised.h <= 1.001);
  assert.equal(panCropByPointer(cover, 0, 500, 320, 180, 1600, 1200).y, 0);
  assert.equal(vacancyImageCrop({...cover, z:1}, 1600, 1200), null);
  assert.match(vacancyImageCropStyle(zoomed), framePattern);
  const id = '11000000-0000-4000-8000-000000000001';
  const images = editableVacancyImages({vacancy_images:[{...photo(id, {cover:true}), crop:zoomed}]});
  assert.deepEqual(images[0].crop, zoomed);
  const card = vacancyCard({id:'10000000-0000-4000-8000-000000000001', slug:'teacher', title_en:'Teacher', title_vi:'Giáo viên', data:{vacancy_images:images}}, 0, [], 'en');
  assert.equal(card.image.frame, vacancyImageCropStyle(zoomed));
  assert.match(card.image.url, new RegExp(`${id}$`));
  assert.equal(card.images[0].id, id);
});

function mount(images, {language = 'en', upload} = {}) {
  const dom = new JSDOM('<section id="editor"></section>', {url:'https://jobs.example/portal.html'});
  const root = dom.window.document.getElementById('editor');
  const saved = [], uploaded = [];
  const release = mountVacancyImageEditor(root, {
    record:{id:'vacancy-1', data:{vacancy_images:images}},
    language, editable:true,
    preview:async id => `https://files.example/${id}`,
    upload:upload || (async (_id, file) => {
      uploaded.push(file);
      return {id:'22000000-0000-4000-8000-000000000099', width:1600, height:1200};
    }),
    changeImages() {},
    save:async operation => { const value = await operation(); saved.push(value); return value; },
  });
  return {dom, root, win:dom.window, saved, uploaded, release};
}
const rect = () => ({width:320, height:180, left:0, top:0, right:320, bottom:180, x:0, y:0, toJSON() { return {}; }});
const pointer = (win, type, x, y) => {
  const event = new win.Event(type, {bubbles:true, cancelable:true});
  Object.defineProperties(event, {clientX:{value:x}, clientY:{value:y}, pointerId:{value:1}, button:{value:0}});
  return event;
};

test('one photo keeps replace, crop and remove in a row under the preview without a cover button', () => {
  const view = mount([photo('11000000-0000-4000-8000-000000000001', {cover:true})]);
  try {
    const item = view.root.querySelector('[data-saved-image]');
    const workspace = item.querySelector('.jobs-vacancy-image-workspace');
    assert.deepEqual([...workspace.children].map(child => child.className), ['jobs-vacancy-image-stage', 'jobs-vacancy-image-toolbar']);
    assert.equal(item.querySelector('.jobs-vacancy-image-alts').previousElementSibling, workspace);
    const buttons = [...item.querySelectorAll('.jobs-vacancy-image-toolbar button')];
    assert.deepEqual(buttons.slice(0, 3).map(button => button.textContent), ['Replace', 'Fit to Frame', 'Remove']);
    assert.deepEqual(buttons.slice(3).map(button => button.textContent), ['Move Up', 'Move Down']);
    assert.deepEqual(buttons.map(button => button.querySelector('svg')?.dataset.lucide), ['replace', 'crop', 'trash-2', 'arrow-up', 'arrow-down']);
    assert.equal(buttons[2].querySelector('svg').getAttribute('viewBox'), '0 0 24 24');
    assert.equal(buttons[0].querySelector('path').getAttribute('d'), 'M14 4a1 1 0 0 1 1-1');
    assert.equal(item.querySelector('[data-image-cover]'), null);
    assert.equal(item.querySelector('[data-cover-badge]').textContent, 'Cover');
    assert.equal(item.querySelector('[data-saved-alt="en"]').value, 'Classroom');
    assert.equal(item.querySelector('[data-saved-alt="vi"]').value, 'Lớp học');
    assert.equal(item.querySelector('[data-image-crop-controls]').hidden, true);
    assert.equal(view.root.querySelector('.jobs-vacancy-image-formats').textContent, 'JPG · PNG · WebP · 4 MB');
  } finally { view.release(); view.dom.window.close(); }
  const vietnamese = mount([photo('11000000-0000-4000-8000-000000000001', {cover:true})], {language:'vi'});
  try {
    assert.equal(vietnamese.root.querySelector('[data-image-crop-open]').textContent, 'Lấp đầy khung');
    assert.equal(vietnamese.root.querySelector('[data-image-replace]').textContent, 'Thay ảnh');
    assert.equal(vietnamese.root.querySelector('[data-cover-badge]').textContent, 'Ảnh bìa');
    assert.equal(vietnamese.root.querySelector('[data-image-cover]'), null);
  } finally { vietnamese.release(); vietnamese.dom.window.close(); }
});

test('multiple photos show which cover is selected', async () => {
  const first = photo('11000000-0000-4000-8000-000000000001', {cover:true, alt_en:'First'});
  const second = photo('11000000-0000-4000-8000-000000000002', {alt_en:'Second'});
  const view = mount([first, second]);
  try {
    const covers = [...view.root.querySelectorAll('[data-image-cover]')];
    assert.equal(covers.length, 2);
    assert.equal(covers[0].getAttribute('aria-pressed'), 'true');
    assert.equal(covers[0].textContent, 'Cover');
    assert.equal(covers[1].textContent, 'Set as cover');
    assert.equal(view.root.querySelectorAll('[data-cover-badge]').length, 1);
    assert.deepEqual([...view.root.querySelector('.jobs-vacancy-image-toolbar').querySelectorAll('button')].slice(0, 4).map(button => button.textContent), ['Cover', 'Replace', 'Fit to Frame', 'Remove']);
    covers[1].click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(view.saved[0].find(image => image.cover).id, second.id);
    assert.equal(view.saved[0].filter(image => image.cover).length, 1);
  } finally { view.release(); view.dom.window.close(); }
});

test('cropping supports drag, zoom, reset, cancel and apply without a new file', async () => {
  const id = '11000000-0000-4000-8000-000000000001';
  const view = mount([photo(id, {cover:true})]);
  try {
    const item = () => view.root.querySelector('[data-saved-image]');
    item().querySelector('[data-image-crop-open]').click();
    const frame = item().querySelector('[data-image-frame]');
    frame.getBoundingClientRect = rect;
    frame.querySelector('img').dispatchEvent(pointer(view.win, 'pointerdown', 100, 90));
    view.win.dispatchEvent(pointer(view.win, 'pointermove', 100, 50));
    view.win.dispatchEvent(pointer(view.win, 'pointerup', 100, 50));
    const zoom = item().querySelector('[data-image-zoom]');
    zoom.value = '2';
    zoom.dispatchEvent(new view.win.Event('input', {bubbles:true}));
    assert.equal(item().querySelector('img').style.width, '200%');
    item().querySelector('[data-image-crop-reset]').click();
    assert.equal(Number(item().querySelector('[data-image-zoom]').value), 1);
    assert.equal(item().querySelector('img').style.width, '100%');
    item().querySelector('[data-image-crop-cancel]').click();
    assert.equal(view.saved.length, 0);
    assert.equal(item().querySelector('[data-image-crop-controls]').hidden, true);
    item().querySelector('[data-image-crop-open]').click();
    const next = item().querySelector('[data-image-frame]');
    next.getBoundingClientRect = rect;
    next.querySelector('img').dispatchEvent(pointer(view.win, 'pointerdown', 160, 90));
    view.win.dispatchEvent(pointer(view.win, 'pointermove', 160, 40));
    view.win.dispatchEvent(pointer(view.win, 'pointerup', 160, 40));
    item().querySelector('[data-image-crop-apply]').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(view.saved.length, 1);
    assert.equal(view.saved[0][0].id, id);
    assert.ok(view.saved[0][0].crop.y > 0.125);
    assert.equal(view.uploaded.length, 0);
    assert.match(vacancyImageCropStyle(view.saved[0][0].crop), framePattern);
  } finally { view.release(); view.dom.window.close(); }
});

test('replace and pending crop keep the original file bytes', async () => {
  const id = '11000000-0000-4000-8000-000000000001';
  const crop = zoomedCrop(1600, 1200, coverCrop(1600, 1200), 2);
  const view = mount([photo(id, {cover:true, crop})]);
  const file = new view.win.File([Uint8Array.from([1, 2, 3, 4])], 'room.png', {type:'image/png'});
  try {
    const input = view.root.querySelector('[data-image-replace-file]');
    input.click = () => {};
    view.root.querySelector('[data-image-replace]').click();
    Object.defineProperty(input, 'files', {configurable:true, value:[file]});
    input.dispatchEvent(new view.win.Event('change', {bubbles:true}));
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(view.uploaded[0], file);
    assert.equal(view.saved[0][0].id, '22000000-0000-4000-8000-000000000099');
    assert.equal(view.saved[0][0].crop, undefined);
    assert.equal(view.saved[0][0].alt_en, 'Classroom');
    assert.equal(view.saved[0][0].cover, true);
  } finally { view.release(); view.dom.window.close(); }

  const files = [];
  const fresh = mount([], {upload:async (_id, uploadedFile) => {
    files.push(uploadedFile);
    return {id:'33000000-0000-4000-8000-000000000099', width:1600, height:900};
  }});
  const pendingFile = new fresh.win.File([Uint8Array.from([5, 6, 7, 8])], 'wide.png', {type:'image/png'});
  fresh.win.URL.createObjectURL = () => 'blob:room';
  fresh.win.URL.revokeObjectURL = () => {};
  fresh.win.Image = class {
    set src(value) { this.currentSrc = value; }
    decode() { return Promise.resolve(); }
    get naturalWidth() { return 1600; }
    get naturalHeight() { return 900; }
  };
  try {
    const picker = fresh.root.querySelector('[data-image-file]');
    Object.defineProperty(picker, 'files', {configurable:true, value:[pendingFile]});
    picker.dispatchEvent(new fresh.win.Event('change', {bubbles:true}));
    fresh.root.querySelector('[data-image-alt="en"]').value = 'Wide room';
    fresh.root.querySelector('[data-image-alt="vi"]').value = 'Phòng rộng';
    fresh.root.querySelector('[data-image-crop-open]').click();
    for (let attempt = 0; attempt < 20 && fresh.root.querySelector('[data-image-crop-controls]').hidden; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    assert.equal(fresh.root.querySelector('[data-image-crop-controls]').hidden, false);
    const zoom = fresh.root.querySelector('[data-image-zoom]');
    zoom.value = '2';
    zoom.dispatchEvent(new fresh.win.Event('input', {bubbles:true}));
    fresh.root.querySelector('[data-image-crop-apply]').click();
    fresh.root.querySelector('[data-image-upload]').click();
    const payload = await new Promise((resolve, reject) => {
      const started = Date.now();
      const timer = setInterval(() => {
        if (fresh.saved.length) { clearInterval(timer); resolve(fresh.saved[0]); }
        else if (Date.now() - started > 1000) { clearInterval(timer); reject(new Error('upload did not save')); }
      }, 10);
    });
    assert.equal(files[0], pendingFile);
    assert.equal(payload[0].id, '33000000-0000-4000-8000-000000000099');
    assert.equal(payload[0].crop.w, 0.5);
    assert.equal(payload[0].crop.h, 0.5);
  } finally { fresh.release(); fresh.dom.window.close(); }
});

test('draft save keeps one original image and its crop settings', async () => {
  const pg = new PGlite();
  const admin = '41000000-0000-4000-8000-000000000001';
  try {
    await pg.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;
      create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,deleted_at timestamptz,is_anonymous boolean default false,banned_until timestamptz);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth,storage to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
      alter table storage.objects enable row level security;grant select,insert,update,delete on storage.objects to anon,authenticated;`);
    await pg.query('insert into auth.users values($1,$2,now())', [admin, 'crop@example.test']);
    const migrations = (await readdir(new URL('../supabase/migrations/', import.meta.url))).filter(file => file.endsWith('.sql')).sort();
    await pg.exec(await readFile(new URL(`../supabase/migrations/${migrations[0]}`, import.meta.url), 'utf8'));
    await pg.query("insert into jobs_private.staff_members(user_id,role) values($1,'admin')", [admin]);
    const as = async signedIn => {
      await pg.exec('reset role');
      await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [signedIn ? admin : '']);
      await pg.exec(`set role ${signedIn ? 'authenticated' : 'anon'}`);
    };
    await as(true);
    await pg.exec('reset role');
    for (const filename of migrations.slice(1)) await pg.exec(await readFile(new URL(`../supabase/migrations/${filename}`, import.meta.url), 'utf8'));
    await as(true);
    const one = async (sql, params = []) => (await pg.query(sql, params)).rows[0];
    const draft = await one('select * from public.jobs_cms_save($1,null)', [{...emptyEntry('vacancy'), slug:'crop-photo', title_en:'Crop photo'}]);
    const reserved = await one("select public.jobs_vacancy_image_reserve($1,'image/webp',128,1600,1200) as id", [draft.id]);
    await pg.exec('reset role');
    await pg.query("insert into storage.objects(bucket_id,name) values('jobs-vacancy-images',$1)", [reserved.id]);
    await pg.exec('set role service_role');
    assert.equal((await one('select public.jobs_vacancy_image_ready($1) as ready', [reserved.id])).ready, true);
    await as(true);
    const crop = zoomedCrop(1600, 1200, coverCrop(1600, 1200), 1.5);
    const image = {id:reserved.id, width:1600, height:1200, alt_en:'Room', alt_vi:'Phòng', cover:true, crop};
    const saved = await one('select * from public.jobs_cms_save($1,$2)', [{...draft, data:{vacancy_images:[image]}}, draft.version]);
    const stored = saved.data.vacancy_images[0];
    assert.equal(stored.id, reserved.id);
    for (const key of ['x', 'y', 'w', 'h']) assert.ok(Math.abs(Number(stored.crop[key]) - crop[key]) < 0.00002, key);
    await assert.rejects(() => one('select * from public.jobs_cms_save($1,$2)', [{
      ...saved, data:{vacancy_images:[{...image, crop:{x:0, y:0, w:1, h:1}}]},
    }, saved.version]), /vacancy_image_invalid/);
    await assert.rejects(() => one('select * from public.jobs_cms_save($1,$2)', [{
      ...saved, data:{vacancy_images:[{...image, crop:{...crop, z:1}}]},
    }, saved.version]), /vacancy_image_invalid/);
    const plain = await one('select * from public.jobs_cms_save($1,$2)', [{
      ...saved, data:{vacancy_images:[{...image, crop:undefined}]},
    }, saved.version]);
    assert.equal(plain.data.vacancy_images[0].crop, undefined);
    assert.equal(plain.data.vacancy_images[0].id, reserved.id);
    await pg.exec('reset role');
    assert.equal((await one('select count(*)::int n from jobs_private.vacancy_images')).n, 1);
  } finally { await pg.close(); }
});

test('permanent delete removes the row only after the photo is gone', async () => {
  const id = '11000000-0000-4000-8000-000000000001';
  const dom = new JSDOM('<section id="editor"></section>', {url:'https://jobs.example/portal.html'});
  const root = dom.window.document.getElementById('editor');
  dom.window.confirm = () => true;
  const image = {id, width:32, height:32, alt_en:'Room', alt_vi:'Phòng', published:false};
  let listed = [image], attempts = 0;
  const release = mountVacancyImageEditor(root, {
    record:{id:'vacancy-1', data:{}},
    language:'en', editable:true,
    preview:async () => 'https://files.example/photo',
    upload:async () => { throw new Error('unused'); },
    changeImages() {},
    save:async () => {},
    removed:async () => listed.map(item => ({...item})),
    forget:async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('jobs.vacancy_image_delete_failed');
      listed = [];
    },
  });
  const until = async check => {
    const start = Date.now();
    while (Date.now() - start < 1000) {
      if (check()) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('timed out');
  };
  try {
    await until(() => root.querySelector(`[data-removed-image="${id}"] [data-image-forget]`));
    root.querySelector(`[data-removed-image="${id}"] [data-image-forget]`).click();
    await until(() => root.querySelector('[data-image-status]').textContent === 'The photo could not be deleted. Try again.');
    assert.ok(root.querySelector(`[data-removed-image="${id}"]`));
    root.querySelector(`[data-removed-image="${id}"] [data-image-forget]`).click();
    await until(() => root.querySelector('[data-image-status]').textContent === 'Photo permanently deleted.');
    assert.equal(root.querySelector(`[data-removed-image="${id}"]`), null);
    assert.equal(root.querySelector('[data-removed-list]').hidden, true);
  } finally { release(); dom.window.close(); }
});
