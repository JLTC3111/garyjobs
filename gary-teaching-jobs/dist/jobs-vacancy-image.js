import {jobsConfig} from './jobs-config.js';
import {editorialPhoto,imageOptimizationErrorText,optimizeImage} from './image-optimization.js';

const maxBytes = 4 * 1024 * 1024;
const mimeByExtension = {jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', webp:'image/webp'};
const types = [...new Set(Object.values(mimeByExtension))];
const endpoint = `${jobsConfig.supabaseUrl}/functions/v1/jobs-vacancy-image`;
const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const frameRatio = 16 / 9;
const maxZoom = 4;
const framePattern = /^left:-?\d+(?:\.\d+)?%;top:-?\d+(?:\.\d+)?%;width:\d+(?:\.\d+)?%;height:\d+(?:\.\d+)?%$/;

const round5 = value => Math.round((value + Number.EPSILON) * 100000) / 100000;
const aspectError = (width, height, crop) => Math.abs((crop.w * width) / (crop.h * height) - frameRatio);
const finite = value => {
  const number = typeof value === 'number' ? value : typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value) ? Number(value) : NaN;
  return Number.isFinite(number) ? number : NaN;
};

export function coverCrop(width, height) {
  if (!(width > 0) || !(height > 0)) return null;
  const imageRatio = width / height;
  if (imageRatio >= frameRatio) {
    const w = frameRatio / imageRatio;
    return {x: round5((1 - w) / 2), y: 0, w: round5(w), h: 1};
  }
  const h = imageRatio / frameRatio;
  return {x: 0, y: round5((1 - h) / 2), w: 1, h: round5(h)};
}

function placedCrop(width, height, crop) {
  const cover = coverCrop(width, height);
  if (!cover || !crop) return null;
  const x = finite(crop.x), y = finite(crop.y), w = finite(crop.w), h = finite(crop.h);
  if (![x, y, w, h].every(Number.isFinite) || !(w > 0) || !(h > 0)) return null;
  if (aspectError(width, height, {w, h}) > 0.02) return null;
  const minW = cover.w / maxZoom;
  if (w > cover.w * 1.02 || w < minW * 0.98) return null;
  if (x < -0.02 || y < -0.02 || x + w > 1.02 || y + h > 1.02) return null;
  const next = {
    x: round5(Math.min(Math.max(x, 0), Math.max(0, 1 - w))),
    y: round5(Math.min(Math.max(y, 0), Math.max(0, 1 - h))),
    w: round5(w),
    h: round5(h),
  };
  if (next.w <= 0 || next.h <= 0 || next.x < 0 || next.y < 0 || next.x + next.w > 1.001 || next.y + next.h > 1.001) return null;
  return next;
}

export function vacancyImageCrop(value, width, height) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (Object.keys(value).some(key => !['x', 'y', 'w', 'h'].includes(key))) return null;
  return placedCrop(width, height, value);
}

export function zoomedCrop(width, height, crop, zoom) {
  const cover = coverCrop(width, height);
  const base = crop || cover;
  if (!cover || !base) return null;
  const z = Math.min(maxZoom, Math.max(1, finite(zoom) || 1));
  const w = cover.w / z;
  const h = (w * width * 9) / (height * 16);
  const cx = base.x + base.w / 2;
  const cy = base.y + base.h / 2;
  return placedCrop(width, height, {
    x: Math.min(Math.max(cx - w / 2, 0), Math.max(0, 1 - w)),
    y: Math.min(Math.max(cy - h / 2, 0), Math.max(0, 1 - h)),
    w, h,
  });
}

export function cropZoom(width, height, crop) {
  const cover = coverCrop(width, height);
  if (!cover?.w || !crop?.w) return 1;
  return Math.min(maxZoom, Math.max(1, cover.w / crop.w));
}

export function panCropByPointer(crop, dx, dy, frameWidth, frameHeight, width, height) {
  if (!crop || !(frameWidth > 0) || !(frameHeight > 0)) return crop || null;
  const x = Math.min(Math.max(crop.x - (dx / frameWidth) * crop.w, 0), Math.max(0, 1 - crop.w));
  const y = Math.min(Math.max(crop.y - (dy / frameHeight) * crop.h, 0), Math.max(0, 1 - crop.h));
  return placedCrop(width, height, {x, y, w: crop.w, h: crop.h}) || crop;
}

export function vacancyImageCropStyle(crop) {
  if (!crop?.w || !crop?.h) return '';
  const n = value => Number(value.toFixed(4));
  const style = `left:${n(-crop.x / crop.w * 100)}%;top:${n(-crop.y / crop.h * 100)}%;width:${n(100 / crop.w)}%;height:${n(100 / crop.h)}%`;
  return framePattern.test(style) ? style : '';
}

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
    const crop = vacancyImageCrop(item?.crop, image.width, image.height);
    images.push({...image, cover:item?.cover === true, ...(crop ? {crop} : {})});
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
  const frame = vacancyImageCropStyle(image.crop);
  return {...image, url:`${endpoint}?image=${image.id}`, alt:[image.alt_en || image.alt_vi, image.alt_vi || image.alt_en], ...(frame ? {frame} : {})};
}

// Cover first, then the other photos in their saved order.
export function publishedVacancyImages(data) {
  const images = editableVacancyImages(data).map(presentVacancyImage);
  const cover = images.find(image => image.cover) || images[0];
  return cover ? [cover, ...images.filter(image => image.id !== cover.id)] : [];
}

