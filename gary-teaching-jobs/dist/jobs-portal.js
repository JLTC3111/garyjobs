import {db,capabilities,collections,createCmsAdapter,STAGES,STAGE_LABELS,unwrap,errorText,submitApplication,uploadCv,applicationList,transitionApplication} from './jobs-backend.js';
// Shared code contains no database credentials or cross-application authority.
import {jobsConfig} from './jobs-config.js';
import {mountCms} from './cms-foundation/index.js';
const $=s=>document.querySelector(s),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const locale=()=>{try{return JSON.parse(localStorage.getItem('gary-language'))==='vi'?'vi':'en';}catch{return 'en';}};
const accessFromUrl=url=>url.searchParams.get('access')==='staff'||(!url.searchParams.has('access')&&['cms','applications'].includes(url.searchParams.get('view')))?'staff':'candidate';
let language=locale(),user=null,caps={},view=new URL(location.href).searchParams.get('view')||'',access=accessFromUrl(new URL(location.href)),page=1,selected=null,cms=null,recovery=false,roster=[],generation=0,loading=true,capabilityError=false;
let currentViewUrl=location.href;
const t=(en,vi)=>language==='vi'?vi:en;
const stageLabel=s=>STAGE_LABELS[s]?.[language==='vi'?1:0]||s;
function status(message,error=false,retry=false){$('#portal-status').innerHTML=message?`<div class="jobs-alert ${error?'error':''}"><p>${esc(message)}</p>${retry?`<button id="portal-retry" type="button" data-action="retry">${t('Try again','Thử lại')}</button>`:''}</div>`:'';}
function renderChrome(){
 document.documentElement.lang=language;
 document.title=`${access==='staff'?t('Staff portal','Cổng nhân viên'):t('Candidate portal','Cổng ứng viên')} | Vietnam English Teaching Jobs`;
 $('.skip-link').textContent=t('Skip to content','Chuyển đến nội dung');
 $('#portal-language').textContent=language==='vi'?'English':'Tiếng Việt';
 $('#sign-out').textContent=t('Sign out','Đăng xuất');$('#sign-out').hidden=!user;
 $('#portal-access').setAttribute('aria-label',t('Choose your portal','Chọn cổng đăng nhập'));
 $('#portal-access').innerHTML=[['candidate',t('Candidate portal','Cổng ứng viên')],['staff',t('Staff portal','Cổng nhân viên')]].map(([id,label])=>`<button type="button" data-action="access" data-access="${id}" ${access===id?'aria-current="page"':''}>${label}</button>`).join('');
 $('#portal-loading').textContent=t('Checking your session…','Đang kiểm tra phiên đăng nhập…');$('#portal-loading').hidden=!loading;
 $('#auth-panel').hidden=loading||!!user&&!recovery;$('#signed-panel').hidden=loading||!user||recovery;
 $('#account-summary').textContent=user?`${t('Signed in as','Đã đăng nhập bằng')} ${user.email||''} · ${access==='staff'?t('Staff portal','Cổng nhân viên'):t('Candidate portal','Cổng ứng viên')}`:'';
 $('#workspace-nav').setAttribute('aria-label',t('Workspace','Không gian làm việc'));
}
function deadline(promise){let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('portal_timeout')),12000);})]).finally(()=>clearTimeout(timer));}
function clearWorkspace(){cms?.destroy?.({force:true});cms=null;selected=null;filterValues={};page=1;$('#workspace-nav').replaceChildren();$('#workspace-view').replaceChildren();}
function requestKey(vacancy){const key='jobs-request:'+user.id+':'+(vacancy||'general');try{let value=sessionStorage.getItem(key);if(!value){value=crypto.randomUUID();sessionStorage.setItem(key,value);}return value;}catch{return crypto.randomUUID();}}
async function guarded(task){const g=generation;try{return await task();}catch(e){if(g===generation)status(errorText(e,language),true);throw e;}}
function renderAuth(){
 $('#auth-panel').hidden=loading||!!user&&!recovery;
 if(user&&!recovery){$('#auth-panel').replaceChildren();return;}
 if(loading)return;
 const staff=access==='staff';
 $('#auth-panel').innerHTML=`<div class="jobs-auth-card"><p class="jobs-meta">${staff?t('FOR ASSIGNED TEAM MEMBERS','DÀNH CHO NHÂN VIÊN ĐƯỢC CẤP QUYỀN'):t('YOUR TEACHING JOURNEY','HÀNH TRÌNH GIẢNG DẠY CỦA BẠN')}</p><h1>${recovery?t('Set your new password','Đặt mật khẩu mới'):staff?t('Staff sign in','Đăng nhập nhân viên'):t('Candidate sign in','Đăng nhập ứng viên')}</h1><p>${staff?t('Use your existing Gary account to open your assigned Jobs content or recruitment workspace.','Dùng tài khoản Gary hiện có để mở không gian nội dung hoặc tuyển dụng Jobs được cấp quyền.'):t('Submit applications, keep your receipts and follow your recruitment progress.','Nộp hồ sơ, lưu mã tiếp nhận và theo dõi tiến độ tuyển dụng.')}</p><form id="auth-form">${!recovery?`<label>Email<input name="email" type="email" autocomplete="username" required maxlength="254"></label>`:''}<label>${t('Password','Mật khẩu')}<input name="password" type="password" autocomplete="${recovery?'new-password':'current-password'}" ${recovery?'minlength="12"':''} maxlength="128" required></label><div class="jobs-row-actions"><button type="submit" class="primary">${recovery?t('Save password','Lưu mật khẩu'):staff?t('Sign in to staff portal','Đăng nhập cổng nhân viên'):t('Sign in','Đăng nhập')}</button>${!recovery?`${!staff?`<button type="button" data-action="register">${t('Create candidate account','Tạo tài khoản ứng viên')}</button>`:''}<button type="button" data-action="reset">${t('Forgot password','Quên mật khẩu')}</button>`:''}</div></form><p class="jobs-meta">${staff?t('Staff access is assigned by your Jobs administrator. Creating a candidate account does not grant staff access.','Quản trị viên Jobs cấp quyền nhân viên. Tạo tài khoản ứng viên không cấp quyền nhân viên.'):t('New accounts must confirm their email before applying. Already part of the team? Choose Staff portal above.','Tài khoản mới cần xác minh email trước khi ứng tuyển. Nếu là nhân viên, hãy chọn Cổng nhân viên ở trên.')}</p></div>`;
}
function nav(){
 const options=access==='staff'?[...(caps.read?[['cms','Quản lý nội dung']]:[]),...(caps.recruit?[['applications','Tuyển dụng']]:[])]:[['mine',t('My applications','Hồ sơ của tôi')]];
 if(!options.some(([id])=>id===view)&&!(access==='candidate'&&view==='apply'))view=options[0]?.[0]||'';
 $('#workspace-nav').innerHTML=options.map(([id,label])=>`<button type="button" data-action="view" data-view="${id}" aria-current="${view===id?'page':'false'}">${label}</button>`).join('');
}
function setView(next){if(cms?.canLeave&&!cms.canLeave())return;generation++;clearWorkspace();view=next;const u=new URL(location.href);u.searchParams.set('view',view);u.searchParams.set('access',access);history.pushState({},'',u);currentViewUrl=u.href;void renderView().catch(e=>status(errorText(e,language),true,true));}
function setAccess(next){
 if(next===access||recovery||cms?.canLeave&&!cms.canLeave())return;
 generation++;clearWorkspace();access=next;view='';status('');const u=new URL(location.href);u.searchParams.set('access',access);u.searchParams.delete('view');if(access==='candidate'&&u.searchParams.has('vacancy'))view='apply';history.pushState({},'',u);currentViewUrl=u.href;
 void authenticate();
}
async function renderView(){
 if(!user)return;nav();const target=$('#workspace-view');target.replaceChildren();
 if(access==='staff'&&(!caps.read&&!caps.recruit||capabilityError)){
  target.innerHTML=`<div class="jobs-auth-card"><h1>${capabilityError?t('Staff access could not be checked','Chưa thể kiểm tra quyền nhân viên'):t('Staff access not assigned','Chưa được cấp quyền nhân viên')}</h1><p>${capabilityError?t('We could not load your Jobs permissions. Check your connection and try again.','Chưa thể tải quyền Jobs của bạn. Kiểm tra kết nối rồi thử lại.'):t('You are signed in, but this account has no active Jobs staff assignment. Ask your Jobs administrator to assign content or recruitment access to this email.','Bạn đã đăng nhập nhưng tài khoản chưa có quyền nhân viên Jobs đang hoạt động. Hãy nhờ quản trị viên Jobs cấp quyền nội dung hoặc tuyển dụng cho email này.')}</p><div class="jobs-row-actions"><button type="button" data-action="retry">${t('Check access again','Kiểm tra lại quyền')}</button><button type="button" data-action="access" data-access="candidate">${t('Open candidate portal','Mở cổng ứng viên')}</button></div><p class="jobs-meta">${t('To use another assigned account, sign out above and sign in again.','Để dùng tài khoản khác đã được cấp quyền, đăng xuất ở trên rồi đăng nhập lại.')}</p></div>`;return;
 }
 if(view==='cms'){
  if(!caps.read){target.textContent=t('Jobs content access is not assigned to this account.','Tài khoản này chưa được cấp quyền nội dung Jobs.');return;}
  cms=mountCms(target,{appId:'jobs',appName:'Vietnam English Teaching Jobs',language,collections,adapter:createCmsAdapter(),onNotice:m=>status(m)});return;
 }
 if(view==='apply'){await renderApplicationForm();return;}
 if(view==='applications'&&!caps.recruit){setView('mine');return;}
 await renderApplications();
}
async function renderApplicationForm(){
 const currentGeneration=generation;
 const target=$('#workspace-view'),vacancy=new URL(location.href).searchParams.get('vacancy');
 let job=null;if(vacancy){const r=await db.from('jobs_public_content').select('id,title_en,title_vi').eq('id',vacancy).eq('kind','vacancy').maybeSingle();job=unwrap(r);if(currentGeneration!==generation||!user)return;if(!job){target.innerHTML=`<p class="jobs-alert">${t('This vacancy is closed or unavailable.','Vị trí này đã đóng hoặc không còn khả dụng.')}</p>`;return;}}
 const profile=unwrap(await db.from('jobs_candidates').select('*').eq('id',user.id).maybeSingle())||{};if(currentGeneration!==generation||!user)return;
 target.innerHTML=`<h1>${t('Apply with confidence','Ứng tuyển thuận tiện')}</h1><p>${esc(job?(language==='vi'?job.title_vi:job.title_en):t('General introduction to the recruitment team','Giới thiệu chung với đội ngũ tuyển dụng'))}</p><form id="persistent-application" data-vacancy="${job?.id||''}"><div class="jobs-form-grid"><label>${t('Full name','Họ và tên')}<input name="full_name" required minlength="2" maxlength="100" autocomplete="name" value="${esc(profile.full_name)}"></label><label>${t('Verified account email','Email tài khoản đã xác minh')}<input type="email" value="${esc(user.email)}" disabled></label><label>${t('Phone / WhatsApp','Điện thoại / WhatsApp')}<input name="phone" maxlength="60" value="${esc(profile.phone)}" autocomplete="tel"></label><label>${t('Current location','Nơi đang sống')}<input name="current_location" maxlength="200" value="${esc(profile.current_location)}"></label></div><label>${t('Experience, qualifications and questions','Kinh nghiệm, bằng cấp và câu hỏi')}<textarea name="message" maxlength="5000" rows="6"></textarea></label><label>${t('CV (optional): PDF or DOCX, up to 10 MB','CV (không bắt buộc): PDF hoặc DOCX, tối đa 10 MB')}<input type="file" name="cv" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"></label><label class="consent"><input type="checkbox" name="consent" required><span>${t('I agree to this site storing my application and documents for recruitment by the Jobs team. I understand these are not shared automatically with other Gary applications.','Tôi đồng ý để trang lưu hồ sơ và tài liệu phục vụ tuyển dụng bởi đội ngũ Jobs. Hồ sơ không tự động được chia sẻ với các ứng dụng Gary khác.')}</span></label><button class="primary" type="submit">${t('Submit application','Nộp hồ sơ')}</button></form>`;
}
async function renderApplications(){
 const target=$('#workspace-view'),staff=view==='applications';
 target.innerHTML=`<h1>${staff?t('Recruitment workspace','Không gian tuyển dụng'):t('My applications','Hồ sơ của tôi')}</h1>${staff?`<form id="application-filters" class="jobs-filters"><label>${t('Role keyword','Từ khóa vị trí')}<input name="query" type="search" maxlength="80"></label><label>${t('Stage','Giai đoạn')}<select name="stage"><option value="">${t('All stages','Tất cả giai đoạn')}</option>${STAGES.map(s=>`<option value="${s}">${stageLabel(s)}</option>`).join('')}</select></label><label>${t('Assignment','Phân công')}<select name="assignee"><option value="">${t('All recruiters','Tất cả chuyên viên')}</option><option value="unassigned">${t('Unassigned','Chưa phân công')}</option>${roster.map(s=>`<option value="${s.user_id}">${esc(s.full_name)}</option>`).join('')}</select></label><button type="submit">${t('Search','Tìm kiếm')}</button></form>`:''}<div class="jobs-list" id="applications-list" aria-live="polite"></div><div class="jobs-pagination"><button data-action="previous" type="button">${t('Previous','Trước')}</button><span id="page-count"></span><button data-action="next" type="button">${t('Next','Tiếp')}</button></div><section id="application-detail"></section>`;
 await loadApplications();
}
let filterValues={},total=0;
async function loadApplications(){
 const currentGeneration=generation;
 const r=await deadline(applicationList({page,...(view==='applications'?filterValues:{candidateId:user.id})}));if(currentGeneration!==generation||!user)return;total=r.total;
 $('#applications-list').innerHTML=r.records.length?r.records.map(a=>`<article class="jobs-record"><header><div><h2>${esc(a.vacancy_title)}</h2><p class="jobs-meta">${esc(a.receipt_code)} · ${new Date(a.created_at).toLocaleDateString(language==='vi'?'vi-VN':'en-GB')}${view==='applications'?` · ${esc(a.jobs_candidates?.full_name)}`:''}</p></div><span class="jobs-stage">${stageLabel(a.stage)}</span></header><button data-action="open-application" data-id="${a.id}" type="button">${t('View application','Xem hồ sơ')}</button></article>`).join(''):view==='applications'?`<p class="jobs-empty">${t('No applications match this view.','Chưa có hồ sơ phù hợp.')}</p>`:`<div class="jobs-empty"><h2>${t('No applications yet','Bạn chưa có hồ sơ ứng tuyển')}</h2><p>${t('Your submitted applications and recruitment updates will appear here. Find an open vacancy or introduce yourself to the Jobs team.','Hồ sơ đã nộp và cập nhật tuyển dụng sẽ xuất hiện tại đây. Hãy tìm vị trí đang tuyển hoặc giới thiệu bản thân với đội ngũ Jobs.')}</p><div class="jobs-row-actions"><a class="jobs-link-button" href="./#opportunities">${t('Find vacancies','Tìm việc làm')}</a><a class="jobs-link-button" href="portal.html?access=candidate&view=apply">${t('Introduce yourself','Giới thiệu bản thân')}</a></div></div>`;
 $('#page-count').textContent=t(`Page ${page} · ${total} applications`,`Trang ${page} · ${total} hồ sơ`);$('[data-action="previous"]').disabled=page<=1;$('[data-action="next"]').disabled=page*20>=total;
}
const allowedStages=s=>({submitted:['submitted','screening','rejected','withdrawn'],screening:['screening','shortlisted','rejected','withdrawn'],shortlisted:['shortlisted','interview','rejected','withdrawn'],interview:['interview','offer','rejected','withdrawn'],offer:['offer','hired','rejected','withdrawn']}[s]||[s]);
async function openApplication(id){
 const recruiting=access==='staff'&&caps.recruit,g=generation;const [a,events,documents,notes]=await Promise.all([db.from('jobs_applications').select('*,jobs_candidates(full_name,email,phone,current_location)').eq('id',id).single(),db.from('jobs_application_events').select('*').eq('application_id',id).order('created_at',{ascending:false}).limit(100),db.from('jobs_application_documents').select('*').eq('application_id',id).order('created_at',{ascending:false}).limit(100),recruiting?db.from('jobs_recruitment_notes').select('*').eq('application_id',id).order('created_at',{ascending:false}).limit(20):Promise.resolve({data:[]})]);
 if(g!==generation)return;selected=unwrap(a);const p=selected.jobs_candidates||{};
 $('#application-detail').innerHTML=`<article class="jobs-record"><h2>${esc(selected.receipt_code)}</h2><p>${esc(selected.vacancy_title)} · <span class="jobs-stage">${stageLabel(selected.stage)}</span></p>${recruiting?`<p>${esc(p.full_name)} · ${esc(p.email)} · ${esc(p.phone)} · ${esc(p.current_location)}</p>`:''}<pre>${esc(selected.message)}</pre><div class="jobs-detail-grid"><section><h3>${t('Progress (latest 100 events)','Tiến độ (100 hoạt động gần nhất)')}</h3><ol>${unwrap(events).map(e=>`<li>${stageLabel(e.stage)} · ${new Date(e.created_at).toLocaleString(language==='vi'?'vi-VN':'en-GB')}</li>`).join('')}</ol></section><section><h3>${t('Private documents (latest 100)','Tài liệu riêng tư (100 tệp gần nhất)')}</h3><ul>${unwrap(documents).map(d=>`<li><button type="button" data-action="document" data-path="${esc(d.object_path)}">${esc(d.file_name)}</button></li>`).join('')}</ul>${selected.candidate_id===user.id?`<form id="upload-cv"><label>${t('Attach CV: PDF or DOCX, up to 10 MB','Đính kèm CV: PDF hoặc DOCX, tối đa 10 MB')}<input type="file" name="cv" accept=".pdf,.docx" required></label><button type="submit">${t('Upload privately','Tải lên riêng tư')}</button></form>`:''}</section></div>${recruiting?`<form id="transition-form"><div class="jobs-form-grid"><label>${t('Recruitment stage','Giai đoạn tuyển dụng')}<select name="stage">${allowedStages(selected.stage).map(s=>`<option value="${s}" ${s===selected.stage?'selected':''}>${stageLabel(s)}</option>`).join('')}</select></label><label>${t('Assigned recruiter','Chuyên viên phụ trách')}<select name="assignee"><option value="">${t('Unassigned','Chưa phân công')}</option>${roster.map(s=>`<option value="${s.user_id}" ${s.user_id===selected.assigned_staff_id?'selected':''}>${esc(s.full_name)}</option>`).join('')}</select></label></div><button type="submit">${t('Save stage and assignment','Lưu giai đoạn và phân công')}</button></form><h3>${t('Private recruitment notes','Ghi chú tuyển dụng riêng tư')}</h3>${unwrap(notes).map(n=>`<p>${esc(n.body)}</p>`).join('')}<p class="jobs-meta">${t('Latest 20 notes. Notes are not visible to candidates.','20 ghi chú gần nhất. Ứng viên không xem được ghi chú.')}</p><form id="note-form"><label>${t('New note','Ghi chú mới')}<textarea name="body" required maxlength="5000"></textarea></label><button type="submit">${t('Add private note','Thêm ghi chú riêng tư')}</button></form>`:''}</article>`;
 $('#application-detail').scrollIntoView({block:'start',behavior:'smooth'});
}
async function authenticate(){
 clearTimeout(authSyncTimer);
 const g=++generation;clearWorkspace();user=null;caps={};roster=[];capabilityError=false;loading=true;status('');renderChrome();
 try{
  const r=await deadline(db.auth.getUser());if(g!==generation)return;
  if(r.error&&r.error.name!=='AuthSessionMissingError')throw r.error;
  user=r.data?.user||null;
  if(user&&!recovery){
   try{const nextCaps=await deadline(capabilities());if(g!==generation)return;caps=nextCaps||{};}
   catch(e){if(g!==generation)return;capabilityError=true;status(t('Your Jobs permissions could not be loaded. Check your connection and try again.','Chưa thể tải quyền Jobs của bạn. Kiểm tra kết nối rồi thử lại.'),true,true);}
   if(access==='staff'&&caps.recruit){try{const nextRoster=unwrap(await deadline(db.rpc('jobs_staff_directory')));if(g!==generation)return;roster=nextRoster||[];}catch(e){if(g!==generation)return;status(errorText(e,language),true,true);}}
  }
  if(g!==generation)return;loading=false;renderChrome();renderAuth();
  if(user&&!recovery){if(access==='candidate'&&new URL(location.href).searchParams.has('vacancy'))view='apply';await deadline(renderView());}
 }catch(e){
  if(g!==generation)return;generation++;loading=false;renderChrome();renderAuth();
  status(e.message==='portal_timeout'?t('The portal is taking too long to respond. Check your connection and try again.','Cổng thông tin phản hồi quá lâu. Kiểm tra kết nối rồi thử lại.'):t('The portal could not be loaded. Check your connection and try again.','Chưa thể tải cổng thông tin. Kiểm tra kết nối rồi thử lại.'),true,true);
 }
}
$('#portal-language').addEventListener('click',()=>{language=language==='en'?'vi':'en';try{localStorage.setItem('gary-language',JSON.stringify(language));}catch{}renderChrome();renderAuth();if(user&&!loading&&!recovery)nav();if(cms)cms.setLanguage(language);else if(user&&!loading&&!recovery)void renderView().catch(e=>status(errorText(e,language),true,true));});
$('#sign-out').addEventListener('click',()=>{void guarded(async()=>{unwrap(await deadline(db.auth.signOut({scope:'local'})));generation++;user=null;caps={};roster=[];recovery=false;loading=false;clearWorkspace();status('');renderChrome();renderAuth();}).catch(()=>{});});
document.addEventListener('click',event=>{
 const b=event.target.closest('[data-action]');if(!b)return;const action=b.dataset.action;
 if(action==='access')setAccess(b.dataset.access);
 if(action==='retry')void authenticate();
 if(action==='view')setView(b.dataset.view);
 if(action==='previous'&&page>1){page--;void guarded(loadApplications).catch(()=>{});}
 if(action==='next'&&page*20<total){page++;void guarded(loadApplications).catch(()=>{});}
 if(action==='open-application')void guarded(()=>openApplication(b.dataset.id)).catch(()=>{});
 if(action==='document')void guarded(async()=>{const r=unwrap(await db.storage.from(jobsConfig.cvBucket).createSignedUrl(b.dataset.path,60));const a=document.createElement('a');a.href=r.signedUrl;a.target='_blank';a.rel='noopener noreferrer';a.click();}).catch(()=>{});
 if(action==='register'||action==='reset')void guarded(async()=>{
  const f=$('#auth-form');if(!f||recovery||action==='register'&&access==='staff')return;if(action==='register'&&!f.reportValidity())return;if(action==='register'&&f.elements.password.value.length<12){status(t('Use at least 12 characters for a new password.','Mật khẩu mới cần có ít nhất 12 ký tự.'),true);return;}const email=f.elements.email.value;if(!email||!f.elements.email.checkValidity()){f.elements.email.reportValidity();return;}
  b.disabled=true;try{const redirect=new URL('./portal.html',location.href).href;
   if(action==='register'){unwrap(await db.auth.signUp({email,password:f.elements.password.value,options:{emailRedirectTo:redirect}}));status(t('Check your email to confirm your account, then sign in.','Kiểm tra email để xác minh tài khoản, sau đó đăng nhập.'));}
   else {unwrap(await db.auth.resetPasswordForEmail(email,{redirectTo:redirect}));status(t('If this account exists, a recovery email will arrive shortly.','Nếu tài khoản tồn tại, email khôi phục sẽ sớm được gửi.'));}
  }finally{b.disabled=false;}
 }).catch(()=>{});
});
document.addEventListener('submit',event=>{
 const form=event.target;if(!['auth-form','persistent-application','application-filters','transition-form','note-form','upload-cv'].includes(form.id))return;event.preventDefault();const data=new FormData(form),button=form.querySelector('button[type="submit"]');
 void guarded(async()=>{
  const actor=user?.id;
  if(button)button.disabled=true;
  try{
   if(form.id==='auth-form'){
    if(recovery){unwrap(await deadline(db.auth.updateUser({password:String(data.get('password'))})));recovery=false;status(t('Password saved.','Đã lưu mật khẩu.'));await authenticate();}
    else{unwrap(await deadline(db.auth.signInWithPassword({email:String(data.get('email')),password:String(data.get('password'))})));await authenticate();}
   }
   if(form.id==='persistent-application'){
    const vacancy=form.dataset.vacancy||null,cv=data.get('cv');if(cv?.size) {const {validateCv}=await import('./jobs-backend.js');validateCv(cv);}
    const r=await submitApplication({vacancyId:vacancy,profile:{full_name:data.get('full_name'),phone:data.get('phone'),current_location:data.get('current_location'),consent:data.get('consent')==='on'},message:String(data.get('message')||''),requestId:requestKey(vacancy)});
    if(actor!==user?.id)return;
    let uploaded=true;if(cv?.size){try{await uploadCv(r,cv);}catch{uploaded=false;}}
    if(actor!==user?.id)return;
    try{sessionStorage.removeItem('jobs-request:'+user.id+':'+(vacancy||'general'));}catch{}
    const u=new URL(location.href);u.searchParams.delete('vacancy');u.searchParams.set('view','mine');history.replaceState({},'',u);currentViewUrl=u.href;view='mine';await renderView();
    status(t(`Application saved. Receipt: ${r.receipt_code}. ${uploaded?'':'Your CV upload failed; open your application to retry.'}`,`Đã lưu hồ sơ. Mã tiếp nhận: ${r.receipt_code}. ${uploaded?'':'Tải CV thất bại; mở hồ sơ để thử lại.'}`));
   }
   if(form.id==='application-filters'){filterValues=Object.fromEntries(data);page=1;await loadApplications();}
   if(form.id==='transition-form'){const updated=await transitionApplication(selected.id,String(data.get('stage')),String(data.get('assignee')),selected.version);if(actor!==user?.id)return;selected=updated;await loadApplications();await openApplication(selected.id);status(t('Stage and assignment saved.','Đã lưu giai đoạn và phân công.'));}
   if(form.id==='note-form'){unwrap(await db.from('jobs_recruitment_notes').insert({application_id:selected.id,body:String(data.get('body'))}));await openApplication(selected.id);}
   if(form.id==='upload-cv'){await uploadCv(selected,data.get('cv'));await openApplication(selected.id);status(t('Private CV saved.','Đã lưu CV riêng tư.'));}
  }finally{if(button?.isConnected)button.disabled=false;}
 }).catch(()=>{});
});
window.addEventListener('popstate',()=>{
 const nextUrl=new URL(location.href);
 if(cms?.canLeave&&!cms.canLeave()){history.pushState({},'',currentViewUrl);return;}
 cms?.destroy?.({force:true});cms=null;filterValues={};selected=null;page=1;
 generation++;access=accessFromUrl(nextUrl);view=nextUrl.searchParams.get('view')||'';currentViewUrl=nextUrl.href;
 void authenticate();
});
let authSyncTimer;
db.auth.onAuthStateChange((event,session)=>{
 if(event==='PASSWORD_RECOVERY'){clearTimeout(authSyncTimer);generation++;clearWorkspace();recovery=true;loading=false;user=session?.user||user;renderChrome();renderAuth();return;}
 if(event==='SIGNED_OUT'){clearTimeout(authSyncTimer);generation++;clearWorkspace();user=null;caps={};roster=[];recovery=false;loading=false;status('');renderChrome();renderAuth();return;}
 if(!['INITIAL_SESSION','SIGNED_IN','TOKEN_REFRESHED','USER_UPDATED'].includes(event)||recovery)return;
 // Supabase may emit SIGNED_IN again on tab focus. Keep an active editor intact.
 if(session?.user?.id===user?.id&&!loading)return;
 clearTimeout(authSyncTimer);authSyncTimer=setTimeout(()=>void authenticate(),0);
});
renderChrome();void authenticate();
