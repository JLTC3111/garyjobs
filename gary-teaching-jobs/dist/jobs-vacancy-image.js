import {jobsConfig} from './jobs-config.js';

const maxBytes = 4 * 1024 * 1024;
const mimeByExtension = {jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', webp:'image/webp'};
const types = [...new Set(Object.values(mimeByExtension))];
const endpoint = `${jobsConfig.supabaseUrl}/functions/v1/jobs-vacancy-image`;
const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

export function vacancyImage(value) {
  if (typeof value?.id !== 'string' || !uuid.test(value.id) ||
      ![value.width,value.height].every(size => Number.isInteger(size) && size > 0 && size <= 4096) ||
      value.width * value.height > 12000000) return null;
  const en = typeof value.alt_en === 'string' ? value.alt_en.trim().slice(0, 500) : '';
  const vi = typeof value.alt_vi === 'string' ? value.alt_vi.trim().slice(0, 500) : '';
  if (Math.max(en.length, vi.length) < 2) return null;
  return {id:value.id, width:value.width, height:value.height, alt_en:en, alt_vi:vi};
}

const maxImages = 8;

export function editableVacancyImages(data = {}) {
  const legacy = data?.vacancy_image;
  const source = Array.isArray(data?.vacancy_images) ? data.vacancy_images
    : legacy && typeof legacy === 'object' && !Array.isArray(legacy) ? [{...legacy, cover:true}] : [];
  const images = [];
  const seen = new Set();
  for (const item of source) {
    const image = vacancyImage(item);
    if (!image || seen.has(image.id)) continue;
    seen.add(image.id);
    images.push({...image, cover:item?.cover === true});
  }
  if (!images.length) return [];
  if (!images.some(image => image.cover)) images[0].cover = true;
  let covered = false;
  for (const image of images) {
    if (image.cover && !covered) covered = true;
    else image.cover = false;
  }
  return images;
}

function presentVacancyImage(image) {
  return {...image, url:`${endpoint}?image=${image.id}`, alt:[image.alt_en || image.alt_vi, image.alt_vi || image.alt_en]};
}

// Cover first, then the other photos in their saved order.
export function publishedVacancyImages(data) {
  const images = editableVacancyImages(data).map(presentVacancyImage);
  const cover = images.find(image => image.cover) || images[0];
  return cover ? [cover, ...images.filter(image => image.id !== cover.id)] : [];
}

export function publishedVacancyImage(value) {
  const image = vacancyImage(value);
  return image && presentVacancyImage({...image, cover:true});
}

const messages = {
  invalid: ['Choose an intact JPG, PNG or WebP image up to 4096 px on either side.', 'Chọn ảnh JPG, PNG hoặc WebP hợp lệ, mỗi chiều tối đa 4096 px.'],
  file_size: ['Choose an image of 4 MB or less.', 'Chọn ảnh có dung lượng tối đa 4 MB.'],
  alt_required: ['Enter a short description of the image in at least one language.', 'Nhập mô tả ngắn cho ảnh bằng ít nhất một ngôn ngữ.'],
  gallery_full: ['A vacancy can have up to 8 photos.', 'Mỗi tin tuyển dụng có tối đa 8 ảnh.'],
  draft_required: ['Save the vacancy as a draft before uploading an image.', 'Lưu bản nháp tin tuyển dụng trước khi tải ảnh lên.'],
  upload_limit: ['The image upload limit was reached. Try again later.', 'Đã đạt giới hạn tải ảnh lên. Vui lòng thử lại sau.'],
  upload_failed: ['The image could not be uploaded. Try again.', 'Không thể tải ảnh lên. Vui lòng thử lại.'],
  crop_failed: ['This image could not be cropped. Try the original image.', 'Không thể cắt ảnh này. Hãy thử dùng ảnh gốc.'],
  forbidden: ['Your Jobs permissions do not allow this image action.', 'Quyền Jobs của bạn không cho phép thao tác này với ảnh.'],
};
const imageError = code => new Error(`jobs.vacancy_image_${code}`);
export function vacancyImageErrorText(error, language) {
  const message = String(error?.message || '').match(/^jobs\.vacancy_image_([a-z_]+)$/);
  return message ? messages[message[1]]?.[language === 'vi' ? 1 : 0] || '' : '';
}

export async function uploadVacancyImage(db, vacancyId, file, onProgress) {
  const token = (await db.auth.getSession()).data.session?.access_token;
  if (!token) throw imageError('forbidden');
  const type = types.includes(file.type) ? file.type : mimeByExtension[file.name?.split('.').pop().toLowerCase()];
  if (!type) throw imageError('invalid');
  if (file.size < 1 || file.size > maxBytes) throw imageError('file_size');
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${endpoint}?vacancy=${encodeURIComponent(vacancyId)}`);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('apikey', jobsConfig.publishableKey);
    xhr.setRequestHeader('Content-Type', type);
    xhr.responseType = 'json';
    xhr.timeout = 60000;
    xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress(event.loaded / event.total); };
    xhr.onerror = xhr.ontimeout = () => reject(imageError('upload_failed'));
    xhr.onload = () => {
      if (xhr.status === 201) { resolve(xhr.response); return; }
      if ([401,403].includes(xhr.status)) globalThis.dispatchEvent?.(new Event('jobs:access-denied'));
      const code = xhr.response?.code;
      reject(imageError(code === 'invalid_file' ? 'invalid' : messages[code] ? code : 'upload_failed'));
    };
    xhr.send(file);
  });
}

async function cropToLandscape(file, win) {
  const url = win.URL.createObjectURL(file);
  try {
    const image = new win.Image();
    image.src = url;
    await image.decode();
    const {naturalWidth:width,naturalHeight:height} = image;
    if (!width || !height || width * height > 32000000) throw imageError('crop_failed');
    const wide = width / height >= 16 / 9;
    const cropWidth = wide ? height * 16 / 9 : width, cropHeight = wide ? height : width * 9 / 16;
    const canvas = win.document.createElement('canvas');
    canvas.width = Math.min(1600, Math.round(cropWidth));
    canvas.height = Math.max(1, Math.round(canvas.width * 9 / 16));
    const context = canvas.getContext('2d');
    context.drawImage(image, (width-cropWidth)/2, (height-cropHeight)/2, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(imageError('crop_failed')), 'image/webp', 0.88));
  } catch { throw imageError('crop_failed'); }
  finally { win.URL.revokeObjectURL(url); }
}

function galleryPayload(images) {
  const clean = [];
  for (const image of images) {
    const parsed = vacancyImage(image);
    if (!parsed) return null;
    clean.push({...parsed, cover:image.cover === true});
  }
  if (!clean.length) return [];
  if (clean.length > maxImages) return null;
  let covered = false;
  for (const image of clean) {
    if (image.cover && !covered) covered = true;
    else image.cover = false;
  }
  if (!covered) clean[0].cover = true;
  return clean;
}

export function mountVacancyImageEditor(root, {record, language, editable, preview, upload, changeImages, save}) {
  const t = (en, vi) => language === 'vi' ? vi : en, win = root.ownerDocument.defaultView;
  const message = code => vacancyImageErrorText(imageError(code), language);
  const localizedAlt = ({alt_en, alt_vi}) => (language === 'vi' ? alt_vi : alt_en) || alt_en || alt_vi || '';
  const saved = editableVacancyImages(record.data);
  let disposed = false, pending = [];
  root.className = 'jobs-vacancy-image-editor';
  root.replaceChildren();
  const heading = document.createElement('h3');
  heading.textContent = t('Vacancy photos', 'Ảnh tin tuyển dụng');
  const hint = document.createElement('p');
  hint.className = 'cms-hint';
  hint.textContent = record.id
    ? t('Up to 8 photos. JPG, PNG or WebP, 4 MB each. Describe each photo in at least one language. Choose one cover for the job card. Changes go live when you publish.', 'Tối đa 8 ảnh. JPG, PNG hoặc WebP, mỗi ảnh 4 MB. Mô tả mỗi ảnh bằng ít nhất một ngôn ngữ. Chọn một ảnh bìa cho thẻ việc làm. Thay đổi hiển thị khi bạn xuất bản.')
    : t('Save the vacancy as a draft before uploading photos.', 'Lưu bản nháp tin tuyển dụng trước khi tải ảnh lên.');
  const list = document.createElement('ul');
  list.className = 'jobs-vacancy-image-list';
  list.dataset.imageList = '';
  const status = document.createElement('p');
  status.className = 'cms-hint';
  status.dataset.imageStatus = '';
  status.setAttribute('role', 'status');
  root.append(heading, hint, list);
  const canEdit = editable && record.id;
  let fileInput, uploadButton, progress, crop;
  if (canEdit) {
    const fileLabel = document.createElement('label');
    fileLabel.className = 'cms-field';
    const fileText = document.createElement('span');
    fileText.textContent = t('Add photos', 'Thêm ảnh');
    fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.multiple = true;
    fileInput.accept = 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp';
    fileInput.dataset.imageFile = '';
    fileLabel.append(fileText, fileInput);
    const cropLabel = document.createElement('label');
    cropLabel.className = 'jobs-vacancy-image-crop';
    crop = document.createElement('input');
    crop.type = 'checkbox';
    crop.dataset.imageCrop = '';
    cropLabel.append(crop, document.createTextNode(' ' + t('Center crop to 16:9', 'Cắt giữa ảnh theo tỷ lệ 16:9')));
    const pendingHost = document.createElement('div');
    pendingHost.className = 'jobs-vacancy-image-pending';
    pendingHost.dataset.imagePending = '';
    const actions = document.createElement('div');
    actions.className = 'jobs-vacancy-image-actions';
    uploadButton = document.createElement('button');
    uploadButton.type = 'button';
    uploadButton.dataset.imageUpload = '';
    uploadButton.dataset.buttonVariant = 'save-draft';
    uploadButton.disabled = true;
    uploadButton.textContent = t('Upload and save draft', 'Tải ảnh và lưu bản nháp');
    actions.append(uploadButton);
    progress = document.createElement('progress');
    progress.max = 1;
    progress.dataset.imageProgress = '';
    progress.setAttribute('aria-label', t('Image upload progress', 'Tiến độ tải ảnh'));
    progress.hidden = true;
    root.append(fileLabel, cropLabel, pendingHost, actions, progress);
  }
  root.append(status);
  const find = selector => root.querySelector(selector);
  const altField = (locale, value, savedField) => {
    const label = document.createElement('label');
    label.className = 'cms-field';
    const span = document.createElement('span');
    span.textContent = locale === 'en' ? t('Image description (English)', 'Mô tả ảnh (tiếng Anh)') : t('Image description (Vietnamese)', 'Mô tả ảnh (tiếng Việt)');
    const input = document.createElement('input');
    input.lang = locale;
    input.maxLength = 500;
    input.value = value || '';
    if (savedField) input.dataset.savedAlt = locale;
    else input.dataset.imageAlt = locale;
    label.append(span, input);
    return label;
  };
  const textButton = (name, value, label, danger = false) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset[name] = value;
    if (danger) button.dataset.buttonVariant = 'danger';
    button.textContent = label;
    return button;
  };
  const previewUnavailable = () => { if (!disposed) status.textContent = t('Image preview unavailable.', 'Chưa thể xem trước ảnh.'); };
  const savedFromDom = () => [...root.querySelectorAll('[data-saved-image]')].map(item => ({
    id:item.dataset.savedImage,
    width:Number(item.dataset.width),
    height:Number(item.dataset.height),
    alt_en:item.querySelector('[data-saved-alt="en"]').value.trim(),
    alt_vi:item.querySelector('[data-saved-alt="vi"]').value.trim(),
    cover:item.querySelector('[data-image-cover]').checked,
  }));
  const remember = images => { if (changeImages) changeImages(images); };
  const persist = (images, success) => {
    if (images.length > maxImages) { status.textContent = message('gallery_full'); return; }
    const payload = galleryPayload(images);
    if (!payload) { status.textContent = message('alt_required'); root.querySelector('[data-saved-alt="en"]')?.focus(); return; }
    return save(() => payload, success);
  };
  const showCrop = () => {
    const cropped = !!pending.length && !!crop?.checked;
    root.querySelectorAll('[data-image-preview]').forEach(image => image.classList.toggle('is-cropped', cropped));
  };
  const clearPending = () => {
    for (const item of pending) win.URL.revokeObjectURL(item.url);
    pending = [];
    find('[data-image-pending]')?.replaceChildren();
    if (uploadButton) uploadButton.disabled = true;
    showCrop();
  };
  const renderPending = () => {
    const host = find('[data-image-pending]');
    host.replaceChildren();
    pending.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'jobs-vacancy-image-item';
      row.dataset.pendingRow = String(index);
      const image = document.createElement('img');
      image.dataset.imagePreview = '';
      image.src = item.url;
      image.alt = '';
      row.append(image, altField('en', '', false), altField('vi', '', false));
      host.append(row);
    });
    showCrop();
  };
  const renderSaved = () => {
    list.replaceChildren();
    saved.forEach((image, index) => {
      const item = document.createElement('li');
      item.className = 'jobs-vacancy-image-item';
      item.dataset.savedImage = image.id;
      item.dataset.width = String(image.width);
      item.dataset.height = String(image.height);
      const photo = document.createElement('img');
      photo.alt = localizedAlt(image);
      photo.hidden = true;
      item.append(photo);
      if (canEdit) {
        const cover = document.createElement('label');
        cover.className = 'jobs-vacancy-image-cover';
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'vacancy-image-cover';
        radio.dataset.imageCover = '';
        radio.checked = image.cover;
        const coverText = document.createElement('span');
        coverText.textContent = t('Cover photo', 'Ảnh bìa');
        cover.append(radio, coverText);
        const toolbar = document.createElement('div');
        toolbar.className = 'jobs-vacancy-image-actions';
        const earlier = textButton('imageMove', '-1', t('Earlier', 'Trước'));
        const later = textButton('imageMove', '1', t('Later', 'Sau'));
        const remove = textButton('imageRemove', '', t('Remove photo', 'Xóa ảnh'), true);
        earlier.disabled = index === 0;
        later.disabled = index === saved.length - 1;
        earlier.setAttribute('aria-label', `${t('Move earlier', 'Đưa lên trước')}: ${localizedAlt(image)}`);
        later.setAttribute('aria-label', `${t('Move later', 'Đưa xuống sau')}: ${localizedAlt(image)}`);
        remove.setAttribute('aria-label', `${t('Remove photo', 'Xóa ảnh')}: ${localizedAlt(image)}`);
        toolbar.append(earlier, later, remove);
        item.append(cover, altField('en', image.alt_en, true), altField('vi', image.alt_vi, true), toolbar);
      }
      list.append(item);
      void preview(image.id).then(url => {
        if (disposed || !photo.isConnected) return;
        photo.src = url;
        photo.hidden = false;
      }).catch(() => { if (!disposed && photo.isConnected) previewUnavailable(); });
    });
    if (fileInput) fileInput.disabled = saved.length >= maxImages;
  };
  const pendingEntries = () => [...root.querySelectorAll('[data-pending-row]')].map(row => ({
    file:pending[Number(row.dataset.pendingRow)]?.file,
    alt_en:row.querySelector('[data-image-alt="en"]').value.trim(),
    alt_vi:row.querySelector('[data-image-alt="vi"]').value.trim(),
    altInput:row.querySelector('[data-image-alt="en"]'),
  }));
  renderSaved();
  if (canEdit) {
    const accepted = file => file?.size >= 1 && file.size <= maxBytes && (types.includes(file.type) || mimeByExtension[file.name?.split('.').pop().toLowerCase()]);
    fileInput.addEventListener('change', () => {
      clearPending();
      status.textContent = '';
      const selected = [...(fileInput.files || [])];
      if (!selected.length) return;
      const room = maxImages - root.querySelectorAll('[data-saved-image]').length;
      if (selected.length > room) { fileInput.value = ''; status.textContent = message('gallery_full'); return; }
      const invalid = selected.find(file => !accepted(file));
      if (invalid) {
        fileInput.value = '';
        status.textContent = message(invalid.size > maxBytes ? 'file_size' : 'invalid');
        return;
      }
      pending = selected.map(file => ({file, url:win.URL.createObjectURL(file)}));
      renderPending();
      uploadButton.disabled = false;
      status.textContent = t('Ready to upload and save to the draft.', 'Sẵn sàng tải ảnh lên và lưu vào bản nháp.');
    });
    crop.addEventListener('change', showCrop);
    root.addEventListener('input', event => {
      const pendingAlt = event.target.closest('[data-pending-row]');
      if (pendingAlt && event.target.matches('[data-image-alt]')) {
        const image = pendingAlt.querySelector('[data-image-preview]');
        image.alt = localizedAlt({
          alt_en:pendingAlt.querySelector('[data-image-alt="en"]').value.trim(),
          alt_vi:pendingAlt.querySelector('[data-image-alt="vi"]').value.trim(),
        });
        return;
      }
      if (event.target.matches('[data-saved-alt]')) remember(savedFromDom());
    });
    root.addEventListener('change', event => {
      if (!event.target.matches('[data-image-cover]')) return;
      void persist(savedFromDom(), t('Cover photo saved to draft.', 'Đã lưu ảnh bìa vào bản nháp.'));
    });
    root.addEventListener('click', event => {
      const move = event.target.closest('[data-image-move]');
      const remove = event.target.closest('[data-image-remove]');
      if (!move && !remove) return;
      const images = savedFromDom();
      if (remove) {
        const id = remove.closest('[data-saved-image]')?.dataset.savedImage;
        const next = images.filter(image => image.id !== id);
        void persist(next, t('Photo removed from draft.', 'Đã xóa ảnh khỏi bản nháp.'));
        return;
      }
      const index = images.findIndex(image => image.id === move.closest('[data-saved-image]')?.dataset.savedImage);
      const target = index + Number(move.dataset.imageMove);
      if (index < 0 || target < 0 || target >= images.length) return;
      const [image] = images.splice(index, 1);
      images.splice(target, 0, image);
      void persist(images, t('Photo order saved to draft.', 'Đã lưu thứ tự ảnh vào bản nháp.'));
    });
    uploadButton.addEventListener('click', async () => {
      const entries = pendingEntries();
      if (!entries.length) return;
      const missing = entries.find(entry => Math.max(entry.alt_en.length, entry.alt_vi.length) < 2);
      if (missing) { status.textContent = message('alt_required'); missing.altInput.focus(); return; }
      const existing = galleryPayload(savedFromDom());
      if (!existing) { status.textContent = message('alt_required'); root.querySelector('[data-saved-alt="en"]')?.focus(); return; }
      if (existing.length + entries.length > maxImages) { status.textContent = message('gallery_full'); return; }
      const shouldCrop = crop.checked;
      await save(async () => {
        progress.hidden = false;
        progress.removeAttribute('value');
        status.textContent = t('Uploading image…', 'Đang tải ảnh lên…');
        const added = [];
        for (let index = 0; index < entries.length; index += 1) {
          const normalized = shouldCrop ? await cropToLandscape(entries[index].file, win) : entries[index].file;
          const uploaded = await upload(record.id, normalized, fraction => { progress.value = (index + fraction) / entries.length; });
          const attached = vacancyImage({...uploaded, alt_en:entries[index].alt_en, alt_vi:entries[index].alt_vi});
          if (!attached) throw imageError('upload_failed');
          added.push({...attached, cover:false});
        }
        const next = galleryPayload([...existing, ...added]);
        if (!next?.length) throw imageError('upload_failed');
        status.textContent = t('Saving draft…', 'Đang lưu bản nháp…');
        return next;
      }, t('Vacancy photos saved to draft.', 'Đã lưu ảnh vào bản nháp.'));
      if (!disposed) { progress.hidden = true; status.textContent = ''; }
    });
  }
  return () => { disposed = true; clearPending(); };
}
