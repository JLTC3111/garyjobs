// Presentation only: the Jobs staff RPCs re-check every permission against current database state.
import {isConflictResponse} from './conflict-response.js';

const ROLES=['editor','publisher','recruiter','admin'];
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const COPY={
 en:{
  eyebrow:'TEACHING JOBS ADMINISTRATION',title:'Staff management',
  intro:'Assign, change, suspend and restore Teaching Jobs staff roles. Changes apply to Teaching Jobs memberships.',
  add:'Add Staff',edit:'Edit Access',assignIntro:'Enter the sign-in email of a verified Gary account to add it to Teaching Jobs.',
  email:'Account email',displayName:'Jobs display name',nameHint:'Optional. Leave blank to use the existing name.',
  role:'Role',status:'Status',assign:'Assign access',cancel:'Cancel',close:'Close',
  adminOwnerOnly:'Administrator access can only be granted by a protected Jobs owner.',guideTitle:'Role permissions',
  roles:{editor:'Editor',publisher:'Publisher',recruiter:'Recruiter',admin:'Admin',none:'No access'},
  roleHelp:{
   editor:'Create and edit drafts, submit content for review, restore revisions and upload media.',
   publisher:'Create and edit drafts, submit content for review, restore revisions, upload media, publish and archive content. Archiving removes it from public view.',
   recruiter:'Recruitment only. Manage applications, candidate details, CVs, stages, assignments and private notes.',
   admin:'All content and recruitment permissions, including staff management within the owner safeguards.',
   none:'Jobs keeps the suspended membership, history and recruitment assignments.'
  },
  directoryTitle:'Staff directory',count:n=>`${n} ${n===1?'membership':'memberships'}, including suspended access`,
  filteredCount:(shown,total)=>`Showing ${shown} of ${total} memberships`,
  search:'Search by name or email',allRoles:'All roles',allStatuses:'All statuses',clear:'Clear filters',noMatches:'No staff match your search or filters.',
  refresh:'Refresh',loading:'Loading staff…',empty:'No Jobs staff memberships yet.',tryAgain:'Try again',
  active:'Active',suspended:'Suspended · no access',unverified:'Email not verified · no access',
  you:'You',member:'Staff member',
  selfReadonly:'Your account',protectedReadonly:'Protected account',adminReadonly:'Administrator · only a protected owner can change this',viewOnly:'View only',
  editFor:name=>`Edit access for ${name}`,more:name=>`More actions for ${name}`,save:'Save changes',suspend:'Suspend access',restore:'Restore access',
  assigned:email=>`Jobs access assigned to ${email}.`,updated:email=>`Access updated for ${email}.`,noChange:'No changes to save.',
  suspendedNotice:email=>`Jobs access suspended for ${email}.`,restored:email=>`Jobs access restored for ${email}.`,
  conflict:'This membership changed. Review the refreshed values before saving again.',
  confirmSuspend:email=>`Suspend Jobs access for ${email}? Their history and recruitment assignments are kept.`,
  confirmRestore:(email,role)=>`Restore Jobs access for ${email} as ${role}?`,
  confirmAdmin:(email,from,to)=>`Change Administrator access for ${email} from ${from} to ${to}?`,
  historyTitle:'Recent access changes',historyNote:'Up to 50 changes you can view, including database operator changes.',historyEmpty:'No access changes recorded yet.',operator:'Database operator',hiddenActor:'Staff member',by:'By',
  actions:{granted:'Access assigned',role_changed:'Role changed',suspended:'Access suspended',restored:'Access restored',protected:'Marked protected',unprotected:'Protection removed',removed:'Membership removed'},
 },
 vi:{
  eyebrow:'QUẢN TRỊ TEACHING JOBS',title:'Quản lý nhân viên',
  intro:'Cấp, thay đổi, tạm ngưng và khôi phục vai trò nhân viên Teaching Jobs. Thay đổi chỉ áp dụng cho thành viên Teaching Jobs.',
  add:'Thêm nhân viên',edit:'Chỉnh sửa quyền truy cập',assignIntro:'Nhập email đăng nhập của tài khoản Gary đã xác minh để thêm tài khoản vào Teaching Jobs.',
  email:'Email tài khoản',displayName:'Tên hiển thị trên Jobs',nameHint:'Không bắt buộc. Để trống để dùng tên hiện có.',
  role:'Vai trò',status:'Trạng thái',assign:'Cấp quyền',cancel:'Hủy',close:'Đóng',
  adminOwnerOnly:'Chỉ chủ sở hữu Jobs được bảo vệ mới có thể cấp quyền Quản trị viên.',guideTitle:'Quyền theo vai trò',
  roles:{editor:'Biên tập viên',publisher:'Người xuất bản',recruiter:'Chuyên viên tuyển dụng',admin:'Quản trị viên',none:'Không có quyền'},
  roleHelp:{
   editor:'Tạo và chỉnh sửa bản nháp, gửi nội dung để duyệt, khôi phục phiên bản và tải tư liệu lên.',
   publisher:'Tạo và chỉnh sửa bản nháp, gửi nội dung để duyệt, khôi phục phiên bản, tải tư liệu lên, xuất bản và lưu trữ nội dung. Nội dung được gỡ khỏi trang công khai khi lưu trữ.',
   recruiter:'Chỉ tuyển dụng. Quản lý hồ sơ ứng tuyển, thông tin ứng viên, CV, giai đoạn, phân công và ghi chú riêng tư.',
   admin:'Toàn bộ quyền nội dung và tuyển dụng, bao gồm quản lý nhân viên theo quy tắc bảo vệ của chủ sở hữu.',
   none:'Jobs giữ lại tư cách thành viên đã tạm ngưng, lịch sử và phân công tuyển dụng.'
  },
  directoryTitle:'Danh bạ nhân viên',count:n=>`${n} thành viên, gồm cả thành viên đã tạm ngưng`,
  filteredCount:(shown,total)=>`Hiển thị ${shown} trên ${total} thành viên`,
  search:'Tìm theo tên hoặc email',allRoles:'Tất cả vai trò',allStatuses:'Tất cả trạng thái',clear:'Xóa bộ lọc',noMatches:'Không tìm thấy nhân viên phù hợp với từ khóa hoặc bộ lọc.',
  refresh:'Làm mới',loading:'Đang tải danh sách nhân viên…',empty:'Chưa có thành viên nhân viên Jobs.',tryAgain:'Thử lại',
  active:'Đang hoạt động',suspended:'Đã tạm ngưng · không có quyền',unverified:'Email chưa xác minh · không có quyền',
  you:'Bạn',member:'Nhân viên',
  selfReadonly:'Tài khoản của bạn',protectedReadonly:'Tài khoản được bảo vệ',adminReadonly:'Quản trị viên · chỉ chủ sở hữu được bảo vệ mới có thể thay đổi',viewOnly:'Chỉ xem',
  editFor:name=>`Chỉnh sửa quyền truy cập của ${name}`,more:name=>`Thao tác khác cho ${name}`,save:'Lưu thay đổi',suspend:'Tạm ngưng quyền truy cập',restore:'Khôi phục quyền truy cập',
  assigned:email=>`Đã cấp quyền Jobs cho ${email}.`,updated:email=>`Đã cập nhật quyền của ${email}.`,noChange:'Không có thay đổi để lưu.',
  suspendedNotice:email=>`Đã tạm ngưng quyền Jobs của ${email}.`,restored:email=>`Đã khôi phục quyền Jobs của ${email}.`,
  conflict:'Thông tin thành viên đã thay đổi. Hãy xem lại các giá trị mới trước khi lưu lại.',
  confirmSuspend:email=>`Tạm ngưng quyền Jobs của ${email}? Lịch sử và phân công tuyển dụng vẫn được giữ lại.`,
  confirmRestore:(email,role)=>`Khôi phục quyền Jobs của ${email} với vai trò ${role}?`,
  confirmAdmin:(email,from,to)=>`Đổi quyền Quản trị viên của ${email} từ ${from} sang ${to}?`,
  historyTitle:'Thay đổi quyền gần đây',historyNote:'Tối đa 50 thay đổi bạn có thể xem, gồm cả thay đổi của quản trị cơ sở dữ liệu.',historyEmpty:'Chưa có thay đổi quyền nào được ghi lại.',operator:'Quản trị cơ sở dữ liệu',hiddenActor:'Nhân viên',by:'Bởi',
  actions:{granted:'Đã cấp quyền',role_changed:'Đã đổi vai trò',suspended:'Đã tạm ngưng quyền',restored:'Đã khôi phục quyền',protected:'Đã đánh dấu bảo vệ',unprotected:'Đã bỏ bảo vệ',removed:'Đã xoá tư cách thành viên'},
 },
};
const STATUSES=['active','suspended','unverified'];
const statusOf=member=>!member.active?'suspended':member.email_confirmed?'active':'unverified';
const nameOf=member=>member.display_name||member.name||member.email||'';
const searchable=value=>String(value??'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/đ/g,'d').trim().replace(/\s+/g,' ');
const addValues=()=>({email:'',display_name:'',role:'editor',feedback:null});
const editValues=member=>({member,email:member.email||'',display_name:member.display_name||'',role:member.role,feedback:null});
const updateInput=member=>({user_id:member.user_id,role:member.role,active:member.active,version:member.version,display_name:null});

export function mountStaffManagement(root,{adapter,language='en',errorText=error=>error?.message||String(error),confirm,onNotice=()=>{}}={}){
 const doc=root.ownerDocument,win=doc.defaultView,ask=confirm||(message=>win.confirm(message));
 let lang=language==='vi'?'vi':'en',data=null,loading=false,loadError=null,busy=false,disposed=false,request=0;
 let addDraft=addValues(),editor=null,menu=null,directoryFeedback=null;
 const drafts=new Map();
 const copy=()=>COPY[lang];
 const blocked=()=>loading||busy;
 const owner=()=>data?.viewer?.can_manage_admins===true;
 const canAssign=()=>data?.viewer?.can_manage_staff===true;
 const canEdit=member=>member?.can_manage===true&&!member.is_self&&!member.protected&&(member.role!=='admin'||owner());
 const memberFor=id=>data?.members.find(member=>member.user_id===id);
 const label=key=>`<span data-staff-copy="${key}"></span>`;

 root.innerHTML=`<section class="jobs-staff-admin" aria-labelledby="jobs-staff-title">
  <header class="jobs-staff-admin-header">
   <p class="jobs-staff-eyebrow">${label('eyebrow')}</p>
   <h1 id="jobs-staff-title">${label('title')}</h1>
   <p>${label('intro')}</p>
  </header>
  <section class="jobs-staff-panel jobs-staff-directory" aria-labelledby="jobs-staff-directory-title">
   <header class="jobs-staff-directory-header">
    <h2 id="jobs-staff-directory-title">${label('directoryTitle')}</h2>
    <div class="jobs-staff-directory-actions">
     <button type="button" data-staff-action="refresh">${label('refresh')}</button>
     <button type="button" class="primary" data-staff-action="add" aria-haspopup="dialog" aria-controls="jobs-staff-drawer">${label('add')}</button>
    </div>
   </header>
   <form class="jobs-staff-filters" role="search" aria-labelledby="jobs-staff-directory-title">
    <label class="jobs-staff-search">${label('search')}<input type="search" name="query" autocomplete="off"></label>
    <label>${label('role')}<select name="role"></select></label>
    <label>${label('status')}<select name="status"></select></label>
   </form>
   <div class="jobs-staff-result-line">
    <p class="jobs-meta" data-staff-count role="status"></p>
    <button type="button" data-staff-action="clear" hidden>${label('clear')}</button>
   </div>
   <p class="jobs-staff-feedback" data-staff-feedback="directory" role="status" tabindex="-1"></p>
   <div class="jobs-staff-list"></div>
  </section>
  <details class="jobs-staff-panel jobs-staff-guide" open>
   <summary>${label('guideTitle')}</summary>
   <div class="jobs-staff-guide-body"></div>
  </details>
  <section class="jobs-staff-panel jobs-staff-history" aria-labelledby="jobs-staff-history-title">
   <h2 id="jobs-staff-history-title">${label('historyTitle')}</h2>
   <p class="jobs-meta">${label('historyNote')}</p>
   <div class="jobs-staff-events"></div>
  </section>
  <dialog class="jobs-staff-drawer" id="jobs-staff-drawer" aria-labelledby="jobs-staff-drawer-title">
   <header class="jobs-staff-drawer-header">
    <h2 id="jobs-staff-drawer-title" tabindex="-1" autofocus></h2>
    <button type="button" class="jobs-staff-icon-button" data-staff-action="close"><span aria-hidden="true">×</span></button>
   </header>
   <form class="jobs-staff-form" data-staff-form aria-describedby="jobs-staff-form-feedback">
    <p class="jobs-meta" data-staff-assign-intro>${label('assignIntro')}</p>
    <label>${label('email')}<input name="email" type="email" required maxlength="254" autocomplete="off" spellcheck="false" autocapitalize="none"></label>
    <label>${label('displayName')}<input name="display_name" maxlength="120" autocomplete="off"><small>${label('nameHint')}</small></label>
    <label>${label('role')}<select name="role"></select></label>
    <p class="jobs-meta" data-staff-owner-hint>${label('adminOwnerOnly')}</p>
    <p class="jobs-meta" data-staff-form-status></p>
    <p id="jobs-staff-form-feedback" class="jobs-staff-feedback" role="status" tabindex="-1"></p>
    <div class="jobs-staff-form-actions">
     <button type="button" data-staff-action="close">${label('cancel')}</button>
     <button class="primary" type="submit" data-button-variant="confirm"></button>
    </div>
   </form>
  </dialog>
 </section>`;
 const $=selector=>root.querySelector(selector);
 const list=$('.jobs-staff-list'),filters=$('.jobs-staff-filters'),drawer=$('.jobs-staff-drawer'),form=$('[data-staff-form]');
 const search=filters.elements.query,email=form.elements.email,displayName=form.elements.display_name,role=form.elements.role;
 const title=$('#jobs-staff-drawer-title'),submit=form.querySelector('[type=submit]'),formFeedback=$('#jobs-staff-form-feedback');
 const notice=$('[data-staff-feedback=directory]'),addButton=$('[data-staff-action=add]');
 const closeButton=$('.jobs-staff-drawer-header button');

 function options(select,items,value=select.value){
  const markup=items.map(([key,name,help])=>`<option value="${esc(key)}"${help?` title="${esc(help)}"`:''}>${esc(name)}</option>`).join('');
  if(select.dataset.options!==markup){select.innerHTML=markup;select.dataset.options=markup;}
  if(select.value!==value)select.value=value;
 }

 function paintFeedback(node,value){
  node.textContent=value?.error??(value?.key?copy()[value.key]:'');
  node.classList.toggle('error',Boolean(value?.error||value?.key==='conflict'));
 }

 function initials(member){
  const words=(member.display_name||member.name||member.email?.split('@')[0]||'?').trim().split(/[\s._-]+/u).filter(Boolean);
  return words.slice(0,2).map(word=>[...word][0]).join('').toLocaleUpperCase(lang)||'?';
 }

 function memberMarkup(member){
  const c=copy(),state=statusOf(member),id=esc(member.user_id),name=nameOf(member)||c.member;
  const reason=member.is_self?c.selfReadonly:member.protected?c.protectedReadonly:member.role==='admin'?c.adminReadonly:c.viewOnly;
  const action=member.active?'suspend':'restore';
  return `<article class="jobs-staff-member" data-user-id="${id}">
   <div class="jobs-staff-identity">
    <span class="jobs-staff-avatar" aria-hidden="true">${esc(initials(member))}</span>
    <div class="jobs-staff-member-name"><strong>${esc(name)}</strong>${member.email&&member.email!==name?`<span class="jobs-meta">${esc(member.email)}</span>`:''}</div>
   </div>
   <span class="jobs-staff-role">${esc(c.roles[member.role]||member.role)}</span>
   <div class="jobs-staff-tags">
    <span class="jobs-staff-state" data-state="${state}">${esc(c[state])}</span>
    ${member.is_self?`<span class="jobs-staff-tag">${esc(c.you)}</span>`:''}
   </div>
   ${canEdit(member)?`<div class="jobs-staff-row-actions">
    <button type="button" data-staff-action="edit" aria-haspopup="dialog" aria-controls="jobs-staff-drawer" aria-label="${esc(c.editFor(name))}">${esc(c.edit)}</button>
    <div class="jobs-staff-menu">
     <button type="button" class="jobs-staff-icon-button" data-staff-action="more" aria-label="${esc(c.more(name))}" aria-expanded="false" aria-controls="jobs-staff-menu-${id}"><span aria-hidden="true">⋮</span></button>
     <div id="jobs-staff-menu-${id}" class="jobs-staff-menu-panel" inert aria-hidden="true">
      <button type="button" data-staff-action="${action}">${esc(c[action])}</button>
     </div>
    </div>
   </div>`:`<p class="jobs-staff-readonly">${esc(reason)}</p>`}
  </article>`;
 }

 function eventMarkup(event){
  const c=copy(),access=(role,active)=>role==null?'—':active?c.roles[role]||role:c.roles.none;
  const change=event.action==='granted'?access(event.new_role,event.new_active):event.action==='removed'?access(event.previous_role,event.previous_active):`${access(event.previous_role,event.previous_active)} → ${access(event.new_role,event.new_active)}`;
  const actor=event.actor_hidden?c.hiddenActor:event.actor_user_id?event.actor_email||event.actor_user_id:c.operator;
  return `<li><span><strong>${esc(c.actions[event.action]||event.action)}</strong> · ${esc(event.target_email||event.target_user_id)} · ${esc(change)}</span><span class="jobs-meta">${esc(c.by)} ${esc(actor)} · ${esc(new Date(event.created_at).toLocaleString(lang==='vi'?'vi-VN':'en-GB'))}</span></li>`;
 }

 function rowAction(id,action){
  const row=[...list.children].find(node=>node.dataset.userId===id);
  return row?.querySelector(`[data-staff-action="${action}"]`);
 }

 function closeMenu(restore=false){
  if(!menu)return;
  const {button,panel}=menu;
  menu=null;
  if(restore)button.focus({preventScroll:true});
  button.setAttribute('aria-expanded','false');
  panel.removeAttribute('data-open');
  panel.setAttribute('inert','');
  panel.setAttribute('aria-hidden','true');
 }

 function openMenu(button){
  if(menu?.button===button){closeMenu(true);return;}
  closeMenu();
  const panel=doc.getElementById(button.getAttribute('aria-controls'));
  menu={button,panel};
  button.setAttribute('aria-expanded','true');
  panel.removeAttribute('inert');
  panel.removeAttribute('aria-hidden');
  panel.setAttribute('data-open','');
  panel.querySelector('button').focus({preventScroll:true});
 }

 function renderList(){
  const c=copy(),active=doc.activeElement,id=active?.closest('[data-user-id]')?.dataset.userId;
  const action=active?.dataset.staffAction;
  closeMenu();
  const query=searchable(search.value),roleFilter=filters.elements.role.value,statusFilter=filters.elements.status.value;
  const filtered=Boolean(query||roleFilter||statusFilter),members=data?.members||[];
  const shown=members.filter(member=>
   (!query||[nameOf(member),member.email].some(value=>searchable(value).includes(query)))&&
   (!roleFilter||roleFilter===member.role)&&(!statusFilter||statusFilter===statusOf(member))
  );
  const count=$('[data-staff-count]'),countText=data?(filtered?c.filteredCount(shown.length,members.length):c.count(members.length)):'';
  if(count.textContent!==countText)count.textContent=countText;
  $('[data-staff-action=clear]').hidden=!filtered;
  list.setAttribute('aria-busy',String(blocked()));
  if(loadError){
   list.innerHTML=`<div class="jobs-alert error" role="alert"><p>${esc(loadError)}</p><button type="button" data-staff-action="refresh">${esc(c.tryAgain)}</button></div>`;
  }else if(!data){
   list.innerHTML=`<p class="jobs-empty">${esc(c.loading)}</p>`;
  }else{
   list.innerHTML=shown.length?shown.map(memberMarkup).join(''):`<p class="jobs-empty">${esc(filtered?c.noMatches:c.empty)}</p>`;
  }
  syncControls();
  if(id&&!blocked())rowAction(id,['edit','more'].includes(action)?action:'more')?.focus({preventScroll:true});
 }

 function syncControls(){
  addButton.hidden=!canAssign();
  addButton.disabled=blocked()||!canAssign();
  for(const button of root.querySelectorAll('[data-staff-action=refresh], [data-user-id] button'))button.disabled=blocked();
  list.setAttribute('aria-busy',String(blocked()));
  submit.disabled=blocked()||!editor||!data;
  if(busy&&editor)submit.setAttribute('aria-busy','true');else submit.removeAttribute('aria-busy');
  email.readOnly=blocked()||Boolean(editor?.member);
  displayName.readOnly=blocked();
  role.disabled=blocked();
 }

 function renderForm(){
  if(!editor)return;
  const c=copy(),member=editor.member;
  title.textContent=member?c.edit:c.add;
  submit.textContent=member?c.save:c.assign;
  submit.dataset.buttonVariant=member?'save':'confirm';
  $('[data-staff-assign-intro]').hidden=Boolean(member);
  $('[data-staff-owner-hint]').hidden=owner();
  $('[data-staff-form-status]').textContent=member?c[statusOf(member)]:'';
  if(email.value!==editor.email)email.value=editor.email;
  if(displayName.value!==editor.display_name)displayName.value=editor.display_name;
  displayName.placeholder=member?.name&&member.name!==member.display_name?member.name:'';
  options(role,ROLES.filter(value=>value!=='admin'||owner()).map(value=>[value,c.roles[value],c.roleHelp[value]]),editor.role);
  paintFeedback(formFeedback,editor.feedback);
 }

 function render(){
  if(disposed)return;
  const c=copy();
  for(const node of root.querySelectorAll('[data-staff-copy]'))node.textContent=c[node.dataset.staffCopy];
  closeButton.setAttribute('aria-label',c.close);
  options(filters.elements.role,[['',c.allRoles],...ROLES.map(value=>[value,c.roles[value]])]);
  options(filters.elements.status,[['',c.allStatuses],...STATUSES.map(value=>[value,c[value]])]);
  $('.jobs-staff-guide-body').innerHTML=`<dl class="jobs-staff-permissions">${[...ROLES,'none'].map(value=>`<div><dt>${esc(c.roles[value])}</dt><dd>${esc(c.roleHelp[value])}</dd></div>`).join('')}</dl>`;
  $('.jobs-staff-history').hidden=!canAssign();
  $('.jobs-staff-events').innerHTML=data?data.events.length?`<ol>${data.events.map(eventMarkup).join('')}</ol>`:`<p class="jobs-empty">${esc(c.historyEmpty)}</p>`:'';
  paintFeedback(notice,directoryFeedback);
  renderForm();renderList();
 }

 function captureDraft(){
  if(!editor)return;
  if(!editor.member)editor.email=email.value;
  editor.display_name=displayName.value;
  editor.role=role.value;
 }

 function returnFocus(member,action='edit'){
  const button=member?rowAction(member.user_id,action):addButton;
  (button&&!button.disabled?button:search).focus({preventScroll:true});
 }

 function dismissDrawer(restore=true){
  if(!editor)return;
  captureDraft();
  const member=editor.member;
  editor=null;
  if(drawer.open)drawer.close();
  syncControls();
  if(restore)returnFocus(member);
 }

 function openDrawer(draft){
  closeMenu();
  editor=draft;
  renderForm();syncControls();
  drawer.showModal();
  title.focus({preventScroll:true});
 }

 function syncDrafts(){
  if(!owner()&&addDraft.role==='admin')addDraft.role='editor';
  for(const [id,draft] of drafts){
   const member=memberFor(id);
   if(!canEdit(member)){
    if(editor===draft){
     directoryFeedback=draft.feedback;
     dismissDrawer(false);
    }
    drafts.delete(id);
    continue;
   }
   if(draft.member.version!==member.version)draft.feedback={key:'conflict'};
   if(draft.role===draft.member.role)draft.role=member.role;
   if(!owner()&&draft.role==='admin')draft.role=member.role;
   if(draft.display_name===(draft.member.display_name||''))draft.display_name=member.display_name||'';
   draft.member=member;draft.email=member.email||'';
  }
 }

 async function load(){
  if(disposed||busy)return;
  const current=++request;
  captureDraft();
  loading=true;loadError=null;renderList();
  try{
   const next=await adapter.overview();
   if(disposed||current!==request)return;
   data={viewer:next?.viewer||{},members:next?.members||[],events:next?.events||[]};
   syncDrafts();
  }catch(error){
   if(disposed||current!==request)return;
   loadError=errorText(error,lang);data=null;
   dismissDrawer(false);
  }
  if(disposed||current!==request)return;
  loading=false;render();
 }

 async function run(task,{draft=null,member=null,message}){
  busy=true;
  directoryFeedback=null;
  if(draft){draft.feedback=null;paintFeedback(formFeedback,null);}
  paintFeedback(notice,null);syncControls();
  try{
   await task();
  }catch(error){
   if(disposed)return;
   busy=false;
   const conflict=isConflictResponse(error);
   const missing=error?.message==='jobs.staff_not_found';
   const feedback=conflict?{key:'conflict'}:{error:errorText(error,lang)};
   if(draft)draft.feedback=feedback;
   if(!draft||editor!==draft||missing)directoryFeedback=feedback;
   if(conflict||missing)await load();
   else render();
   if(disposed)return;
   if(draft&&editor===draft)formFeedback.focus({preventScroll:true});
   else if(directoryFeedback)notice.focus({preventScroll:true});
   return;
  }
  if(disposed)return;
  busy=false;
  const restore=Boolean(draft&&editor===draft);
  if(restore)dismissDrawer(false);
  if(draft){if(member)drafts.delete(member.user_id);else addDraft=addValues();}
  onNotice(message(copy()),false,true);
  await load();
  if(!disposed&&(restore||!draft))returnFocus(member,draft?'edit':'more');
 }

 function submitForm(event){
  event.preventDefault();
  const draft=editor,member=draft?.member;
  if(!draft||!data||blocked()||(member&&!canEdit(memberFor(member.user_id)))||!form.reportValidity())return;
  captureDraft();
  const c=copy(),display_name=draft.display_name.trim(),selected=draft.role,address=draft.email.trim();
  if(!ROLES.includes(selected)||(selected==='admin'&&!owner()))return;
  if(member){
   if(selected===member.role&&display_name===(member.display_name||'')){
    draft.feedback={key:'noChange'};paintFeedback(formFeedback,draft.feedback);return;
   }
   if(selected!==member.role&&(selected==='admin'||member.role==='admin')&&!ask(c.confirmAdmin(address,c.roles[member.role],c.roles[selected])))return;
   void run(()=>adapter.update({...updateInput(member),role:selected,display_name}),{draft,member,message:strings=>strings.updated(address)});
  }else{
   if(selected==='admin'&&!ask(c.confirmAdmin(address,c.roles.none,c.roles.admin)))return;
   void run(()=>adapter.assign({email:address,role:selected,display_name}),{draft,message:strings=>strings.assigned(address)});
  }
 }

 function clicked(event){
  const button=event.target.closest?.('[data-staff-action]');
  if(!button)return;
  const action=button.dataset.staffAction;
  if(action==='close'){dismissDrawer();return;}
  if(action==='clear'){filters.reset();renderList();search.focus();return;}
  if(blocked())return;
  if(action==='refresh'){directoryFeedback=null;void load();return;}
  if(!data)return;
  if(action==='add'){if(canAssign())openDrawer(addDraft);return;}
  const member=memberFor(button.closest('[data-user-id]')?.dataset.userId);
  if(!canEdit(member))return;
  if(action==='edit'){
   if(!drafts.has(member.user_id))drafts.set(member.user_id,editValues(member));
   openDrawer(drafts.get(member.user_id));
  }else if(action==='more')openMenu(button);
  else if(menu?.panel.contains(button)&&(action==='suspend'||action==='restore')){
   const active=action==='restore',c=copy(),address=member.email||nameOf(member);
   closeMenu(true);
   if(active===member.active||!ask(active?c.confirmRestore(address,c.roles[member.role]):c.confirmSuspend(address)))return;
   void run(()=>adapter.update({...updateInput(member),active}),{member,message:strings=>active?strings.restored(address):strings.suspendedNotice(address)});
  }
 }

 function typed(){
  captureDraft();
  if(editor?.feedback){editor.feedback=null;paintFeedback(formFeedback,null);}
 }
 function filterChange(){renderList();}
 function preventSubmit(event){event.preventDefault();}
 function cancel(event){event.preventDefault();dismissDrawer();}
 function onClose(){if(!drawer.open)dismissDrawer();}
 function backdrop(event){
  if(event.target!==drawer)return;
  const rect=drawer.getBoundingClientRect();
  if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dismissDrawer();
 }
 function outsideMenu(event){
  if(menu&&!menu.button.parentElement.contains(event.target))closeMenu();
 }
 function menuKey(event){
  if(event.key==='Escape'&&menu){event.preventDefault();closeMenu(true);}
  if(event.key==='ArrowDown'&&event.target.matches('[data-staff-action=more]')&&!blocked()){
   event.preventDefault();
   if(menu?.button===event.target)menu.panel.querySelector('button').focus();
   else openMenu(event.target);
  }
 }

 root.addEventListener('click',clicked);
 form.addEventListener('submit',submitForm);
 form.addEventListener('input',typed);
 form.addEventListener('change',typed);
 filters.addEventListener('input',filterChange);
 filters.addEventListener('change',filterChange);
 filters.addEventListener('submit',preventSubmit);
 list.addEventListener('keydown',menuKey);
 drawer.addEventListener('cancel',cancel);
 drawer.addEventListener('close',onClose);
 drawer.addEventListener('click',backdrop);
 doc.addEventListener('pointerdown',outsideMenu);
 doc.addEventListener('focusin',outsideMenu);
 render();
 const ready=load();
 return {ready,reload:load,setLanguage(next){captureDraft();lang=next==='vi'?'vi':'en';render();},destroy(){
  if(disposed)return;
  disposed=true;request++;
  closeMenu();dismissDrawer(false);
  root.removeEventListener('click',clicked);
  doc.removeEventListener('pointerdown',outsideMenu);
  doc.removeEventListener('focusin',outsideMenu);
  root.replaceChildren();
 }};
}
