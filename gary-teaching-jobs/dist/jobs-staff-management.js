// Presentation only: the Jobs staff RPCs re-check every permission against current database state.
const ROLES=['editor','publisher','recruiter','admin'];
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const COPY={
 en:{
  eyebrow:'TEACHING JOBS ADMINISTRATION',title:'Staff management',
  intro:'Assign, change, suspend and restore Teaching Jobs staff roles. Jobs access never changes a person’s Gary sign-in, password, or Home and Visa access.',
  assignTitle:'Assign Jobs access',assignIntro:'Use the email of an existing Gary account that has already been verified. No account is created and no password is sent.',
  email:'Account email',displayName:'Display name (optional)',role:'Role',assign:'Assign access',
  adminOwnerOnly:'Administrator access can only be granted by a protected Jobs owner.',
  guideTitle:'Role permissions',guideRole:'Role',guideAllows:'What it allows',
  roles:{editor:'Editor',publisher:'Publisher',recruiter:'Recruiter',admin:'Admin',none:'No access'},
  roleHelp:{editor:'Create and edit content drafts, revisions and media. Cannot publish, archive or open recruitment.',publisher:'Everything an Editor can do, plus publish and archive content.',recruiter:'Recruitment only: applications, candidate details, CVs, stages, assignments and private notes.',admin:'All content and recruitment permissions, plus this staff management page.',none:'Suspended. The membership, history and recruitment assignments are kept, but no Jobs staff workspace opens.'},
  rulesTitle:'Protected access',
  rules:['You cannot change your own access.','Protected accounts are view-only here and change only through the reviewed owner process.','Only a protected Jobs owner can grant, change or suspend Administrator access.','At least one active administrator must always remain.','Every change is recorded with who made it and when.'],
  directoryTitle:'Jobs staff',count:n=>`${n} ${n===1?'membership':'memberships'}, including suspended access`,
  refresh:'Refresh',loading:'Loading staff…',empty:'No Jobs staff memberships yet.',tryAgain:'Try again',
  active:'Active',suspended:'Suspended · no access',unverified:'Email not verified · no access',you:'You',protectedTag:'Protected',
  selfReadonly:'Your account · view only',protectedReadonly:'Protected account · view only',adminReadonly:'Administrator · only a protected owner can change this',
  access:'Access',name:'Display name',save:'Save changes',
  assigned:email=>`Jobs access assigned to ${email}.`,updated:email=>`Access updated for ${email}.`,noChange:'No changes to save.',
  confirmSuspend:email=>`Suspend Jobs access for ${email}? Their history and recruitment assignments are kept.`,
  confirmAdmin:(email,from,to)=>`Change Administrator access for ${email} from ${from} to ${to}?`,
  historyTitle:'Recent access changes',historyNote:'Latest 50 changes, including database operator changes.',historyEmpty:'No access changes recorded yet.',operator:'Database operator',by:'By',
  actions:{granted:'Access assigned',role_changed:'Role changed',suspended:'Access suspended',restored:'Access restored',protected:'Marked protected',unprotected:'Protection removed',removed:'Membership removed'},
 },
 vi:{
  eyebrow:'QUẢN TRỊ TEACHING JOBS',title:'Quản lý nhân viên',
  intro:'Cấp, thay đổi, tạm ngưng và khôi phục vai trò nhân viên Teaching Jobs. Quyền Jobs không thay đổi đăng nhập, mật khẩu Gary hay quyền Home và Visa của người đó.',
  assignTitle:'Cấp quyền Jobs',assignIntro:'Dùng email của tài khoản Gary hiện có đã được xác minh. Hệ thống không tạo tài khoản và không gửi mật khẩu.',
  email:'Email tài khoản',displayName:'Tên hiển thị (không bắt buộc)',role:'Vai trò',assign:'Cấp quyền',
  adminOwnerOnly:'Chỉ chủ sở hữu Jobs được bảo vệ mới có thể cấp quyền Quản trị viên.',
  guideTitle:'Quyền theo vai trò',guideRole:'Vai trò',guideAllows:'Được phép',
  roles:{editor:'Biên tập viên',publisher:'Người xuất bản',recruiter:'Chuyên viên tuyển dụng',admin:'Quản trị viên',none:'Không có quyền'},
  roleHelp:{editor:'Tạo và sửa bản nháp, phiên bản và tư liệu. Không thể xuất bản, lưu trữ hay mở tuyển dụng.',publisher:'Mọi quyền của Biên tập viên, thêm quyền xuất bản và lưu trữ nội dung.',recruiter:'Chỉ tuyển dụng: hồ sơ ứng tuyển, thông tin ứng viên, CV, giai đoạn, phân công và ghi chú riêng tư.',admin:'Toàn bộ quyền nội dung và tuyển dụng, thêm trang quản lý nhân viên này.',none:'Đã tạm ngưng. Tư cách thành viên, lịch sử và phân công tuyển dụng được giữ lại nhưng không mở được không gian nhân viên Jobs.'},
  rulesTitle:'Quyền được bảo vệ',
  rules:['Bạn không thể tự thay đổi quyền của mình.','Tài khoản được bảo vệ chỉ được xem tại đây và chỉ thay đổi qua quy trình chủ sở hữu đã được duyệt.','Chỉ chủ sở hữu Jobs được bảo vệ mới có thể cấp, thay đổi hoặc tạm ngưng quyền Quản trị viên.','Luôn phải còn ít nhất một quản trị viên đang hoạt động.','Mọi thay đổi đều được ghi lại cùng người thực hiện và thời gian.'],
  directoryTitle:'Nhân viên Jobs',count:n=>`${n} thành viên, gồm cả quyền đã tạm ngưng`,
  refresh:'Làm mới',loading:'Đang tải danh sách nhân viên…',empty:'Chưa có thành viên nhân viên Jobs.',tryAgain:'Thử lại',
  active:'Đang hoạt động',suspended:'Đã tạm ngưng · không có quyền',unverified:'Email chưa xác minh · không có quyền',you:'Bạn',protectedTag:'Được bảo vệ',
  selfReadonly:'Tài khoản của bạn · chỉ xem',protectedReadonly:'Tài khoản được bảo vệ · chỉ xem',adminReadonly:'Quản trị viên · chỉ chủ sở hữu được bảo vệ mới có thể thay đổi',
  access:'Quyền truy cập',name:'Tên hiển thị',save:'Lưu thay đổi',
  assigned:email=>`Đã cấp quyền Jobs cho ${email}.`,updated:email=>`Đã cập nhật quyền của ${email}.`,noChange:'Không có thay đổi để lưu.',
  confirmSuspend:email=>`Tạm ngưng quyền Jobs của ${email}? Lịch sử và phân công tuyển dụng vẫn được giữ lại.`,
  confirmAdmin:(email,from,to)=>`Đổi quyền Quản trị viên của ${email} từ ${from} sang ${to}?`,
  historyTitle:'Thay đổi quyền gần đây',historyNote:'50 thay đổi gần nhất, gồm cả thay đổi của quản trị cơ sở dữ liệu.',historyEmpty:'Chưa có thay đổi quyền nào được ghi lại.',operator:'Quản trị cơ sở dữ liệu',by:'Bởi',
  actions:{granted:'Đã cấp quyền',role_changed:'Đã đổi vai trò',suspended:'Đã tạm ngưng quyền',restored:'Đã khôi phục quyền',protected:'Đã đánh dấu bảo vệ',unprotected:'Đã bỏ bảo vệ',removed:'Đã xoá tư cách thành viên'},
 },
};
const emptyDraft=()=>({email:'',display_name:'',role:'editor'});