export function publishedVacancyImage(value) {
  const image = vacancyImage(value);
  if (!image) return null;
  const crop = vacancyImageCrop(value?.crop, image.width, image.height);
  return presentVacancyImage({...image, cover:true, ...(crop ? {crop} : {})});
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
  in_use: ['Publish the removal before deleting this photo permanently.', 'Hãy xuất bản việc xóa ảnh trước khi xóa vĩnh viễn.'],
  delete_failed: ['The photo could not be deleted. Try again.', 'Không thể xóa ảnh. Vui lòng thử lại.'],
  removed_failed: ['Removed photos could not be loaded. Try again.', 'Không thể tải ảnh đã xóa. Vui lòng thử lại.'],
};
const imageError = code => new Error(`jobs.vacancy_image_${code}`);
export function vacancyImageErrorText(error, language) {
  const message = String(error?.message || '').match(/^jobs\.vacancy_image_([a-z_]+)$/);
  return imageOptimizationErrorText(error,language) || (message ? messages[message[1]]?.[language === 'vi' ? 1 : 0] || '' : '');
}

export async function uploadVacancyImage(db, vacancyId, file, onProgress) {
  const start = (await db.auth.getSession()).data.session;
  if (!start?.access_token) throw imageError('forbidden');
  const type = types.includes(file.type) ? file.type : mimeByExtension[file.name?.split('.').pop().toLowerCase()];
  if (!type) throw imageError('invalid');
  if (file.size < 1 || file.size > maxBytes) throw imageError('file_size');
  const photo = await optimizeImage(file,editorialPhoto,{inputMax:maxBytes,types,stillOnly:true});
  const session = (await db.auth.getSession()).data.session;
  if (!session?.access_token || session.user?.id !== start.user?.id) throw imageError('forbidden');
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${endpoint}?vacancy=${encodeURIComponent(vacancyId)}`);
    xhr.setRequestHeader('Authorization', `Bearer ${session.access_token}`);
    xhr.setRequestHeader('apikey', jobsConfig.publishableKey);
    xhr.setRequestHeader('Content-Type', photo.contentType);
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
    xhr.send(photo.body);
  });
}

export async function forgetVacancyImage(db, imageId) {
  const token = (await db.auth.getSession()).data.session?.access_token;
  if (!token) throw imageError('forbidden');
  let response;
  try {
    response = await fetch(`${endpoint}?forget=${encodeURIComponent(imageId)}`, {
      method: 'POST',
      headers: {authorization: `Bearer ${token}`, apikey: jobsConfig.publishableKey},
    });
  } catch { throw imageError('delete_failed'); }
  if (response.ok) return response.json();
  if ([401, 403].includes(response.status)) {
    globalThis.dispatchEvent?.(new Event('jobs:access-denied'));
    throw imageError('forbidden');
  }
  const body = await response.json().catch(() => ({}));
  throw imageError(messages[body.code] ? body.code : 'delete_failed');
}

function galleryPayload(images) {
  const clean = [];
  for (const image of images) {
    const parsed = vacancyImage(image);
    if (!parsed) return null;
    const next = {...parsed, cover:image.cover === true};
    if (image.crop != null) {
      const crop = vacancyImageCrop(image.crop, parsed.width, parsed.height);
      if (!crop) return false;
      next.crop = crop;
    }
    clean.push(next);
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

export function mountVacancyImageEditor(root, {record, language, editable, preview, upload, changeImages, save, removed, forget}) {
  const t = (en, vi) => language === 'vi' ? vi : en, win = root.ownerDocument.defaultView;
  const message = code => vacancyImageErrorText(imageError(code), language);
  const localizedAlt = ({alt_en, alt_vi}) => (language === 'vi' ? alt_vi : alt_en) || alt_en || alt_vi || '';
  const saved = editableVacancyImages(record.data);
  let disposed = false, pending = [], session = null, replaceTarget = null;
  root.className = 'jobs-vacancy-image-editor';
  root.replaceChildren();
  const heading = win.document.createElement('h3');
  heading.textContent = t('Vacancy photos', 'Ảnh tin tuyển dụng');
  const hint = win.document.createElement('p');
  hint.className = 'cms-hint';
  hint.textContent = record.id
    ? t('Up to 8 photos. JPG, PNG or WebP, 4 MB each. JPG and PNG are saved as WebP at the same size. Describe each photo in at least one language. Crop to 16:9 keeps the original file. Choose a cover when there is more than one photo. Changes go live when you publish.', 'Tối đa 8 ảnh. JPG, PNG hoặc WebP, mỗi ảnh 4 MB. Ảnh JPG và PNG được lưu thành WebP với cùng kích thước. Mô tả mỗi ảnh bằng ít nhất một ngôn ngữ. Cắt 16:9 vẫn giữ tệp gốc. Chọn ảnh bìa khi có nhiều hơn một ảnh. Thay đổi hiển thị khi bạn xuất bản.')
    : t('Save the vacancy as a draft before uploading photos.', 'Lưu bản nháp tin tuyển dụng trước khi tải ảnh lên.');
  const list = win.document.createElement('ul');
  list.className = 'jobs-vacancy-image-list';
  list.dataset.imageList = '';
  const status = win.document.createElement('p');
  status.className = 'cms-hint';
  status.dataset.imageStatus = '';
  status.setAttribute('role', 'status');
  const removedHost = win.document.createElement('section');
  removedHost.className = 'jobs-vacancy-image-removed';
  removedHost.hidden = true;
  removedHost.dataset.removedList = '';
  root.append(heading, hint, list);
  const canEdit = editable && record.id;
  let fileInput, uploadButton, progress, replaceInput;
  if (canEdit) {
    const pendingHost = win.document.createElement('div');
    pendingHost.className = 'jobs-vacancy-image-pending';
    pendingHost.dataset.imagePending = '';
    const add = win.document.createElement('div');
    add.className = 'jobs-vacancy-image-add';
    const fileLabel = win.document.createElement('label');
    fileLabel.className = 'cms-field';
    const fileText = win.document.createElement('span');
    fileText.textContent = t('Add photos', 'Thêm ảnh');
    fileInput = win.document.createElement('input');
    fileInput.type = 'file';
    fileInput.multiple = true;
    fileInput.accept = 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp';
    fileInput.dataset.imageFile = '';
    fileLabel.append(fileText, fileInput);
    const formats = win.document.createElement('p');
    formats.className = 'jobs-vacancy-image-formats';
    formats.textContent = 'JPG · PNG · WebP · 4 MB';
    add.append(fileLabel, formats);
    const actions = win.document.createElement('div');
    actions.className = 'jobs-vacancy-image-actions';
    uploadButton = win.document.createElement('button');
    uploadButton.type = 'button';
    uploadButton.dataset.imageUpload = '';
    uploadButton.dataset.buttonVariant = 'save-draft';
    uploadButton.disabled = true;
    uploadButton.textContent = t('Upload and save draft', 'Tải ảnh và lưu bản nháp');
    actions.append(uploadButton);
    progress = win.document.createElement('progress');
    progress.max = 1;
    progress.dataset.imageProgress = '';
    progress.setAttribute('aria-label', t('Image upload progress', 'Tiến độ tải ảnh'));
    progress.hidden = true;
    replaceInput = win.document.createElement('input');
    replaceInput.type = 'file';
    replaceInput.accept = fileInput.accept;
    replaceInput.dataset.imageReplaceFile = '';
    replaceInput.hidden = true;
    root.append(pendingHost, add, actions, progress, replaceInput);
  }
  root.append(removedHost, status);
  const find = selector => root.querySelector(selector);
  const altField = (locale, value, savedField) => {
    const label = win.document.createElement('label');
    label.className = 'cms-field';
    const span = win.document.createElement('span');
    span.textContent = locale === 'en' ? t('Image description (English)', 'Mô tả ảnh (tiếng Anh)') : t('Image description (Vietnamese)', 'Mô tả ảnh (tiếng Việt)');
    const input = win.document.createElement('input');
    input.lang = locale;
    input.maxLength = 500;
    input.value = value || '';
    if (savedField) input.dataset.savedAlt = locale;
    else input.dataset.imageAlt = locale;
    label.append(span, input);
    return label;
  };
  const actionIcons = {
    replace: [['path', {d:'M14 4a1 1 0 0 1 1-1'}], ['path', {d:'M15 10a1 1 0 0 1-1-1'}], ['path', {d:'M21 4a1 1 0 0 0-1-1'}], ['path', {d:'M21 9a1 1 0 0 1-1 1'}], ['path', {d:'m3 7 3 3 3-3'}], ['path', {d:'M6 10V5a2 2 0 0 1 2-2h2'}], ['rect', {x:'3', y:'14', width:'7', height:'7', rx:'1'}]],
    crop: [['path', {d:'M6 2v14a2 2 0 0 0 2 2h14'}], ['path', {d:'M18 22V8a2 2 0 0 0-2-2H2'}]],
    'trash-2': [['path', {d:'M10 11v6'}], ['path', {d:'M14 11v6'}], ['path', {d:'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6'}], ['path', {d:'M3 6h18'}], ['path', {d:'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'}]],
    'arrow-up': [['path', {d:'m5 12 7-7 7 7'}], ['path', {d:'M12 19V5'}]],
    'arrow-down': [['path', {d:'M12 5v14'}], ['path', {d:'m19 12-7 7-7-7'}]],
  };
  const actionIcon = name => {
    const svg = win.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', `lucide lucide-${name}`);
    svg.dataset.lucide = name;
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    for (const [tag, attrs] of actionIcons[name]) {
      const node = win.document.createElementNS('http://www.w3.org/2000/svg', tag);
      for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
      svg.append(node);
    }
    return svg;
  };
  const textButton = (name, value, label, variant, icon) => {
    const button = win.document.createElement('button');
    button.type = 'button';
    button.dataset[name] = value;
    if (variant) button.dataset.buttonVariant = variant;
    if (icon) button.append(actionIcon(icon));
    button.append(win.document.createTextNode(label));
    return button;
  };
  const previewUnavailable = () => { if (!disposed) status.textContent = t('Image preview unavailable.', 'Chưa thể xem trước ảnh.'); };
  const readStoredCrop = item => {
    if (!item?.dataset.crop) return null;
    try { return vacancyImageCrop(JSON.parse(item.dataset.crop), Number(item.dataset.width), Number(item.dataset.height)); }
    catch { return null; }
  };
  const savedFromDom = () => [...root.querySelectorAll('[data-saved-image]')].map(item => {
    const crop = readStoredCrop(item);
    const coverButton = item.querySelector('[data-image-cover]');
    return {
      id:item.dataset.savedImage,
      width:Number(item.dataset.width),
      height:Number(item.dataset.height),
      alt_en:item.querySelector('[data-saved-alt="en"]').value.trim(),
      alt_vi:item.querySelector('[data-saved-alt="vi"]').value.trim(),
      cover:coverButton ? coverButton.getAttribute('aria-pressed') === 'true' : true,
      ...(crop ? {crop} : {}),
    };
  });
  const remember = images => { if (changeImages) changeImages(images); };
  const persist = (images, success) => {
    if (images.length > maxImages) { status.textContent = message('gallery_full'); return; }
    const payload = galleryPayload(images);
    if (payload === false) { status.textContent = message('crop_failed'); return; }
    if (!payload) { status.textContent = message('alt_required'); root.querySelector('[data-saved-alt="en"], [data-image-alt="en"]')?.focus(); return; }
    return save(() => payload, success);
  };
  const placeImage = (img, crop) => {
    const style = crop ? vacancyImageCropStyle(crop) : '';
    if (!style) {
      img.classList.add('is-fit');
      img.classList.remove('is-framed');
      img.style.left = img.style.top = img.style.width = img.style.height = '';
      return;
    }
    img.classList.remove('is-fit');
    img.classList.add('is-framed');
    for (const part of style.split(';')) {
      const index = part.indexOf(':');
      img.style[part.slice(0, index)] = part.slice(index + 1);
    }
  };
  const measure = url => {
    const image = new win.Image();
    image.src = url;
    const ready = typeof image.decode === 'function' ? image.decode() : new Promise((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(imageError('crop_failed'));
    });
    return ready.then(() => {
      if (!image.naturalWidth || !image.naturalHeight) throw imageError('crop_failed');
      return {width:image.naturalWidth, height:image.naturalHeight};
    });
  };
  const paintSession = () => {
    if (!session) return;
    placeImage(session.image, session.crop);
    const zoom = session.bar.querySelector('[data-image-zoom]');
    if (win.document.activeElement !== zoom) zoom.value = String(cropZoom(session.width, session.height, session.crop));
  };
  const rememberPendingText = item => {
    if (!item) return;
    const row = root.querySelector(`[data-pending-row="${pending.indexOf(item)}"]`);
    if (!row) return;
    item.alt_en = row.querySelector('[data-image-alt="en"]')?.value || '';
    item.alt_vi = row.querySelector('[data-image-alt="vi"]')?.value || '';
  };
  const cancelCrop = () => {
    if (!session) return;
    if (session.kind === 'pending') rememberPendingText(pending[session.index]);
    const kind = session.kind;
    session = null;
    if (kind === 'pending') renderPending();
    else renderSaved();
  };
  const openCrop = (item, spec) => {
    if (session) cancelCrop();
    const frame = item.querySelector('[data-image-frame]');
    const image = frame?.querySelector('img');
    const bar = item.querySelector('[data-image-crop-controls]');
    const crop = spec.crop || coverCrop(spec.width, spec.height);
    if (!frame || !image || !bar || !crop) { status.textContent = message('crop_failed'); return; }
    session = {...spec, crop, frame, image, bar, item};
    bar.hidden = false;
    frame.classList.add('is-cropping');
    frame.tabIndex = 0;
    frame.setAttribute('role', 'group');
    frame.setAttribute('aria-label', t('Drag to reposition the 16:9 crop. Arrow keys move it.', 'Kéo để chỉnh vùng cắt 16:9. Phím mũi tên để di chuyển.'));
    paintSession();
    const opener = item.querySelector('[data-image-crop-open]');
    if (opener) opener.setAttribute('aria-pressed', 'true');
    item.querySelectorAll('.jobs-vacancy-image-toolbar button:not([data-image-crop-open])').forEach(button => { button.disabled = true; });
    frame.focus();
  };
  const applyCrop = () => {
    if (!session) return;
    if (session.kind === 'pending') {
      const item = pending[session.index];
      const row = session.item;
      if (item) {
        item.crop = session.crop;
        item.alt_en = row.querySelector('[data-image-alt="en"]')?.value || '';
        item.alt_vi = row.querySelector('[data-image-alt="vi"]')?.value || '';
      }
      session = null;
      renderPending();
      status.textContent = t('Crop ready to upload.', 'Vùng cắt sẵn sàng để tải lên.');
      return;
    }
    const images = savedFromDom();
    const image = images.find(item => item.id === session.id);
    const crop = image && vacancyImageCrop(session.crop, image.width, image.height);
    if (!image || !crop) { status.textContent = message('crop_failed'); return; }
    image.crop = crop;
    persist(images, t('Crop saved to draft.', 'Đã lưu vùng cắt vào bản nháp.'));
  };
  const buildCard = ({tag, src, alt, width, height, crop, cover, coverCount, actions, descriptions, savedId, pendingIndex}) => {
    const item = win.document.createElement(tag);
    item.className = 'jobs-vacancy-image-item';
    if (savedId) {
      item.dataset.savedImage = savedId;
      item.dataset.width = String(width);
      item.dataset.height = String(height);
      if (crop) item.dataset.crop = JSON.stringify(crop);
    }
    if (pendingIndex != null) item.dataset.pendingRow = String(pendingIndex);
    const workspace = win.document.createElement('div');
    workspace.className = 'jobs-vacancy-image-workspace';
    const stage = win.document.createElement('div');
    stage.className = 'jobs-vacancy-image-stage';
    const frame = win.document.createElement('div');
    frame.className = 'jobs-vacancy-image-frame';
    frame.dataset.imageFrame = '';
    const photo = win.document.createElement('img');
    if (pendingIndex != null) photo.dataset.imagePreview = '';
    photo.alt = alt || '';
    photo.decoding = 'async';
    if (savedId) photo.loading = 'lazy';
    if (src) photo.src = src;
    else photo.hidden = true;
    placeImage(photo, crop);
    frame.append(photo);
    if (cover) {
      const badge = win.document.createElement('span');
      badge.className = 'jobs-vacancy-image-badge';
      badge.dataset.coverBadge = '';
      badge.textContent = t('Cover', 'Ảnh bìa');
      if (coverCount > 1) badge.setAttribute('aria-hidden', 'true');
      frame.append(badge);
    }
    const cropBar = win.document.createElement('div');
    cropBar.className = 'jobs-vacancy-image-cropbar';
    cropBar.dataset.imageCropControls = '';
    cropBar.hidden = true;
    const zoomLabel = win.document.createElement('label');
    const zoomText = win.document.createElement('span');
    zoomText.textContent = t('Zoom', 'Phóng to');
    const zoom = win.document.createElement('input');
    zoom.type = 'range';
    zoom.min = '1';
    zoom.max = String(maxZoom);
    zoom.step = '0.01';
    zoom.value = '1';
    zoom.dataset.imageZoom = '';
    zoom.setAttribute('aria-label', t('Zoom crop', 'Phóng to vùng cắt'));
    zoomLabel.append(zoomText, zoom);
    cropBar.append(
      zoomLabel,
      textButton('imageCropReset', '', t('Reset', 'Đặt lại')),
      textButton('imageCropCancel', '', t('Cancel', 'Hủy'), 'cancel'),
      textButton('imageCropApply', '', t('Apply', 'Áp dụng'), 'confirm'),
    );
    stage.append(frame, cropBar);
    const toolbar = win.document.createElement('div');
    toolbar.className = 'jobs-vacancy-image-toolbar';
    toolbar.setAttribute('role', 'group');
    toolbar.setAttribute('aria-label', t('Photo actions', 'Thao tác ảnh'));
    for (const button of actions) toolbar.append(button);
    workspace.append(stage);
    if (actions.length) workspace.append(toolbar);
    const alts = win.document.createElement('div');
    alts.className = 'jobs-vacancy-image-alts';
    for (const field of descriptions) alts.append(field);
    item.append(workspace, alts);
    return item;
  };
  const clearPending = () => {
    for (const item of pending) win.URL.revokeObjectURL(item.url);
    pending = [];
    find('[data-image-pending]')?.replaceChildren();
    if (uploadButton) uploadButton.disabled = true;
  };
  const renderPending = () => {
    const host = find('[data-image-pending]');
    if (!host) return;
    host.replaceChildren();
    pending.forEach((item, index) => {
      const replace = textButton('imageReplace', '', t('Replace', 'Thay ảnh'), '', 'replace');
      replace.dataset.replacePending = String(index);
      replace.setAttribute('aria-label', t('Replace photo', 'Thay ảnh'));
      const crop = textButton('imageCropOpen', '', t('Fit to Frame', 'Lấp đầy khung'), '', 'crop');
      crop.dataset.cropPending = String(index);
      crop.setAttribute('aria-label', t('Fit to Frame', 'Lấp đầy khung'));
      const remove = textButton('pendingRemove', String(index), t('Remove', 'Xóa'), 'danger', 'trash-2');
      remove.setAttribute('aria-label', t('Remove photo', 'Xóa ảnh'));
      host.append(buildCard({
        tag:'div', src:item.url, alt:'', width:item.width, height:item.height, crop:item.crop || null,
        cover:false, coverCount:saved.length, pendingIndex:index,
        actions:[replace, crop, remove],
        descriptions:[altField('en', item.alt_en || '', false), altField('vi', item.alt_vi || '', false)],
      }));
    });
  };
  const renderSaved = () => {
    list.replaceChildren();
    const several = saved.length > 1;
    saved.forEach((image, index) => {
      const actions = [];
      if (!canEdit) {
        list.append(buildCard({
          tag:'li', alt:localizedAlt(image), width:image.width, height:image.height, crop:image.crop || null,
          cover:image.cover, coverCount:saved.length, savedId:image.id, actions, descriptions:[],
        }));
        const photo = list.lastElementChild.querySelector('img');
        void preview(image.id).then(url => {
          if (disposed || !photo.isConnected) return;
          photo.src = url;
          photo.hidden = false;
        }).catch(() => { if (!disposed && photo.isConnected) previewUnavailable(); });
        return;
      }
      if (several) {
        const cover = textButton('imageCover', '', image.cover ? t('Cover', 'Ảnh bìa') : t('Set as cover', 'Đặt làm ảnh bìa'));
        cover.setAttribute('aria-pressed', String(image.cover));
        cover.setAttribute('aria-label', `${image.cover ? t('Cover', 'Ảnh bìa') : t('Set as cover', 'Đặt làm ảnh bìa')}: ${localizedAlt(image)}`);
        actions.push(cover);
      }
      const replace = textButton('imageReplace', '', t('Replace', 'Thay ảnh'), '', 'replace');
      const crop = textButton('imageCropOpen', '', t('Fit to Frame', 'Lấp đầy khung'), '', 'crop');
      const remove = textButton('imageRemove', '', t('Remove', 'Xóa'), 'danger', 'trash-2');
      const earlier = textButton('imageMove', '-1', t('Move Up', 'Trước'), '', 'arrow-up');
      const later = textButton('imageMove', '1', t('Move Down', 'Sau'), '', 'arrow-down');
      replace.setAttribute('aria-label', `${t('Replace photo', 'Thay ảnh')}: ${localizedAlt(image)}`);
      crop.setAttribute('aria-label', `${t('Fit to Frame', 'Lấp đầy khung')}: ${localizedAlt(image)}`);
      crop.setAttribute('aria-pressed', 'false');
      remove.setAttribute('aria-label', `${t('Remove photo', 'Xóa ảnh')}: ${localizedAlt(image)}`);
      earlier.disabled = index === 0;
      later.disabled = index === saved.length - 1;
      earlier.setAttribute('aria-label', `${t('Move Up', 'Đưa lên trước')}: ${localizedAlt(image)}`);
      later.setAttribute('aria-label', `${t('Move Down', 'Đưa xuống sau')}: ${localizedAlt(image)}`);
      actions.push(replace, crop, remove, earlier, later);
      const card = buildCard({
        tag:'li', alt:localizedAlt(image), width:image.width, height:image.height, crop:image.crop || null,
        cover:image.cover, coverCount:saved.length, savedId:image.id, actions,
        descriptions:canEdit ? [altField('en', image.alt_en, true), altField('vi', image.alt_vi, true)] : [],
      });
      const photo = card.querySelector('img');
      list.append(card);
      void preview(image.id).then(url => {
        if (disposed || !photo.isConnected) return;
        photo.src = url;
        photo.hidden = false;
      }).catch(() => { if (!disposed && photo.isConnected) previewUnavailable(); });
    });
    if (fileInput) fileInput.disabled = saved.length >= maxImages;
  };
  let removedImages = [], removedTicket = 0;
  const removedFrom = rows => (Array.isArray(rows) ? rows : []).map(image => ({
    ...image,
    width: Number(image.width),
    height: Number(image.height),
    alt_en: image.alt_en || '',
    alt_vi: image.alt_vi || '',
    published: image.published === true,
  }));
  const renderRemoved = () => {
    removedHost.replaceChildren();
    if (!removedImages.length) { removedHost.hidden = true; return; }
    removedHost.hidden = false;
    const title = win.document.createElement('h4');
    title.textContent = t('Removed photos', 'Ảnh đã xóa');
    removedHost.append(title);
    for (const image of removedImages) {
      const item = win.document.createElement('div');
      item.className = 'jobs-vacancy-image-item';
      item.dataset.removedImage = image.id;
      const photo = win.document.createElement('img');
      photo.alt = localizedAlt(image);
      photo.hidden = true;
      const description = win.document.createElement('p');
      description.textContent = localizedAlt(image);
      const toolbar = win.document.createElement('div');
      toolbar.className = 'jobs-vacancy-image-actions';
      const restore = textButton('imageRestore', image.id, t('Restore', 'Khôi phục'), 'restore');
      restore.setAttribute('aria-label', `${t('Restore', 'Khôi phục')}: ${localizedAlt(image)}`);
      toolbar.append(restore);
      if (forget) {
        const erase = textButton('imageForget', image.id, t('Permanently delete', 'Xóa vĩnh viễn'), 'danger');
        erase.setAttribute('aria-label', `${t('Permanently delete', 'Xóa vĩnh viễn')}: ${localizedAlt(image)}`);
        erase.disabled = image.published === true;
        toolbar.append(erase);
      }
      item.append(photo, description, toolbar);
      if (forget && image.published === true) {
        const note = win.document.createElement('p');
        note.className = 'cms-hint';
        note.textContent = t('Publish the removal before this photo can be deleted permanently.', 'Xuất bản việc xóa ảnh trước khi có thể xóa vĩnh viễn.');
        item.append(note);
      }
      removedHost.append(item);
      void preview(image.id).then(url => {
        if (disposed || !photo.isConnected) return;
        photo.src = url;
        photo.hidden = false;
      }).catch(() => { if (!disposed && photo.isConnected) previewUnavailable(); });
    }
  };
  const loadRemoved = async () => {
    if (!canEdit || typeof removed !== 'function') return false;
    const ticket = ++removedTicket;
    try {
      const rows = await removed(record.id);
      if (disposed || ticket !== removedTicket) return false;
      removedImages = removedFrom(rows);
      renderRemoved();
      return true;
    } catch {
      if (!disposed && ticket === removedTicket) status.textContent = message('removed_failed');
      return false;
    }
  };
  const pendingEntries = () => [...root.querySelectorAll('[data-pending-row]')].map(row => {
    const item = pending[Number(row.dataset.pendingRow)];
    return {
      file:item?.file,
      crop:item?.crop || null,
      width:item?.width,
      height:item?.height,
      alt_en:row.querySelector('[data-image-alt="en"]').value.trim(),
      alt_vi:row.querySelector('[data-image-alt="vi"]').value.trim(),
      altInput:row.querySelector('[data-image-alt="en"]'),
    };
  });
  const onPointerDown = event => {
    if (!session || event.button || !event.target.closest?.('[data-image-frame]') || event.target.closest('[data-image-frame]') !== session.frame) return;
    session.pointer = event.pointerId;
    session.pointerX = event.clientX;
    session.pointerY = event.clientY;
    session.pointerCrop = session.crop;
    session.frame.classList.add('is-dragging');
    try { session.frame.setPointerCapture(event.pointerId); } catch { /* Pointer capture is optional. */ }
  };
  const onPointerMove = event => {
    if (!session || session.pointer !== event.pointerId) return;
    const rect = session.frame.getBoundingClientRect();
    const next = panCropByPointer(session.pointerCrop, event.clientX - session.pointerX, event.clientY - session.pointerY, rect.width, rect.height, session.width, session.height);
    if (!next) return;
    session.crop = next;
    paintSession();
  };
  const onPointerUp = event => {
    if (!session || session.pointer !== event.pointerId) return;
    session.pointer = null;
    session.frame.classList.remove('is-dragging');
  };
  root.addEventListener('pointerdown', onPointerDown);
  win.addEventListener('pointermove', onPointerMove);
  win.addEventListener('pointerup', onPointerUp);
  win.addEventListener('pointercancel', onPointerUp);
  renderSaved();
  void loadRemoved();
  if (canEdit) {
    const accepted = file => file?.size >= 1 && file.size <= maxBytes && (types.includes(file.type) || mimeByExtension[file.name?.split('.').pop().toLowerCase()]);
    const rejectFile = file => { status.textContent = message(file?.size > maxBytes ? 'file_size' : 'invalid'); };
    fileInput.addEventListener('change', () => {
      if (session?.kind === 'pending') session = null;
      clearPending();
      status.textContent = '';
      const selected = [...(fileInput.files || [])];
      if (!selected.length) return;
      const room = maxImages - root.querySelectorAll('[data-saved-image]').length;
      if (selected.length > room) { fileInput.value = ''; status.textContent = message('gallery_full'); return; }
      const invalid = selected.find(file => !accepted(file));
      if (invalid) { fileInput.value = ''; rejectFile(invalid); return; }
      pending = selected.map(file => ({file, url:win.URL.createObjectURL(file)}));
      renderPending();
      uploadButton.disabled = false;
      status.textContent = t('Ready to upload and save to the draft.', 'Sẵn sàng tải ảnh lên và lưu vào bản nháp.');
    });
    replaceInput.addEventListener('change', () => {
      const file = replaceInput.files?.[0];
      const target = replaceTarget;
      replaceTarget = null;
      replaceInput.value = '';
      if (!file || !target || session) return;
      if (!accepted(file)) { rejectFile(file); return; }
      if (target.kind === 'pending') {
        const item = pending[target.index];
        if (!item) return;
        rememberPendingText(item);
        win.URL.revokeObjectURL(item.url);
        item.file = file;
        item.url = win.URL.createObjectURL(file);
        item.width = 0;
        item.height = 0;
        item.crop = null;
        renderPending();
        return;
      }
      const images = savedFromDom();
      const index = images.findIndex(image => image.id === target.id);
      if (index < 0) return;
      const replacement = save(async () => {
        progress.hidden = false;
        progress.removeAttribute('value');
        status.textContent = t('Uploading image…', 'Đang tải ảnh lên…');
        const uploaded = await upload(record.id, file, fraction => { progress.value = fraction; });
        const attached = vacancyImage({...uploaded, alt_en:images[index].alt_en, alt_vi:images[index].alt_vi});
        if (!attached) throw imageError('upload_failed');
        const next = images.slice();
        next[index] = {...attached, cover:images[index].cover};
        status.textContent = t('Saving draft…', 'Đang lưu bản nháp…');
        const payload = galleryPayload(next);
        if (payload === false) throw imageError('crop_failed');
        if (!payload) throw imageError('upload_failed');
        return payload;
      }, t('Replacement photo saved to draft.', 'Đã lưu ảnh thay thế vào bản nháp.'));
      if (replacement?.then) void replacement.then(() => { if (!disposed) progress.hidden = true; });
    });
    root.addEventListener('input', event => {
      if (session && event.target.matches('[data-image-zoom]')) {
        const next = zoomedCrop(session.width, session.height, session.crop, Number(event.target.value));
        if (!next) return;
        session.crop = next;
        placeImage(session.image, next);
        return;
      }
      const pendingAlt = event.target.closest('[data-pending-row]');
      if (pendingAlt && event.target.matches('[data-image-alt]')) {
        const item = pending[Number(pendingAlt.dataset.pendingRow)];
        if (item) item[event.target.dataset.imageAlt === 'vi' ? 'alt_vi' : 'alt_en'] = event.target.value;
        const image = pendingAlt.querySelector('[data-image-preview]');
        image.alt = localizedAlt({
          alt_en:pendingAlt.querySelector('[data-image-alt="en"]').value.trim(),
          alt_vi:pendingAlt.querySelector('[data-image-alt="vi"]').value.trim(),
        });
        return;
      }
      if (event.target.matches('[data-saved-alt]')) remember(savedFromDom());
    });
    root.addEventListener('keydown', event => {
      if (!session || !session.item.contains(event.target)) return;
      if (event.key === 'Escape') { event.preventDefault(); cancelCrop(); return; }
      if (event.target !== session.frame) return;
      const step = event.shiftKey ? 0.08 : 0.02;
      if (event.key === 'ArrowLeft') { event.preventDefault(); session.crop = panCropByPointer(session.crop, step * (session.frame.getBoundingClientRect().width || 320), 0, session.frame.getBoundingClientRect().width || 320, session.frame.getBoundingClientRect().height || 180, session.width, session.height); }
      else if (event.key === 'ArrowRight') { event.preventDefault(); session.crop = panCropByPointer(session.crop, -step * (session.frame.getBoundingClientRect().width || 320), 0, session.frame.getBoundingClientRect().width || 320, session.frame.getBoundingClientRect().height || 180, session.width, session.height); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); session.crop = panCropByPointer(session.crop, 0, step * (session.frame.getBoundingClientRect().height || 180), session.frame.getBoundingClientRect().width || 320, session.frame.getBoundingClientRect().height || 180, session.width, session.height); }
      else if (event.key === 'ArrowDown') { event.preventDefault(); session.crop = panCropByPointer(session.crop, 0, -step * (session.frame.getBoundingClientRect().height || 180), session.frame.getBoundingClientRect().width || 320, session.frame.getBoundingClientRect().height || 180, session.width, session.height); }
      else if (event.key === '+' || event.key === '=' ) { event.preventDefault(); session.crop = zoomedCrop(session.width, session.height, session.crop, cropZoom(session.width, session.height, session.crop) + 0.1) || session.crop; }
      else if (event.key === '-' || event.key === '_') { event.preventDefault(); session.crop = zoomedCrop(session.width, session.height, session.crop, cropZoom(session.width, session.height, session.crop) - 0.1) || session.crop; }
      else return;
      paintSession();
    });
    root.addEventListener('click', event => {
      if (event.target.closest('[data-image-crop-cancel]')) { cancelCrop(); return; }
      if (event.target.closest('[data-image-crop-reset]')) {
        if (!session) return;
        session.crop = coverCrop(session.width, session.height);
        paintSession();
        return;
      }
      if (event.target.closest('[data-image-crop-apply]')) { applyCrop(); return; }
      const restore = event.target.closest('[data-image-restore]');
      const erase = event.target.closest('[data-image-forget]');
      if (session && (restore || erase)) return;
      if (restore) {
        const image = removedImages.find(item => item.id === restore.dataset.imageRestore);
        const images = savedFromDom();
        if (!image) return;
        if (images.length >= maxImages) { status.textContent = message('gallery_full'); return; }
        void persist([...images, {...image, cover: images.length === 0}], t('Photo restored to the draft.', 'Đã khôi phục ảnh vào bản nháp.'));
        return;
      }
      if (erase && !erase.disabled && forget) {
        const id = erase.dataset.imageForget;
        if (!win.confirm(t('Permanently delete this photo? The file cannot be restored.', 'Xóa vĩnh viễn ảnh này? Tệp không thể được khôi phục.'))) return;
        erase.disabled = true;
        removedTicket += 1;
        void forget(id).then(() => true, () => false).then(async confirmed => {
          if (disposed) return;
          const fresh = await loadRemoved();
          if (disposed) return;
          if (!fresh) {
            if (confirmed) removedImages = removedImages.filter(image => image.id !== id);
            renderRemoved();
          }
          const stillListed = removedImages.some(image => image.id === id);
          status.textContent = stillListed
            ? message('delete_failed')
            : t('Photo permanently deleted.', 'Đã xóa ảnh vĩnh viễn.');
        });
        return;
      }
      const replace = event.target.closest('[data-image-replace]');
      if (replace) {
        if (session) return;
        replaceTarget = replace.hasAttribute('data-replace-pending')
          ? {kind:'pending', index:Number(replace.dataset.replacePending)}
          : {kind:'saved', id:replace.closest('[data-saved-image]')?.dataset.savedImage};
        replaceInput.value = '';
        replaceInput.click();
        return;
      }
      const cropOpen = event.target.closest('[data-image-crop-open]');
      if (cropOpen) {
        if (cropOpen.hasAttribute('data-crop-pending')) {
          const index = Number(cropOpen.dataset.cropPending);
          const item = pending[index];
          const row = cropOpen.closest('[data-pending-row]');
          if (!item || !row) return;
          const start = () => openCrop(row, {kind:'pending', index, width:item.width, height:item.height, crop:item.crop || null});
          if (item.width && item.height) { start(); return; }
          void measure(item.url).then(size => {
            if (disposed || !row.isConnected) return;
            item.width = size.width;
            item.height = size.height;
            start();
          }).catch(() => { if (!disposed) status.textContent = message('crop_failed'); });
          return;
        }
        const item = cropOpen.closest('[data-saved-image]');
        if (item) openCrop(item, {kind:'saved', id:item.dataset.savedImage, width:Number(item.dataset.width), height:Number(item.dataset.height), crop:readStoredCrop(item)});
        return;
      }
      if (session) return;
      const cover = event.target.closest('[data-image-cover]');
      if (cover) {
        if (cover.getAttribute('aria-pressed') === 'true') return;
        const images = savedFromDom();
        const id = cover.closest('[data-saved-image]')?.dataset.savedImage;
        for (const image of images) image.cover = image.id === id;
        void persist(images, t('Cover photo saved to draft.', 'Đã lưu ảnh bìa vào bản nháp.'));
        return;
      }
      const pendingRemove = event.target.closest('[data-pending-remove]');
      if (pendingRemove) {
        const index = Number(pendingRemove.dataset.pendingRemove);
        const [removedFile] = pending.splice(index, 1);
        if (removedFile) win.URL.revokeObjectURL(removedFile.url);
        renderPending();
        if (uploadButton) uploadButton.disabled = !pending.length;
        return;
      }
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
      if (session) { status.textContent = t('Apply or cancel the crop before uploading.', 'Hãy áp dụng hoặc hủy vùng cắt trước khi tải lên.'); return; }
      const entries = pendingEntries();
      if (!entries.length) return;
      const missing = entries.find(entry => Math.max(entry.alt_en.length, entry.alt_vi.length) < 2);
      if (missing) { status.textContent = message('alt_required'); missing.altInput.focus(); return; }
      const existing = galleryPayload(savedFromDom());
      if (existing === false) { status.textContent = message('crop_failed'); return; }
      if (!existing) { status.textContent = message('alt_required'); root.querySelector('[data-saved-alt="en"]')?.focus(); return; }
      if (existing.length + entries.length > maxImages) { status.textContent = message('gallery_full'); return; }
      await save(async () => {
        progress.hidden = false;
        progress.removeAttribute('value');
        status.textContent = t('Uploading image…', 'Đang tải ảnh lên…');
        const added = [];
        for (let index = 0; index < entries.length; index += 1) {
          const uploaded = await upload(record.id, entries[index].file, fraction => { progress.value = (index + fraction) / entries.length; });
          const attached = vacancyImage({...uploaded, alt_en:entries[index].alt_en, alt_vi:entries[index].alt_vi});
          if (!attached) throw imageError('upload_failed');
          const next = {...attached, cover:false};
          if (entries[index].crop) {
            const crop = vacancyImageCrop(entries[index].crop, attached.width, attached.height);
            if (!crop) throw imageError('crop_failed');
            next.crop = crop;
          }
          added.push(next);
        }
        const next = galleryPayload([...existing, ...added]);
        if (next === false) throw imageError('crop_failed');
        if (!next?.length) throw imageError('upload_failed');
        status.textContent = t('Saving draft…', 'Đang lưu bản nháp…');
        return next;
      }, t('Vacancy photos saved to draft.', 'Đã lưu ảnh vào bản nháp.'));
      if (!disposed) { progress.hidden = true; status.textContent = ''; }
    });
  }
  return () => {
    disposed = true;
    session = null;
    win.removeEventListener('pointermove', onPointerMove);
    win.removeEventListener('pointerup', onPointerUp);
    win.removeEventListener('pointercancel', onPointerUp);
    clearPending();
  };
}
