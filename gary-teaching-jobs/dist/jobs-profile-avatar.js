import {managedAvatarBucket, mountProfilePhoto, readAvatarReferences, renderAvatar, saveProfilePhoto} from './profile-photo-editor.js';
import {savedJobsAccountName} from './jobs-account-menu.js';

const copy = {
  avatarTitle: ['Profile photo', 'Ảnh hồ sơ'],
  avatarChoose: ['Choose a picture', 'Chọn ảnh'],
  avatarFormats: ['JPG, PNG or WebP. Up to 5 MB.', 'JPG, PNG hoặc WebP. Tối đa 5 MB.'],
  avatarSquarePreview: ['Square crop preview', 'Xem trước ảnh cắt vuông'],
  avatarZoom: ['Crop zoom', 'Thu phóng vùng cắt'],
  avatarZoomOut: ['Zoom out', 'Thu nhỏ'],
  avatarZoomIn: ['Zoom in', 'Phóng to'],
  avatarSave: ['Save picture', 'Lưu ảnh'],
  avatarCancel: ['Cancel crop', 'Hủy cắt ảnh'],
  avatarRemove: ['Remove picture', 'Gỡ ảnh'],
  avatarSaved: ['Profile photo saved.', 'Đã lưu ảnh hồ sơ.'],
  avatarRemoved: ['Profile photo removed.', 'Đã gỡ ảnh hồ sơ.'],
  avatarRetry: ['Retry picture', 'Tải lại ảnh'],
  avatarClose: ['Close', 'Đóng'],
  avatarSignIn: ['Sign in again to change your picture.', 'Hãy đăng nhập lại để cập nhật ảnh.'],
  avatarType: ['Choose a JPG, PNG or WebP picture.', 'Hãy chọn ảnh JPG, PNG hoặc WebP.'],
  avatarSize: ['Choose a picture up to 5 MB.', 'Hãy chọn ảnh tối đa 5 MB.'],
  avatarPreviewError: ['This picture could not be opened.', 'Không thể mở ảnh này.'],
  avatarSaveError: ['The picture could not be updated. Try again.', 'Không thể cập nhật ảnh. Vui lòng thử lại.'],
  avatarLoadError: ['The current picture could not be checked. Try again.', 'Chưa thể kiểm tra ảnh hiện tại. Vui lòng thử lại.'],
  avatarConflict: ['The picture changed in another session. Review it and try again.', 'Ảnh đã thay đổi trong phiên khác. Hãy xem ảnh rồi thử lại.'],
  avatarOutputError: ['Could not make an optimized WebP. Choose a different picture or browser.', 'Không thể tạo ảnh WebP tối ưu. Hãy chọn ảnh khác hoặc đổi trình duyệt.'],
  avatarSetupNeeded: ['Picture uploads are unavailable.', 'Chưa thể tải ảnh lên.'],
};

export function mountJobsProfileAvatar(dialog, {db, language, notify, onPhotoChange}) {
  const close = dialog.querySelector('[data-avatar-close]');
  const preview = dialog.querySelector('[data-avatar-current]');
  const t = key => copy[key]?.[language() === 'vi' ? 1 : 0];
  let user, savedProfile, picture = '', trigger;
  const photo = mountProfilePhoto({
    root: dialog.querySelector('#profile-avatar-controls'), t,
    async read(id) {
      const reference = (await readAvatarReferences(db, 'jobs', [id])).get(id) || {version: null, path: null};
      if (!reference.path) return reference;
      const {data} = await db.storage.from(managedAvatarBucket('jobs')).download(reference.path);
      return {...reference, blob: data};
    },
    savePhoto: (owner, version, body) => saveProfilePhoto(db, 'jobs', owner, version, body),
    notify: key => notify(t(key)),
    onPhotoChange(url) { picture = url; render(); onPhotoChange(url); },
    onBusy: pending => { close.disabled = pending; },
  });

  function render() {
    renderAvatar(preview, savedJobsAccountName(user, savedProfile), picture);
    for (const label of dialog.querySelectorAll('[data-avatar-text]')) {
      label.textContent = t(label.dataset.avatarText);
    }
    photo.render();
  }

  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('cancel', event => { if (photo.isWorking()) event.preventDefault(); });
  dialog.addEventListener('close', () => {
    if (trigger?.isConnected) trigger.focus({preventScroll: true});
    trigger = null;
  });
  return {
    account(next, profile) {
      const changed = next?.id !== user?.id;
      user = next;
      savedProfile = profile;
      if (changed) {
        if (dialog.open) dialog.close();
        void photo.load(user?.id);
      }
      render();
    },
    open(from) {
      if (!user || dialog.open) return;
      trigger = from;
      dialog.showModal();
    },
  };
}
