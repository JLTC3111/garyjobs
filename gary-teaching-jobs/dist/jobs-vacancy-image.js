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

export function publishedVacancyImage(value) {
  const image = vacancyImage(value);
  return image && {...image, url:`${endpoint}?image=${image.id}`, alt:[image.alt_en || image.alt_vi, image.alt_vi || image.alt_en]};
}

const messages = {
  invalid: ['Choose an intact JPG, PNG or WebP image up to 4096 px on either side.', 'Chọn ảnh JPG, PNG hoặc WebP hợp lệ, mỗi chiều tối đa 4096 px.'],
  file_size: ['Choose an image of 4 MB or less.', 'Chọn ảnh có dung lượng tối đa 4 MB.'],
  alt_required: ['Enter a short description of the image in at least one language.', 'Nhập mô tả ngắn cho ảnh bằng ít nhất một ngôn ngữ.'],
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

export function mountVacancyImageEditor(root, {record, language, editable, preview, upload, changeAlt, save}) {
  const t = (en, vi) => language === 'vi' ? vi : en, win = root.ownerDocument.defaultView;
  const current = vacancyImage(record.data?.vacancy_image);
  const heading = t('Featured image','Ảnh đại diện');
  root.className = 'jobs-vacancy-image-editor';
  root.innerHTML = `<h3>${heading}</h3><img data-image-preview alt="" hidden><p class="cms-hint">${record.id ?
    t('JPG, PNG or WebP · Up to 4 MB. Describe the image in at least one language. Changes go live when you publish.','JPG, PNG hoặc WebP · Tối đa 4 MB. Mô tả ảnh bằng ít nhất một ngôn ngữ. Thay đổi ảnh hiển thị khi bạn xuất bản.') :
    t('Save the vacancy as a draft before uploading an image.','Lưu bản nháp tin tuyển dụng trước khi tải ảnh lên.')}</p>`;
  if (editable && record.id) root.insertAdjacentHTML('beforeend', `
    <label class="cms-field"><span>${t('Choose image','Chọn ảnh')}</span><input type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" data-image-file></label>
    <label class="jobs-vacancy-image-crop"><input type="checkbox" data-image-crop> ${t('Center crop to 16:9','Cắt giữa ảnh theo tỷ lệ 16:9')}</label>
    <div class="jobs-vacancy-image-alts">
      <label class="cms-field"><span>${t('Image description (English)','Mô tả ảnh (tiếng Anh)')}</span><input lang="en" maxlength="500" data-image-alt="en"></label>
      <label class="cms-field"><span>${t('Image description (Vietnamese)','Mô tả ảnh (tiếng Việt)')}</span><input lang="vi" maxlength="500" data-image-alt="vi"></label>
    </div>
    <div class="jobs-vacancy-image-actions">
      <button type="button" data-image-upload disabled>${t('Upload and save draft','Tải ảnh và lưu bản nháp')}</button>
      ${current ? `<button type="button" data-image-remove>${t('Remove image from draft','Xóa ảnh khỏi bản nháp')}</button>` : ''}
    </div>
    <progress data-image-progress max="1" aria-label="${t('Image upload progress','Tiến độ tải ảnh')}" hidden></progress>`);
  root.insertAdjacentHTML('beforeend','<p class="cms-hint" data-image-status role="status"></p>');
  const find = selector => root.querySelector(selector);
  const image = find('[data-image-preview]'), fileInput = find('[data-image-file]');
  const altEn = find('[data-image-alt="en"]'), altVi = find('[data-image-alt="vi"]');
  const status = find('[data-image-status]');
  const localizedAlt = ({alt_en,alt_vi}) => (language === 'vi' ? alt_vi : alt_en) || alt_en || alt_vi || '';
  const alt = () => ({alt_en:altEn.value.trim(), alt_vi:altVi.value.trim()});
  const previewUnavailable = () => { if (!disposed) status.textContent = t('Image preview unavailable.','Chưa thể xem trước ảnh.'); };
  let disposed = false, localUrl = '', storedUrl = '';
  const show = (url, alt = '') => {
    if (disposed) return;
    if (url) image.src = url; else image.removeAttribute('src');
    image.alt = alt; image.hidden = !url;
  };
  const clearLocal = () => { if (localUrl) win.URL.revokeObjectURL(localUrl); localUrl = ''; };
  image.addEventListener('error', () => { image.hidden = true; previewUnavailable(); });
  if (current) void preview(current.id).then(url => {
    storedUrl = url;
    if (!localUrl) show(storedUrl, localizedAlt(fileInput ? alt() : current));
  }).catch(() => { if (!localUrl) previewUnavailable(); });
  if (fileInput) {
    const uploadButton = find('[data-image-upload]'), progress = find('[data-image-progress]');
    const crop = find('[data-image-crop]');
    const showCrop = () => image.classList.toggle('is-cropped', !!localUrl && crop.checked);
    crop.addEventListener('change', showCrop);
    altEn.value = record.data?.vacancy_image?.alt_en || '';
    altVi.value = record.data?.vacancy_image?.alt_vi || '';
    const message = code => vacancyImageErrorText(imageError(code), language);
    const updateDescription = () => {
      const description = alt();
      image.alt = localizedAlt(description);
      if (current && !fileInput.files?.length) changeAlt(description);
    };
    altEn.addEventListener('input', updateDescription); altVi.addEventListener('input', updateDescription);
    fileInput.addEventListener('change', () => {
      clearLocal();
      const file = fileInput.files?.[0];
      uploadButton.disabled = !file;
      status.textContent = '';
      if (!file) { show(storedUrl, localizedAlt(alt())); showCrop(); return; }
      if (!file.size || file.size > maxBytes || !types.includes(file.type) && !mimeByExtension[file.name.split('.').pop().toLowerCase()]) {
        fileInput.value = '';
        show(storedUrl, localizedAlt(alt())); showCrop();
        status.textContent = message(file.size > maxBytes ? 'file_size' : 'invalid');
        uploadButton.disabled = true;
        return;
      }
      localUrl = win.URL.createObjectURL(file);
      show(localUrl, localizedAlt(alt())); showCrop();
      status.textContent = t('Ready to upload and save to the draft.','Sẵn sàng tải ảnh lên và lưu vào bản nháp.');
    });
    uploadButton.addEventListener('click', async () => {
      const file = fileInput.files?.[0], description = alt();
      if (!file) return;
      if (Math.max(description.alt_en.length, description.alt_vi.length) < 2) { status.textContent = message('alt_required'); altEn.focus(); return; }
      const shouldCrop = crop.checked;
      await save(async () => {
        progress.hidden = false; progress.removeAttribute('value');
        status.textContent = t('Uploading image…','Đang tải ảnh lên…');
        const normalized = shouldCrop ? await cropToLandscape(file, win) : file;
        const uploaded = await upload(record.id, normalized, fraction => { progress.value = fraction; });
        const attached = vacancyImage({...uploaded,...description});
        if (!attached) throw imageError('upload_failed');
        status.textContent = t('Saving draft…','Đang lưu bản nháp…');
        return attached;
      }, t('Featured image saved to draft.','Đã lưu ảnh đại diện vào bản nháp.'));
      progress.hidden = true; status.textContent = '';
    });
    find('[data-image-remove]')?.addEventListener('click', () =>
      save(() => null, t('Featured image removed from draft.','Đã xóa ảnh đại diện khỏi bản nháp.')));
  }
  return () => { disposed = true; clearLocal(); };
}
