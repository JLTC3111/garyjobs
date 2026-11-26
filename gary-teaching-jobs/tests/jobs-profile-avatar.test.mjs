import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {mountJobsAccountMenu} from '../dist/jobs-account-menu.js';
import {mountJobsProfileAvatar} from '../dist/jobs-profile-avatar.js';

const html = await readFile(new URL('../dist/portal.html', import.meta.url), 'utf8');
const id = 'b0000000-0000-4000-8000-000000000001';
const user = {id, email: 'test@example.test', user_metadata: {full_name: 'Mai Ly'}};
const tick = () => new Promise(resolve => setImmediate(resolve));

test('a Jobs identity uses one private avatar in the Staff and Candidate portals', async () => {
  let active, revision = 0, serial = 0, failSave = false;
  const photoDownloads = [], writes = [], notices = [];
  const windows = [];
  function portal(access, language) {
    const {window} = new JSDOM(html, {url: 'https://jobs.example.test/portal.html?access=' + access});
    windows.push(window);
    const doc = window.document, get = id => doc.getElementById(id);
    window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event('close')); };
    window.URL.createObjectURL = () => `blob:https://jobs.example.test/${++serial}`;
    window.URL.revokeObjectURL = () => {};
    window.Image = class { naturalWidth = 1600; naturalHeight = 800; async decode() {} };
    const canvas = get('profile-avatar-canvas'), draws = [], output = [];
    canvas.getContext = () => ({clearRect() {}, drawImage(_image, ...crop) { draws.push(crop); }});
    canvas.toBlob = (callback, mime) => {
      output.push(new window.Blob(['cropped webp'], {type: mime}));
      callback(output.at(-1));
    };
    const db = {
      from(table) {
        assert.equal(table, 'jobs_avatar_profiles');
        return {select: () => ({in: async (column, ids) => {
          assert.equal(column, 'user_id');
          assert.deepEqual(ids, [id]);
          return {data: active ? [active] : []};
        }})};
      },
      storage: {from(bucket) {
        assert.equal(bucket, 'gary-jobs-profile-photos');
        return {async download(path) {
          assert.equal(path, active.path);
          photoDownloads.push(path);
          return {data: new window.Blob(['private avatar'], {type: 'image/webp'})};
        }};
      }},
      functions: {async invoke(name, options) {
        assert.equal(name, 'jobs-profile-avatar');
        const headers = options.headers;
        assert.equal(headers['x-avatar-owner'], id);
        assert.equal(headers['x-avatar-version'], active?.version || 'none');
        writes.push(options);
        if (failSave) return {error: {context: {status: 502}}};
        const version = 'b0000000-0000-4000-8000-' + String(++revision + 1).padStart(12, '0');
        active = {user_id: id, version, path: options.method === 'DELETE' ? null : `${id}/${version}.webp`};
        return {data: {ok: true, ...active}};
      }},
    };
    const root = get('portal-account'), dialog = get('jobs-photo-dialog');
    const menu = mountJobsAccountMenu(root, {showGuest: false, editPhoto: trigger => editor.open(trigger)});
    const update = photo => menu.update({user, language, caps: access === 'staff' ? {read: true, role: 'editor'} : {}, photo});
    const editor = mountJobsProfileAvatar(dialog, {db, language: () => language, notify: message => notices.push(message), onPhotoChange: update});
    update('');
    editor.account(user);
    const select = async () => {
      const input = get('profile-avatar-file');
      Object.defineProperty(input, 'files', {configurable: true, value: [{name: 'original.png', type: 'image/png', size: 1400000}]});
      input.dispatchEvent(new window.Event('change'));
      await tick();
    };
    return {editor, dialog, root, get, select, draws, output, photo: () => root.querySelector('summary img'),
      open: () => root.querySelector('[data-jobs-photo-edit]').click()};
  }

  try {
    const candidate = portal('candidate', 'en');
    await tick();
    assert.equal(candidate.photo(), null);
    candidate.open();
    assert.equal(candidate.dialog.open, true);
    await candidate.select();
    assert.deepEqual(candidate.draws.at(-1), [400,0,800,800,0,0,512,512]);
    const zoom = candidate.get('profile-avatar-zoom');
    assert.equal(zoom.getAttribute('aria-valuetext'), '100%');
    candidate.get('profile-zoom-in').click();
    assert.equal(zoom.getAttribute('aria-valuetext'), '105%');
    candidate.get('profile-avatar-save').click();
    await tick();
    assert.equal(writes[0].body, candidate.output[0]);
    assert.ok(candidate.photo()?.src.startsWith('blob:'));
    const before = active.path;

    const staff = portal('staff', 'vi');
    await tick();
    assert.deepEqual(photoDownloads, [before]);
    assert.ok(staff.photo()?.src.startsWith('blob:'));
    staff.open();
    assert.equal(staff.get('profile-avatar-title').textContent, 'Ảnh hồ sơ');
    await staff.select();
    failSave = true;
    staff.get('profile-avatar-save').click();
    await tick();
    assert.equal(active.path, before);
    assert.equal(staff.get('profile-avatar-preview').hidden, false);
    assert.deepEqual(notices, ['Profile photo saved.']);

    failSave = false;
    staff.get('profile-avatar-remove').click();
    await tick();
    assert.equal(active.path, null);
    assert.equal(staff.photo(), null);
    assert.deepEqual(notices, ['Profile photo saved.', 'Đã gỡ ảnh hồ sơ.']);
    const reopened = portal('candidate', 'en');
    await tick();
    assert.equal(reopened.photo(), null);
    assert.equal(reopened.get('profile-avatar-remove').hidden, true);
  } finally {
    for (const window of windows) window.close();
  }
});