export function mountStaffManagement(root,{adapter,language='en',errorText=error=>error?.message||String(error),confirm,onNotice=()=>{}}={}){
 const doc=root.ownerDocument,ask=confirm||(message=>doc.defaultView.confirm(message));
 let lang=language==='vi'?'vi':'en',data={viewer:{},members:[],events:[]},loading=true,loadError='',busy=false,disposed=false,request=0,draft=emptyDraft();
 const copy=()=>COPY[lang];
 function roleOptions(selected,{admin,none}){
  const c=copy();
  return [...ROLES.filter(role=>role!=='admin'||admin),...(none?['none']:[])].map(role=>`<option value="${role}"${role===selected?' selected':''}>${esc(c.roles[role])}</option>`).join('');
 }
 function memberMarkup(member,adminAllowed){
  const c=copy(),state=!member.active?'suspended':member.email_confirmed?'active':'unverified';
  const reason=member.is_self?c.selfReadonly:member.protected?c.protectedReadonly:c.adminReadonly;
  const controls=member.can_manage?`<form class="jobs-staff-manage" data-staff-form="update" data-user-id="${esc(member.user_id)}"><label>${esc(c.access)}<select name="access" data-focus="${esc(member.user_id)}:access" aria-label="${esc(c.access+' · '+member.email)}">${roleOptions(member.active?member.role:'none',{admin:adminAllowed,none:true})}</select></label><label>${esc(c.name)}<input name="display_name" maxlength="120" autocomplete="off" data-focus="${esc(member.user_id)}:name" aria-label="${esc(c.name+' · '+member.email)}" value="${esc(member.display_name)}"></label><button type="submit" data-focus="${esc(member.user_id)}:save" data-button-variant="save">${esc(c.save)}</button></form>`:`<p class="jobs-staff-readonly">${esc(reason)}</p>`;
  return `<article class="jobs-staff-member" data-user-id="${esc(member.user_id)}"><div class="jobs-staff-identity"><strong>${esc(member.name||member.email)}</strong>${member.name?`<span class="jobs-meta">${esc(member.email)}</span>`:''}<div class="jobs-staff-tags"><span class="jobs-staff-role">${esc(c.roles[member.role]||member.role)}</span><span class="jobs-staff-state" data-state="${state}">${esc(c[state])}</span>${member.protected?`<span class="jobs-staff-tag">${esc(c.protectedTag)}</span>`:''}${member.is_self?`<span class="jobs-staff-tag">${esc(c.you)}</span>`:''}</div></div>${controls}</article>`;
 }
 function eventMarkup(event){
  const c=copy(),access=(role,active)=>role==null?'—':active?c.roles[role]||role:c.roles.none;
  const change=event.action==='granted'?access(event.new_role,event.new_active):event.action==='removed'?access(event.previous_role,event.previous_active):`${access(event.previous_role,event.previous_active)} → ${access(event.new_role,event.new_active)}`;
  const actor=event.actor_user_id?event.actor_email||event.actor_user_id:c.operator;
  return `<li><span><strong>${esc(c.actions[event.action]||event.action)}</strong> · ${esc(event.target_email||event.target_user_id)} · ${esc(change)}</span><span class="jobs-meta">${esc(c.by)} ${esc(actor)} · ${esc(new Date(event.created_at).toLocaleString(lang==='vi'?'vi-VN':'en-GB'))}</span></li>`;
 }
 function render(){
  if(disposed)return;
  const c=copy(),adminAllowed=data.viewer?.can_manage_admins===true,active=doc.activeElement,focus=root.contains(active)?active.dataset?.focus:'';
  if(draft.role==='admin'&&!adminAllowed)draft.role='editor';
  const list=loadError?`<div class="jobs-alert error" role="alert"><p>${esc(loadError)}</p><button type="button" data-staff-action="refresh" data-focus="retry">${esc(c.tryAgain)}</button></div>`
   :loading&&!data.members.length?`<p class="jobs-empty">${esc(c.loading)}</p>`
   :data.members.length?data.members.map(member=>memberMarkup(member,adminAllowed)).join(''):`<p class="jobs-empty">${esc(c.empty)}</p>`;
  root.innerHTML=`<section class="jobs-staff-admin" aria-labelledby="jobs-staff-title"><header class="jobs-staff-admin-header"><p class="jobs-staff-eyebrow">${esc(c.eyebrow)}</p><h1 id="jobs-staff-title">${esc(c.title)}</h1><p>${esc(c.intro)}</p></header>
<div class="jobs-staff-grid"><form class="jobs-staff-panel jobs-staff-assign" data-staff-form="assign" aria-labelledby="jobs-staff-assign-title"><h2 id="jobs-staff-assign-title">${esc(c.assignTitle)}</h2><p class="jobs-meta">${esc(c.assignIntro)}</p><label>${esc(c.email)}<input name="email" type="email" required maxlength="254" autocomplete="off" spellcheck="false" data-focus="assign-email" value="${esc(draft.email)}"></label><label>${esc(c.displayName)}<input name="display_name" maxlength="120" autocomplete="off" data-focus="assign-name" value="${esc(draft.display_name)}"></label><label>${esc(c.role)}<select name="role" data-focus="assign-role">${roleOptions(draft.role,{admin:adminAllowed,none:false})}</select></label>${adminAllowed?'':`<p class="jobs-meta">${esc(c.adminOwnerOnly)}</p>`}<button class="primary" type="submit" data-focus="assign-submit" data-button-variant="confirm">${esc(c.assign)}</button></form>
<aside class="jobs-staff-panel jobs-staff-guide" aria-labelledby="jobs-staff-guide-title"><h2 id="jobs-staff-guide-title">${esc(c.guideTitle)}</h2><table class="jobs-staff-permissions"><thead><tr><th scope="col">${esc(c.guideRole)}</th><th scope="col">${esc(c.guideAllows)}</th></tr></thead><tbody>${[...ROLES,'none'].map(role=>`<tr><th scope="row">${esc(c.roles[role])}</th><td>${esc(c.roleHelp[role])}</td></tr>`).join('')}</tbody></table><h3>${esc(c.rulesTitle)}</h3><ul>${c.rules.map(rule=>`<li>${esc(rule)}</li>`).join('')}</ul></aside></div>
<section class="jobs-staff-panel jobs-staff-directory" aria-labelledby="jobs-staff-directory-title"><header><div><h2 id="jobs-staff-directory-title">${esc(c.directoryTitle)}</h2><p class="jobs-meta">${esc(c.count(data.members.length))}</p></div><button type="button" data-staff-action="refresh" data-focus="refresh">${esc(c.refresh)}</button></header><div class="jobs-staff-list" aria-busy="${loading}">${list}</div></section>
<section class="jobs-staff-panel jobs-staff-history" aria-labelledby="jobs-staff-history-title"><h2 id="jobs-staff-history-title">${esc(c.historyTitle)}</h2><p class="jobs-meta">${esc(c.historyNote)}</p>${data.events.length?`<ol>${data.events.map(eventMarkup).join('')}</ol>`:`<p class="jobs-empty">${esc(c.historyEmpty)}</p>`}</section></section>`;
  for(const button of root.querySelectorAll('button'))button.disabled=busy;
  if(focus)[...root.querySelectorAll('[data-focus]')].find(element=>element.dataset.focus===focus)?.focus({preventScroll:true});
 }
 async function load(){
  const current=++request;loading=true;loadError='';render();
  try{const next=await adapter.overview();if(disposed||current!==request)return;data={viewer:next?.viewer||{},members:next?.members||[],events:next?.events||[]};}
  catch(error){if(disposed||current!==request)return;loadError=errorText(error,lang);}
  if(disposed||current!==request)return;loading=false;render();
 }
 async function run(task){
  if(busy)return;busy=true;for(const button of root.querySelectorAll('button'))button.disabled=true;
  let changed=false;
  try{await task();changed=true;}catch(error){if(!disposed)onNotice(errorText(error,lang),true);}
  busy=false;
  if(disposed)return;
  if(changed)await load();else for(const button of root.querySelectorAll('button'))button.disabled=false;
 }
 function assign(form){
  if(!form.reportValidity())return;
  const c=copy(),email=form.elements.email.value.trim(),role=form.elements.role.value,display_name=form.elements.display_name.value.trim();
  if(role==='admin'&&!ask(c.confirmAdmin(email,c.roles.none,c.roles.admin)))return;
  return run(async()=>{await adapter.assign({email,role,display_name});if(!disposed){draft=emptyDraft();onNotice(c.assigned(email),false,true);}});
 }
 function update(form){
  const c=copy(),member=data.members.find(item=>item.user_id===form.dataset.userId);if(!member)return;
  const access=form.elements.access.value,display_name=form.elements.display_name.value.trim(),current=member.active?member.role:'none';
  if(access===current&&display_name===(member.display_name||'')){onNotice(c.noChange);return;}
  if(access==='none'&&member.active&&!ask(c.confirmSuspend(member.email)))return;
  if(access!=='none'&&access!==current&&(access==='admin'||current==='admin')&&!ask(c.confirmAdmin(member.email,c.roles[current],c.roles[access])))return;
  const active=access!=='none';
  return run(async()=>{await adapter.update({user_id:member.user_id,role:active?access:member.role,active,display_name,version:member.version});if(!disposed)onNotice(c.updated(member.email),false,true);});
 }
 function submitted(event){
  const form=event.target.closest?.('[data-staff-form]');if(!form||!root.contains(form))return;
  event.preventDefault();if(busy)return;
  void (form.dataset.staffForm==='assign'?assign(form):update(form));
 }
 function clicked(event){if(event.target.closest?.('[data-staff-action="refresh"]')&&!busy)void load();}
 function typed(event){const form=event.target.closest?.('[data-staff-form="assign"]');if(form&&event.target.name in draft)draft[event.target.name]=event.target.value;}
 root.addEventListener('submit',submitted);root.addEventListener('click',clicked);root.addEventListener('input',typed);root.addEventListener('change',typed);
 const ready=load();
 return {ready,reload:load,setLanguage(next){lang=next==='vi'?'vi':'en';render();},destroy(){disposed=true;root.removeEventListener('submit',submitted);root.removeEventListener('click',clicked);root.removeEventListener('input',typed);root.removeEventListener('change',typed);}};
}
