import {escapeText} from './jobs-public-content.js';
import {isConflictResponse} from './conflict-response.js';
import {
  applicationStage, candidateKey, normalizeEmail, showcaseReady, talentAvailability, talentPageSize, talentSpecialties, talentStages
} from './jobs-talent-data.js';

const e = value => escapeText(value ?? '');
const emptyFilters = {query:'', stage:'', location:'', specialty:'', min_experience:'', availability:''};
const candidateFields = ['full_name','email','phone','location','specialty','experience_years','availability','stage','internal_note'];
const publicFields = ['public_name','specialty_en','specialty_vi','story_en','story_vi'];

export function mountTalentPool(root, {adapter, language='en', canPublish=false, allowed=()=>true, notify=()=>{}, openApplication=()=>{}}) {
  const doc = root.ownerDocument, win = doc.defaultView;
  const t = (en,vi) => language === 'vi' ? vi : en;
  const label = (map,value) => Object.hasOwn(map,value) ? t(...map[value]) : t('Not recorded','Chưa ghi nhận');
  const selectOptions = (map, selected, empty) =>
    (empty ? `<option value="">${empty}</option>` : '') + Object.entries(map).map(([value,words]) =>
      `<option value="${value}"${value===selected?' selected':''}>${t(...words)}</option>`).join('');
  const experience = value => Number.isFinite(value)
    ? t(`${value.toLocaleString('en')} ${value===1?'year':'years'}`, `${value.toLocaleString('vi-VN')} năm`)
    : label({},null);
  const textOrMissing = value => e(value || label({},null));
  const badge = value => `<span class="talent-stage" data-stage="${e(value)}">${label(talentStages,value)}</span>`;
  const buttonVariants = { edit: 'edit', cancel: 'cancel', publish: 'publish', unpublish: 'archive' };
  const action = (key,text,extra='') => {
    const variant = buttonVariants[key];
    return `<button type="button" data-talent-action="${key}"${variant?` data-button-variant="${variant}"`:''} ${extra}>${e(text)}</button>`;
  };
  const readForm = form => Object.fromEntries(new win.FormData(form));

  let disposed=false, writable=false, loading=true, listError=false, records=[], total=0, page=0, view='list';
  let filters={...emptyFilters}, listRequest, profileRequest, writeRequest;
  let profile=null, mode='profile', opener=null, draft=null, baseline='', detailLoading=false, detailError='', busy=false;
  const active = () => !disposed && allowed();

  root.innerHTML = `<section class="jobs-talent" aria-labelledby="talent-title">
    <header class="talent-header" data-talent-header></header>
    <div class="talent-toolbar"><form class="talent-filters" data-talent-filters></form><div class="talent-views" data-talent-views></div></div>
    <p class="talent-count" data-talent-count role="status" aria-atomic="true"></p>
    <div data-talent-results></div><div class="talent-pagination" data-talent-pagination></div>
    <dialog class="talent-dialog" aria-labelledby="talent-profile-title"><div data-talent-dialog-body></div></dialog>
  </section>`;
  const $ = selector => root.querySelector(selector);
  const dialog = $('.talent-dialog');

  function portrait(row) {
    const initials = row.full_name.trim().split(/\s+/).slice(0,2).map(word=>[...word][0]).join('');
    return `<span class="talent-portrait" aria-hidden="true"><span>${e(initials)}</span>${row.portrait_url
      ? `<img src="${e(row.portrait_url)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ''}</span>`;
  }

  function renderHeader() {
    const description = loading || listError ? '' : writable
      ? t('Manage teaching candidates and track their recruitment progress.','Quản lý ứng viên giảng dạy và theo dõi tiến độ tuyển dụng.')
      : t('Existing applicants are available to view. Candidate editing requires Talent Pool setup.','Có thể xem hồ sơ ứng tuyển hiện có. Cần thiết lập Nguồn ứng viên để chỉnh sửa.');
    $('[data-talent-header]').innerHTML = `<div><h1 id="talent-title" tabindex="-1">${t('Talent Pool','Nguồn ứng viên')}</h1>
      ${description?`<p>${description}</p>`:''}</div>
      ${action('new',t('Add candidate','Thêm ứng viên'),`class="primary"${!writable || loading || listError ? ' disabled' : ''}`)}`;
  }

  function renderFilters(values=filters) {
    const all = t('Any','Tất cả');
    $('[data-talent-filters]').innerHTML = `
      <label>${t('Search','Tìm kiếm')}<input name="query" type="search" value="${e(values.query)}" maxlength="160" placeholder="${t('Name or email','Tên hoặc email')}"></label>
      <label>${t('Stage','Giai đoạn')}<select name="stage">${selectOptions(talentStages,values.stage,all)}</select></label>
      <label>${t('Location','Địa điểm')}<input name="location" type="search" value="${e(values.location)}" maxlength="200"></label>
      <label>${t('Specialty','Chuyên môn')}<select name="specialty">${selectOptions(talentSpecialties,values.specialty,all)}</select></label>
      <label>${t('Minimum experience','Kinh nghiệm tối thiểu')}<select name="min_experience">${selectOptions(
        {1:['1 year','1 năm'],3:['3 years','3 năm'],5:['5 years','5 năm'],10:['10 years','10 năm']},values.min_experience,all
      )}</select></label>
      <label>${t('Availability','Khả năng nhận việc')}<select name="availability">${selectOptions(talentAvailability,values.availability,all)}</select></label>
      <div class="talent-filter-actions"><button type="submit">${t('Apply filters','Áp dụng bộ lọc')}</button>${action('clear',t('Clear filters','Xóa bộ lọc'))}</div>`;
  }

  function renderViews() {
    const control = (name,en,vi) => action('view',t(en,vi),`data-talent-view="${name}" aria-pressed="${view===name}"`);
    $('[data-talent-views]').innerHTML = `<div role="group" aria-label="${t('Directory view','Cách hiển thị danh sách')}">
      ${control('list','List','Danh sách')}${control('cards','Photo cards','Thẻ ảnh')}</div>`;
  }

  function details(fields) {
    return `<dl class="talent-facts">${fields.map(([title,value])=>`<div><dt>${title}</dt><dd>${value}</dd></div>`).join('')}</dl>`;
  }
  const stats = row => [
    [t('Location','Địa điểm'),textOrMissing(row.location)],
    [t('Experience','Kinh nghiệm'),experience(row.experience_years)],
    [t('Availability','Khả năng nhận việc'),label(talentAvailability,row.availability)]
  ];
  const openButton = (row,text,attrs='') => action('open',text,`data-talent-id="${e(candidateKey(row))}" ${attrs}`);

  function cards() {
    return `<div class="talent-cards">${records.map(row=>`<article class="talent-card">
      <div class="talent-card-head">${portrait(row)}<div><h2>${e(row.full_name)}</h2><p>${label(talentSpecialties,row.specialty)}</p></div></div>
      ${badge(row.stage)}${details(stats(row))}
      ${openButton(row,t('Open profile','Mở hồ sơ'),`aria-label="${e(t('Open profile for','Mở hồ sơ của')+' '+row.full_name)}"`)}
    </article>`).join('')}</div>`;
  }

  function directory() {
    return `<div class="talent-table" role="region" tabindex="0" aria-label="${t('Candidate directory','Danh sách ứng viên')}">
      <table aria-label="${t('Candidates','Ứng viên')}"><thead><tr>
        ${[[t('Candidate','Ứng viên')],[t('Specialty','Chuyên môn')],...stats({}).map(([title])=>[title]),[t('Stage','Giai đoạn')]]
          .map(([title])=>`<th scope="col">${title}</th>`).join('')}
      </tr></thead><tbody>${records.map(row=>`<tr><th scope="row">
        <div class="talent-table-name">${portrait(row)}<div>${openButton(row,row.full_name)}<span>${e(row.email)}</span></div></div></th>
        <td>${label(talentSpecialties,row.specialty)}</td>${stats(row).map(([,value])=>`<td>${value}</td>`).join('')}<td>${badge(row.stage)}</td>
      </tr>`).join('')}</tbody></table></div>`;
  }

  function renderResults() {
    const target = $('[data-talent-results]'), count = $('[data-talent-count]');
    target.setAttribute('aria-busy',String(loading));
    count.textContent = loading ? t('Loading candidates…','Đang tải ứng viên…') : listError ? ''
      : total ? t(`Showing ${page*talentPageSize+1}–${page*talentPageSize+records.length} of ${total} candidates`,
        `Hiển thị ${page*talentPageSize+1}–${page*talentPageSize+records.length} trong tổng số ${total} ứng viên`)
        : t('No candidates found.','Không tìm thấy ứng viên.');
    target.innerHTML = loading ? '' : listError
      ? `<div class="jobs-alert error" role="alert">${t('Could not load candidates.','Không thể tải ứng viên.')} ${action('retry',t('Try again','Thử lại'))}</div>`
      : view==='cards' ? cards() : records.length ? directory() : '';
    $('[data-talent-pagination]').innerHTML = total>talentPageSize && !loading && !listError
      ? action('previous',t('Previous','Trước'),page>0?'':'disabled') + action('next',t('Next','Tiếp'),(page+1)*talentPageSize<total?'':'disabled') : '';
  }

  async function load(refresh=false, restoreAction='') {
    if(!active()) return;
    listRequest?.abort();
    const request = new win.AbortController();
    listRequest = request;
    loading=true; listError=false;
    renderHeader(); renderResults();
    try {
      const result = await adapter.list({filters,page,language,signal:request.signal,refresh});
      if (!active() || request.signal.aborted) return;
      if (page && result.total <= page*talentPageSize) {
        page=Math.max(0,Math.ceil(result.total/talentPageSize)-1);
        return load(false,restoreAction);
      }
      ({records,total,writable} = result);
    } catch {
      if(!active() || request.signal.aborted) return;
      listError=true; records=[]; total=0;
    }
    if(!active() || request.signal.aborted) return;
    loading=false; renderHeader(); renderResults();
    if (restoreAction) ($(`[data-talent-action="${restoreAction}"]:not([disabled])`) || $('#talent-title')).focus({preventScroll:true});
  }

  function problem(error) {
    if (error?.code==='23505' || error?.message==='jobs.talent_duplicate')
      return t('A candidate with this email already exists. Search for the existing profile.','Đã có ứng viên dùng email này. Hãy tìm và mở hồ sơ hiện có.');
    if (isConflictResponse(error))
      return t('This profile changed while you were editing. Reopen it for the latest version.','Hồ sơ đã thay đổi khi bạn chỉnh sửa. Hãy mở lại để tải phiên bản mới nhất.');
    if (error?.message==='jobs.showcase_not_approved')
      return t('Publication requires confirmed placement, approval and consent for this version.','Cần xác nhận việc làm, nội dung và sự đồng ý cho phiên bản này trước khi đăng.');
    return t('Could not complete this request. Try again.','Không thể hoàn tất yêu cầu. Vui lòng thử lại.');
  }

  function applications(row) {
    const apps = row.applications || [];
    return `<section class="talent-linked"><h3>${t('Linked applications','Hồ sơ ứng tuyển liên kết')}</h3>
      ${apps.length ? `<ul>${apps.map(item=>`<li><div><strong>${e(item.vacancy_title)}</strong><small>${e(item.receipt_code)}</small>${badge(applicationStage(item.stage))}</div>
        ${action('application',t('Open application','Mở hồ sơ ứng tuyển'),`data-application-id="${e(item.id)}"`)}</li>`).join('')}</ul>`
        : `<p>${t('No linked applications.','Chưa có hồ sơ ứng tuyển liên kết.')}</p>`}</section>`;
  }

  function showcase(row) {
    if(!canPublish || row.source!=='talent') return '';
    const story = row.showcase;
    const published = story?.status==='published';
    return `<section class="talent-showcase-panel"><h3>${t('Teacher Showcase','Gương mặt giáo viên')}</h3>
      <p>${published ? t('Published','Đang hiển thị') : story ? t('Draft','Bản nháp') : t('No story drafted.','Chưa có bản nháp câu chuyện.')}</p>
      ${story ? details([
        [t('Placement','Việc làm'),story.placement_confirmed === true ? t('Confirmed','Đã xác nhận') : t('Awaiting confirmation','Đang chờ xác nhận')],
        [t('Story and photo consent','Đồng ý công khai câu chuyện và ảnh'),story.consent_confirmed === true ? t('Confirmed for this version','Đã xác nhận cho phiên bản này') : t('Awaiting consent','Đang chờ đồng ý')],
        [t('Approved portrait','Ảnh chân dung đã duyệt'),story.portrait_ready === true ? t('Ready','Sẵn sàng') : t('Awaiting portrait approval','Đang chờ duyệt ảnh')]
      ]) : ''}
      <div class="talent-actions">${published ? action('unpublish',t('Unpublish','Gỡ bài công khai')) : action('draft',t(story?'Edit story draft':'Create story draft',story?'Sửa bản nháp':'Tạo bản nháp'))}
      ${!published && story ? action('publish',t('Approve and publish','Duyệt và đăng'),`class="primary"${showcaseReady(story)?'':' disabled'}`) : ''}</div></section>`;
  }

  function editor() {
    const candidate = mode==='candidate';
    const input = (name, caption, attrs='') => `<label>${caption}<input name="${name}" value="${e(draft[name])}" ${attrs}></label>`;
    const select = (name, caption, map, empty) => `<label>${caption}<select name="${name}">${selectOptions(map,draft[name],empty)}</select></label>`;
    const textarea = (name, caption, length) => `<label>${caption}<textarea name="${name}" rows="4" maxlength="${length}"${!candidate?' required':''}>${e(draft[name])}</textarea></label>`;
    const blank = t('Not recorded','Chưa ghi nhận');
    const fields = candidate ? `
      ${input('full_name',t('Full name','Họ và tên'),'required minlength="2" maxlength="100"')}
      ${input('email','Email',`type="email" required maxlength="254"${profile?.source==='applicant'||profile?.applicant_id?' readonly':''}`)}
      ${input('phone',t('Phone','Điện thoại'),'type="tel" maxlength="60"')}
      ${input('location',t('Location','Địa điểm'),'maxlength="200"')}
      ${select('specialty',t('Specialty','Chuyên môn'),talentSpecialties,blank)}
      ${input('experience_years',t('Years of experience','Số năm kinh nghiệm'),'type="number" min="0" max="60" step="0.5"')}
      ${select('availability',t('Availability','Khả năng nhận việc'),talentAvailability,blank)}
      ${select('stage',t('Stage','Giai đoạn'),talentStages)}
      ${textarea('internal_note',t('Private recruiter note','Ghi chú riêng của tuyển dụng'),3000)}` : `
      ${input('public_name',t('Public display name','Tên hiển thị công khai'),'required maxlength="100"')}
      ${input('specialty_en',t('Specialty (English)','Chuyên môn (tiếng Anh)'),'required maxlength="120"')}
      ${input('specialty_vi',t('Specialty (Vietnamese)','Chuyên môn (tiếng Việt)'),'required maxlength="120"')}
      ${textarea('story_en',t('Success story (English)','Câu chuyện (tiếng Anh)'),800)}
      ${textarea('story_vi',t('Success story (Vietnamese)','Câu chuyện (tiếng Việt)'),800)}`;
    return `<form data-talent-editor><fieldset class="talent-edit-fields"${busy?' disabled':''}>${fields}</fieldset>
      <div class="talent-actions">${action('cancel',t('Cancel','Hủy'),busy?'disabled':'')}
      <button class="primary" type="submit" data-button-variant="${candidate?'save':'save-draft'}"${busy?' disabled':''}>${candidate?t('Save candidate','Lưu ứng viên'):t('Save story draft','Lưu bản nháp câu chuyện')}</button></div></form>`;
  }

  function renderDialog(focus=false) {
    const title = mode==='candidate' ? profile ? t('Edit candidate','Sửa ứng viên') : t('Add candidate','Thêm ứng viên')
      : mode==='showcase' ? t('Edit story draft','Sửa bản nháp câu chuyện') : profile?.full_name || t('Candidate profile','Hồ sơ ứng viên');
    const body = $('[data-talent-dialog-body]');
    const restoreClose = body.contains(doc.activeElement) && doc.activeElement?.matches('[data-talent-action="close"]');
    body.setAttribute('aria-busy',String(busy || detailLoading));
    const content = mode!=='profile' ? editor() : detailLoading ? `<p role="status">${t('Loading profile…','Đang tải hồ sơ…')}</p>` : !profile ? ''
      : `<div class="talent-profile-head">${portrait(profile)}<div>${badge(profile.stage)}
        <p>${label(talentSpecialties,profile.specialty)}</p></div></div>
        ${details([[t('Email','Email'),textOrMissing(profile.email)],[t('Phone','Điện thoại'),textOrMissing(profile.phone)],...stats(profile)])}
        ${profile.internal_note?`<section class="talent-private-note"><h3>${t('Private recruiter note','Ghi chú riêng của tuyển dụng')}</h3><p>${e(profile.internal_note)}</p></section>`:''}
        ${writable ? action('edit',t('Edit candidate','Sửa ứng viên')) : ''}
        ${applications(profile)}${showcase(profile)}`;
    body.innerHTML = `<header class="talent-dialog-header"><h2 id="talent-profile-title" tabindex="-1">${e(title)}</h2>
      ${action('close',t('Close','Đóng'),busy?'disabled':'')}</header>
      ${detailError?`<p class="jobs-alert error" role="alert">${e(detailError)}</p>`:''}${content}`;
    if(busy) for(const button of body.querySelectorAll('button')) button.disabled=true;
    if(focus) $('#talent-profile-title')?.focus({preventScroll:true});
    else if(restoreClose) body.querySelector('[data-talent-action="close"]').focus({preventScroll:true});
  }

  function startEditor(next) {
    mode=next; detailError='';
    const source = next==='candidate' ? profile : profile?.showcase;
    const keys = next==='candidate' ? candidateFields : publicFields;
    draft=Object.fromEntries(keys.map(key=>[key,String(source?.[key] ?? (key==='stage'?'new':''))]));
    baseline=JSON.stringify(draft);
    renderDialog(true);
  }

  function dismissAllowed() {
    return !busy && (!draft || JSON.stringify(draft)===baseline
      || win.confirm(t('Discard unsaved edits?','Bỏ các thay đổi chưa lưu?')));
  }

  function resetDialog(restoreFocus=true) {
    profileRequest?.abort();
    dialog.close();
    profile=null; draft=null; detailError=''; detailLoading=false;
    $('[data-talent-dialog-body]').replaceChildren();
    if(restoreFocus) {
      const target = opener?.isConnected ? opener : $('#talent-title');
      target?.focus({preventScroll:true});
    }
    opener=null;
  }

  async function openProfile(record, trigger) {
    profileRequest?.abort();
    const request = new win.AbortController();
    profileRequest = request;
    opener=trigger; profile=null; mode='profile'; draft=null; detailError=''; detailLoading=true;
    renderDialog(); dialog.showModal(); $('#talent-profile-title').focus({preventScroll:true});
    try {
      const result=await adapter.profile(record,{writable,signal:request.signal});
      if(active()&&!request.signal.aborted) profile=result;
    } catch(error) {
      if(active()&&!request.signal.aborted) detailError=problem(error);
    }
    if(active()&&!request.signal.aborted){detailLoading=false;renderDialog(doc.activeElement===dialog || doc.activeElement?.id==='talent-profile-title');}
  }

  async function performWrite(operation, success) {
    if(busy || !active() || !writable) return;
    busy=true; detailError='';
    const request=new win.AbortController();
    writeRequest=request;
    renderDialog(true);
    try {
      const result=await operation(request.signal);
      if(!active() || request.signal.aborted) return;
      success(result);
      mode='profile'; draft=null;
    } catch(error) {
      if(active()&&!request.signal.aborted) detailError=problem(error);
    } finally {
      if(active()&&!request.signal.aborted){busy=false;renderDialog(true);}
    }
  }

  function save() {
    const previous = profile;
    const edited = Object.fromEntries(Object.entries(draft).map(([key,value])=>[key,value.trim()]));
    if(mode==='showcase') {
      if(!canPublish || profile?.source!=='talent' || profile.showcase?.status==='published') return;
      if(publicFields.some(field=>!edited[field])) {
        detailError=t('Complete the public name, specialties and stories in both languages.','Nhập tên công khai, chuyên môn và câu chuyện bằng cả hai ngôn ngữ.');
        renderDialog(true); return;
      }
      return performWrite(signal=>adapter.saveShowcase(previous,edited,signal), result=>{
        profile={...previous,showcase:result};
        notify(t('Story draft saved.','Đã lưu bản nháp câu chuyện.'));
      });
    }
    edited.email=normalizeEmail(edited.email);
    edited.experience_years=edited.experience_years===''?null:Number(edited.experience_years);
    if (edited.full_name.length<2 || !edited.email || (edited.experience_years!==null && !Number.isFinite(edited.experience_years))) {
      detailError=t('Enter a valid name, email and experience.','Nhập tên, email và kinh nghiệm hợp lệ.');
      renderDialog(true); return;
    }
    if(records.some(row=>normalizeEmail(row.email)===edited.email && (!previous || candidateKey(row)!==candidateKey(previous)))) {
      detailError=problem({code:'23505'}); renderDialog(true); return;
    }
    return performWrite(signal=>adapter.save(edited,previous,signal),result=>{
      profile={...result,portrait_url:result.portrait_path===previous?.portrait_path?previous?.portrait_url:''};
      notify(t('Candidate saved.','Đã lưu ứng viên.'));
      void load();
    });
  }

  function changeVisibility(publish) {
    if(busy || !writable || !canPublish || profile?.source!=='talent' ||
        (publish ? !showcaseReady(profile.showcase) : profile.showcase?.status!=='published')) return;
    if(!win.confirm(publish ? t('Approve and publish this teacher profile and story?','Duyệt và đăng hồ sơ cùng câu chuyện của giáo viên này?')
      : t('Remove this teacher profile from the public showcase?','Gỡ hồ sơ giáo viên này khỏi trang công khai?'))) return;
    const previous=profile;
    return performWrite(signal=>adapter.setShowcaseVisibility(previous,publish,signal), result=>{
      profile={...previous,showcase:result};
      notify(publish?t('Teacher story published.','Đã đăng câu chuyện giáo viên.'):t('Teacher story removed from the showcase.','Đã gỡ câu chuyện giáo viên khỏi trang công khai.'));
    });
  }

  function click(event) {
    const target=event.target.closest('[data-talent-action]');
    if(!target || target.disabled || !active()) return;
    const {talentAction:key}=target.dataset;
    if(key==='view') {
      view=target.dataset.talentView==='cards'?'cards':'list';
      renderViews(); renderResults();
      $(`[data-talent-view="${view}"]`)?.focus({preventScroll:true});
    }
    if(key==='retry') void load(true);
    if(key==='clear'){filters={...emptyFilters};page=0;renderFilters();$('[name=query]').focus({preventScroll:true});void load();}
    if(key==='next' || key==='previous'){page+=key==='next'?1:-1;void load(false,key);}
    if(key==='open'){
      const record=records.find(row=>candidateKey(row)===target.dataset.talentId);
      if(record) void openProfile(record,target);
    }
    if(key==='new' && writable){opener=target;profile=null;startEditor('candidate');dialog.showModal();$('#talent-profile-title').focus({preventScroll:true});}
    if(key==='edit' && writable && profile) startEditor('candidate');
    if(key==='draft' && writable && canPublish && profile?.source==='talent' && profile.showcase?.status!=='published') startEditor('showcase');
    if(key==='close' && dismissAllowed()) resetDialog();
    if(key==='cancel' && dismissAllowed()){
      if(profile){mode='profile';draft=null;detailError='';renderDialog(true);}else resetDialog();
    }
    if(key==='publish' || key==='unpublish') void changeVisibility(key==='publish');
    if(key==='application' && profile?.applications?.some(item=>item.id===target.dataset.applicationId)){
      openApplication(target.dataset.applicationId);
    }
  }
  function submit(event) {
    if(!event.target.matches('[data-talent-filters],[data-talent-editor]')) return;
    event.preventDefault();
    if(!active()) return;
    if(event.target.matches('[data-talent-filters]')){
      filters=readForm(event.target);page=0;void load();
    }else if(!busy && event.target.reportValidity()){
      draft=readForm(event.target);void save();
    }
  }
  function input(event) {
    const form=event.target.closest('[data-talent-editor]');
    if(form && !busy) draft=readForm(form);
  }
  function cancel(event){event.preventDefault();if(dismissAllowed()) resetDialog();}
  function imageError(event){if(event.target.matches('.talent-portrait img'))event.target.remove();}
  function beforeUnload(event){if(draft && JSON.stringify(draft)!==baseline){event.preventDefault();event.returnValue='';}}
  root.addEventListener('click',click);
  root.addEventListener('submit',submit);
  root.addEventListener('input',input);
  root.addEventListener('error',imageError,true);
  dialog.addEventListener('cancel',cancel);
  win.addEventListener('beforeunload',beforeUnload);
  renderFilters();renderViews();
  const ready=load();
  return {
    ready, canLeave:dismissAllowed,
    setLanguage(value){
      const typed=readForm($('[data-talent-filters]'));
      language=value;renderHeader();renderFilters(typed);renderViews();renderResults();
      if(dialog.open) renderDialog();
    },
    destroy(){
      disposed=true;listRequest?.abort();profileRequest?.abort();writeRequest?.abort();
      if(dialog.open) resetDialog(false);
      root.removeEventListener('click',click);root.removeEventListener('submit',submit);
      root.removeEventListener('input',input);root.removeEventListener('error',imageError,true);
      dialog.removeEventListener('cancel',cancel);win.removeEventListener('beforeunload',beforeUnload);
      records=[];root.replaceChildren();
    }
  };
}
