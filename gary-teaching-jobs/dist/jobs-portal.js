import {db,capabilities,collections,createCmsAdapter,createStaffAdapter,STAGES,STAGE_LABELS,unwrap,errorText,submitApplication,uploadCv,applicationList,transitionApplication} from './jobs-backend.js';
// Shared code contains no database credentials or cross-application authority.
import {jobsConfig} from './jobs-config.js';
import {mountCms} from './cms-foundation/index.js';
import {mountStaffManagement} from './jobs-staff-management.js';
import {showActionToast,setCounterValues,clearCounterValues} from './action-toast.js';
import {createTalentAdapter} from './jobs-talent-data.js';
import {mountTalentPool} from './jobs-talent-pool.js';
import {mountJobsAccountMenu} from './jobs-account-menu.js';

const $=s=>document.querySelector(s),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function startLattice(target,{pattern,grid,label,cellSize=5,gap=2,fontSize=12,status=false,reserve=false}={}){
 const api=globalThis.garyLattice;if(!api||!target)return ()=>{};
 const slot=document.createElement('div');slot.className='lattice-slot';if(reserve)slot.dataset.reserve='';target.append(slot);
 const cancel=api.showDelayedLattice(slot,{pattern,grid,label,cellSize,gap,fontSize,status});
 return ()=>{cancel();if(slot.isConnected)slot.remove()};
}
function holdLattice(target,label){
 if(!target)return ()=>{};
 const slot=document.createElement('div');slot.className='lattice-slot';slot.dataset.reserve='';slot.dataset.latticeHold='';target.prepend(slot);
 const api=globalThis.garyLattice;if(!api)return ()=>{slot.remove()};
 const cancel=api.showDelayedLattice(slot,{pattern:'ripple',grid:4,label,cellSize:5,gap:2,fontSize:12,status:true});
 return ()=>{cancel();slot.remove()};
}
function workspaceBody(){return document.querySelector('#workspace-view [data-workspace-body]')||$('#workspace-view');}
let stopContentLattice=()=>{};
function holdContent(label){
 stopContentLattice();
 const stop=holdLattice($('#workspace-view'),label);
 let current=true;
 const cancel=()=>{if(!current)return;current=false;stop();if(stopContentLattice===cancel)stopContentLattice=()=>{};};
 stopContentLattice=cancel;return cancel;
}
const locale=()=>{try{return JSON.parse(localStorage.getItem('gary-language'))==='vi'?'vi':'en';}catch{return 'en';}};
const accessFromUrl=url=>url.searchParams.get('access')==='staff'||(!url.searchParams.has('access')&&['cms','applications','talent','staff'].includes(url.searchParams.get('view')))?'staff':'candidate';
let language=locale(),user=null,caps={},view=new URL(location.href).searchParams.get('view')||'',access=accessFromUrl(new URL(location.href)),page=1,selected=null,cms=null,staffPage=null,recovery=false,roster=[],generation=0,loading=true,capabilityError=false;
let currentViewUrl=location.href, staffCollection=collectionFromUrl(new URL(location.href));
let talentPage=null;
const t=(en,vi)=>language==='vi'?vi:en;
const stageLabel=s=>STAGE_LABELS[s]?.[language==='vi'?1:0]||s;
function success(message){return showActionToast(document,message,{language});}
function status(message,error=false,retry=false){$('#portal-status').innerHTML=message?`<div class="jobs-alert ${error?'error':''}"><p>${esc(message)}</p>${retry?`<button id="portal-retry" type="button" data-action="retry">${t('Try again','Thử lại')}</button>`:''}</div>`:'';}
function renderChrome(){
 document.documentElement.lang=language;
 document.body.dataset.jobsStaff=String(!!user&&access==='staff'&&!loading&&!recovery&&(caps.read||caps.recruit));
 document.title=`${access==='staff'?t('Staff portal','Cổng nhân viên'):t('Candidate portal','Cổng ứng viên')} | Vietnam English Teaching Jobs`;
 $('.skip-link').textContent=t('Skip to content','Chuyển đến nội dung');
 $('#portal-language').textContent=language==='vi'?'English':'Tiếng Việt';$('#portal-language').lang=language==='vi'?'en':'vi';
 accountMenu.update({language,user:recovery?null:user,caps,loading});
 $('#portal-access').setAttribute('aria-label',t('Choose your portal','Chọn cổng đăng nhập'));
 $('#portal-access').innerHTML=[['candidate',t('Candidate portal','Cổng ứng viên')],['staff',t('Staff portal','Cổng nhân viên')]].map(([id,label])=>`<button type="button" data-action="access" data-access="${id}" ${access===id?'aria-current="page"':''}>${label}</button>`).join('');
 $('#portal-loading').textContent=t('Checking your session…','Đang kiểm tra phiên đăng nhập…');$('#portal-loading').hidden=!loading;
 $('#auth-panel').hidden=loading||!!user&&!recovery;$('#signed-panel').hidden=loading||!user||recovery;
 $('#account-summary').textContent=user?`${t('Signed in as','Đã đăng nhập bằng')} ${user.email||''} · ${access==='staff'?t('Staff portal','Cổng nhân viên'):t('Candidate portal','Cổng ứng viên')}`:'';
 $('#workspace-nav').setAttribute('aria-label',t('Workspace','Không gian làm việc'));
 document.dispatchEvent(new CustomEvent('jobs:staff-navigation'));
}
function deadline(promise){let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('portal_timeout')),12000);})]).finally(()=>clearTimeout(timer));}
function clearWorkspace(keepStats=false,keepNavigation=keepStats){cms?.destroy?.({force:true});cms=null;staffPage?.destroy();staffPage=null;talentPage?.destroy();talentPage=null;selected=null;filterValues={};page=1;if(!keepNavigation)$('#workspace-nav').replaceChildren();$('#workspace-view').replaceChildren();if(!keepStats)resetRecruitmentStats();}
const mayLeave=()=>(cms?.canLeave?.()??true)&&(talentPage?.canLeave()??true);
function requestKey(vacancy){const key='jobs-request:'+user.id+':'+(vacancy||'general');try{let value=sessionStorage.getItem(key);if(!value){value=crypto.randomUUID();sessionStorage.setItem(key,value);}return value;}catch{return crypto.randomUUID();}}
async function guarded(task){const g=generation;try{return await task();}catch(e){if(g===generation){status(errorText(e,language),true);if(e?.code==='42501'||[401,403].includes(e?.status))schedulePermissionRefresh(true);}throw e;}}
function renderAuth(){
 $('#auth-panel').hidden=loading||!!user&&!recovery;
 if(user&&!recovery){$('#auth-panel').replaceChildren();return;}
 if(loading)return;
 const staff=access==='staff';
 $('#auth-panel').innerHTML=`<div class="jobs-auth-card"><p class="jobs-meta">${staff?t('FOR ASSIGNED TEAM MEMBERS','DÀNH CHO NHÂN VIÊN ĐƯỢC CẤP QUYỀN'):t('YOUR TEACHING JOURNEY','HÀNH TRÌNH GIẢNG DẠY CỦA BẠN')}</p><h1>${recovery?t('Set your new password','Đặt mật khẩu mới'):staff?t('Staff sign in','Đăng nhập nhân viên'):t('Candidate sign in','Đăng nhập ứng viên')}</h1><p>${staff?t('Use your existing Gary account to open your assigned Jobs content or recruitment workspace.','Dùng tài khoản Gary hiện có để mở không gian nội dung hoặc tuyển dụng Jobs được cấp quyền.'):t('Submit applications, keep your receipts and follow your recruitment progress.','Nộp hồ sơ, lưu mã tiếp nhận và theo dõi tiến độ tuyển dụng.')}</p><form id="auth-form">${!recovery?`<label>Email<input name="email" type="email" autocomplete="username" required maxlength="254"></label>`:''}<label>${t('Password','Mật khẩu')}<input name="password" type="password" autocomplete="${recovery?'new-password':'current-password'}" ${recovery?'minlength="12"':''} maxlength="128" required></label><div class="jobs-row-actions"><button type="submit" class="primary"${recovery?' data-button-variant="save"':''}>${recovery?t('Save password','Lưu mật khẩu'):staff?t('Sign in to staff portal','Đăng nhập cổng nhân viên'):t('Sign in','Đăng nhập')}</button>${!recovery?`${!staff?`<button type="button" data-action="register">${t('Create candidate account','Tạo tài khoản ứng viên')}</button>`:''}<button type="button" data-action="reset">${t('Forgot password','Quên mật khẩu')}</button>`:''}</div></form><p class="jobs-meta">${staff?t('Ask a Jobs administrator to use Staff Management to assign content or recruitment access. New administrator access requires the Jobs owner. Home/Visa roles and candidate registration do not grant Jobs staff access.','Nhờ quản trị viên Jobs cấp quyền nội dung hoặc tuyển dụng trong Quản lý nhân viên. Quyền quản trị mới cần chủ sở hữu Jobs cấp. Quyền Home/Visa và đăng ký ứng viên không cấp quyền nhân viên Jobs.'):t('New accounts must confirm their email before applying. Already part of the team? Choose Staff portal above.','Tài khoản mới cần xác minh email trước khi ứng tuyển. Nếu là nhân viên, hãy chọn Cổng nhân viên ở trên.')}</p></div>`;
}
function collectionFromUrl(url){
 const destination=url.searchParams.get('collection');
 return destination==='media'||collections.some(item=>item.kind===destination)?destination:'vacancy';
}
function writeWorkspaceRoute(method){
 const url=new URL(location.href);
 url.searchParams.set('access',access);
 if(view)url.searchParams.set('view',view);else url.searchParams.delete('view');
 if(view==='cms'&&staffCollection!=='vacancy')url.searchParams.set('collection',staffCollection);
 else url.searchParams.delete('collection');
 if(url.href!==location.href)history[method]({},'',url);
 currentViewUrl=url.href;
}
function updateCmsNavigation(next){
 if(next)staffCollection=next.view==='media'?'media':next.kind;
 for(const button of document.querySelectorAll('#workspace-nav [data-action="staff-collection"]')){
  button.setAttribute('aria-current',view==='cms'&&button.dataset.collection===staffCollection?'page':'false');
 }
 for(const button of document.querySelectorAll('#workspace-nav [data-action="view"]'))button.setAttribute('aria-current',button.dataset.view===view?'page':'false');
 document.dispatchEvent(new CustomEvent('jobs:staff-navigation'));
}
function staffNavGroups(){
 const collectionsNav={
  vacancy:['Vacancies','Tin tuyển dụng','file-text'],
  employer:['Employers','Nhà tuyển dụng','building-2'],
  category:['Job Categories','Danh mục việc làm','layout-grid'],
  location:['Locations','Địa điểm','map-pin'],
  guide:['Guides','Cẩm nang','book-open-text'],
  faq:['FAQs','Câu hỏi thường gặp','circle-help'],
  media:['Media Library','Thư viện tư liệu','folder-open']
 };
 const content=(...kinds)=>caps.read?kinds.filter(kind=>kind==='media'||collections.some(item=>item.kind===kind)).map(id=>{
  const [en,vi,icon]=collectionsNav[id];
  return {id,collection:true,label:t(en,vi),icon};
 }):[];
 const recruitment=content('vacancy');
 if(caps.recruit)recruitment.push({id:'applications',label:t('Recruitment','Tuyển dụng'),icon:'clipboard-list'});
 if(caps.recruit===true)recruitment.push({id:'talent',label:t('Talent Pool','Nguồn ứng viên'),icon:'user-search'});
 return [
  ['recruitment',t('Recruitment','Tuyển dụng'),'briefcase-business',recruitment],
  ['directory',t('Directories','Danh mục'),'list-tree',content('employer','category','location')],
  ['knowledge',t('Guides & answers','Cẩm nang & giải đáp'),'library-big',content('guide','faq')],
  ['media',t('Content & media','Nội dung & tư liệu'),'images',content('media')],
  ['administration',t('Administration','Quản trị'),'shield-check',caps.manage_staff?[{id:'staff',label:t('Staff management','Quản lý nhân viên'),icon:'key-round'}]:[]]
 ].filter(([, , ,items])=>items.length);
}
function renderStaffNavigation(nav){
 const groups=staffNavGroups();
 const existing=new Map([...nav.querySelectorAll(':scope > [data-jobs-nav-group]')].map(section=>[section.dataset.jobsNavGroup,section]));
 nav.querySelector(':scope > [data-action="view"]')?.remove();
 for(const [name,section] of existing)if(!groups.some(([id])=>id===name))section.remove();
 let previousGroup;
 for(const [name,label,icon,items] of groups){
  let section=existing.get(name);
  if(!section){
   section=document.createElement('section');section.dataset.jobsNavGroup=name;section.className='branched-menu__section';section.dataset.open='true';
   const id='jobs-nav-'+name;
   section.innerHTML='<button type="button" class="jobs-nav-group-toggle branched-menu__head" aria-expanded="true" aria-controls="'+id+'"><span class="branched-menu__label"></span><span class="branched-menu__chevron" aria-hidden="true"></span></button>'+
    '<div class="branched-menu__body" id="'+id+'" aria-hidden="false"><div class="branched-menu__fold"><div class="jobs-nav-items branched-menu__tree"></div></div></div>';
  }
  const nextGroup=previousGroup?previousGroup.nextElementSibling:nav.querySelector(':scope > [data-jobs-nav-group]');
  if(nextGroup!==section)nav.insertBefore(section,nextGroup);
  previousGroup=section;
  const heading=section.querySelector('.branched-menu__head');
  heading.dataset.branchedIcon=icon;
  const groupLabel=heading.querySelector('.branched-menu__label');
  if(groupLabel.textContent!==label)groupLabel.textContent=label;
  const tree=section.querySelector('.jobs-nav-items');
  const buttons=new Map([...tree.querySelectorAll('button')].map(button=>[button.dataset.collection||button.dataset.view,button]));
  for(const [id,button] of buttons)if(!items.some(item=>item.id===id))button.remove();
  let previousButton;
  for(const item of items){
   let button=buttons.get(item.id);
   if(!button){
    button=document.createElement('button');button.type='button';
    button.dataset.action=item.collection?'staff-collection':'view';
    button.dataset[item.collection?'collection':'view']=item.id;
    button.dataset.branchedIcon=item.icon;
    const text=document.createElement('span');text.className='jobs-nav-label branched-menu__label';button.append(text);
   }
   const nextButton=previousButton?previousButton.nextElementSibling:tree.querySelector('button');
   if(nextButton!==button)tree.insertBefore(button,nextButton);
   previousButton=button;
   button.setAttribute('aria-label',item.label);button.title=item.label;
   if(button.lastChild.textContent!==item.label)button.lastChild.textContent=item.label;
  }
 }
}
function nav(){
 const permitted=access==='staff'?[...(caps.read?['cms']:[]),...(caps.recruit?['applications']:[]),...(caps.recruit===true?['talent']:[]),...(caps.manage_staff?['staff']:[])]:['mine'];
 const requested=view;
 if(!permitted.includes(view)&&!(access==='candidate'&&view==='apply'))view=permitted[0]||'';
 $('#signed-panel').classList.toggle('jobs-staff-active',access==='staff'&&!!user&&(caps.read||caps.recruit));
 const navigation=$('#workspace-nav');
 if(access==='staff'){
  const collection=new URL(location.href).searchParams.get('collection');
  if((requested&&requested!==view)||(collection&&(view!=='cms'||collection!==staffCollection)))writeWorkspaceRoute('replaceState');
  renderStaffNavigation(navigation);
 }else{
  navigation.innerHTML='<button type="button" data-action="view" data-view="mine">'+t('My applications','Hồ sơ của tôi')+'</button>';
 }
 updateCmsNavigation();
}
async function openStaffCollection(destination){
 if(access!=='staff'||!caps.read||destination!=='media'&&!collections.some(item=>item.kind===destination))return;
 if(view!=='cms'){setView('cms',undefined,destination);return;}
 const mounted=cms;
 await mounted?.ready;
 if(!mounted||cms!==mounted||destination===staffCollection)return;
 const stop=holdContent(destination==='vacancy'?t('Loading vacancies…','Đang tải tin tuyển dụng…'):t('Loading content…','Đang tải nội dung…'));
 try{
  // The CMS announces its selected collection as soon as it accepts navigation.
  const moved=mounted.navigate(destination);
  if(cms===mounted&&staffCollection===destination)writeWorkspaceRoute('pushState');
  await moved;
 }finally{stop();}
}
function setView(next, applicationId, destination=staffCollection){
 if(!mayLeave())return;
 const current=++generation;
 clearWorkspace(true);view=next;
 if(view==='cms')staffCollection=destination;
 writeWorkspaceRoute('pushState');
 void renderView().then(()=>{
  if(applicationId&&current===generation&&view==='applications'&&access==='staff'&&caps.recruit)return openApplication(applicationId);
 }).catch(e=>{if(current===generation)status(errorText(e,language),true,true);});
}
function setAccess(next){
 if(next===access||recovery||!mayLeave())return;
 generation++;clearWorkspace();access=next;view='';status('');const u=new URL(location.href);u.searchParams.set('access',access);u.searchParams.delete('view');u.searchParams.delete('collection');if(access==='candidate'&&u.searchParams.has('vacancy'))view='apply';history.pushState({},'',u);currentViewUrl=u.href;
 void authenticate();
}
async function renderView(){
 if(!user)return;nav();
 const target=$('#workspace-view'),body=document.createElement('div');body.dataset.workspaceBody='';target.replaceChildren(body);
 let stopHold=()=>{};const hold=label=>{stopHold=holdContent(label);};
 try{
 if(access==='staff'&&(!caps.read&&!caps.recruit||capabilityError)){
  body.innerHTML=`<div class="jobs-auth-card"><h1>${capabilityError?t('Staff access could not be checked','Chưa thể kiểm tra quyền nhân viên'):t('Staff access not assigned','Chưa được cấp quyền nhân viên')}</h1><p>${capabilityError?t('We could not load your Jobs permissions. Check your connection and try again.','Chưa thể tải quyền Jobs của bạn. Kiểm tra kết nối rồi thử lại.'):t('You are signed in, but this account has no active Jobs staff assignment. Ask your Jobs administrator to assign content or recruitment access to this email.','Bạn đã đăng nhập nhưng tài khoản chưa có quyền nhân viên Jobs đang hoạt động. Hãy nhờ quản trị viên Jobs cấp quyền nội dung hoặc tuyển dụng cho email này.')}</p><div class="jobs-row-actions"><button type="button" data-action="retry">${t('Check access again','Kiểm tra lại quyền')}</button><button type="button" data-action="access" data-access="candidate">${t('Open candidate portal','Mở cổng ứng viên')}</button></div><p class="jobs-meta">${t('To use another assigned account, sign out above and sign in again.','Để dùng tài khoản khác đã được cấp quyền, đăng xuất ở trên rồi đăng nhập lại.')}</p></div>`;return;
 }
 if(view==='cms'){
  if(!caps.read){body.textContent=t('Jobs content access is not assigned to this account.','Tài khoản này chưa được cấp quyền nội dung Jobs.');return;}
  const destination=staffCollection;
  hold(destination==='vacancy'?t('Loading vacancies…','Đang tải tin tuyển dụng…'):t('Loading content…','Đang tải nội dung…'));
  cms=mountCms(body,{appId:'jobs',appName:{en:'Vietnam English Teaching Jobs',vi:'Tuyển Dụng Dạy Tiếng Anh'},language,collections,adapter:createCmsAdapter(),initialDestination:destination,navigation:false,onNavigationChange:updateCmsNavigation,onNotice:(message,error)=>status(message,error)});
  await cms.ready;return;
 }
 if(view==='staff'){
  hold(t('Loading staff access…','Đang tải quyền nhân viên…'));
  staffPage=mountStaffManagement(body,{adapter:createStaffAdapter(),language,errorText,onNotice:(message,error,confirmed)=>confirmed?success(message):error?status(message,true):showActionToast(document,message,{language,tone:'info'})});
  await staffPage.ready;return;
 }
 if(view==='talent' && access==='staff' && caps.recruit===true){
  const mountedAt=generation;
  hold(t('Loading candidates…','Đang tải ứng viên…'));
  talentPage=mountTalentPool(body,{
   adapter:createTalentAdapter({db,unwrap,deadline,backend:jobsConfig.supabaseUrl}),language,canPublish:caps.publish===true,
   allowed:()=>mountedAt===generation&&view==='talent'&&access==='staff'&&!!user&&caps.recruit===true,
   notify:success,openApplication:id=>setView('applications',id)
  });
  await talentPage.ready;return;
 }
 if(view==='apply'){hold(new URL(location.href).searchParams.has('vacancy')?t('Loading vacancy…','Đang tải tin tuyển dụng…'):t('Loading application form…','Đang tải mẫu ứng tuyển…'));await renderApplicationForm();return;}
 if(view==='applications'&&!caps.recruit){setView('mine');return;}
 await renderApplications();
 }finally{stopHold();}
}
async function renderApplicationForm(){
 const currentGeneration=generation;
 const target=workspaceBody(),vacancy=new URL(location.href).searchParams.get('vacancy');
 let job=null;if(vacancy){const r=await db.from('jobs_public_content').select('id,title_en,title_vi').eq('id',vacancy).eq('kind','vacancy').maybeSingle();job=unwrap(r);if(currentGeneration!==generation||!user)return;if(!job){target.innerHTML=`<p class="jobs-alert">${t('This vacancy is closed or unavailable.','Vị trí này đã đóng hoặc không còn khả dụng.')}</p>`;return;}}
 const profile=unwrap(await db.from('jobs_candidates').select('*').eq('id',user.id).maybeSingle())||{};if(currentGeneration!==generation||!user)return;
 target.innerHTML=`<h1>${t('Apply with confidence','Ứng tuyển thuận tiện')}</h1><p>${esc(job?(language==='vi'?job.title_vi:job.title_en):t('General introduction to the recruitment team','Giới thiệu chung với đội ngũ tuyển dụng'))}</p><form id="persistent-application" data-vacancy="${job?.id||''}"><div class="jobs-form-grid"><label>${t('Full name','Họ và tên')}<input name="full_name" required minlength="2" maxlength="100" autocomplete="name" value="${esc(profile.full_name)}"></label><label>${t('Verified account email','Email tài khoản đã xác minh')}<input type="email" value="${esc(user.email)}" disabled></label><label>${t('Phone / WhatsApp','Điện thoại / WhatsApp')}<input name="phone" maxlength="60" value="${esc(profile.phone)}" autocomplete="tel"></label><label>${t('Current location','Nơi đang sống')}<input name="current_location" maxlength="200" value="${esc(profile.current_location)}"></label></div><label>${t('Experience, qualifications and questions','Kinh nghiệm, bằng cấp và câu hỏi')}<textarea name="message" maxlength="5000" rows="6"></textarea></label><label>${t('CV (optional): PDF or DOCX, up to 10 MB','CV (không bắt buộc): PDF hoặc DOCX, tối đa 10 MB')}<input type="file" name="cv" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"></label><label class="consent"><input type="checkbox" name="consent" required><span>${t('I agree to this site storing my application and documents for recruitment by the Jobs team. I understand these are not shared automatically with other Gary applications.','Tôi đồng ý để trang lưu hồ sơ và tài liệu phục vụ tuyển dụng bởi đội ngũ Jobs. Hồ sơ không tự động được chia sẻ với các ứng dụng Gary khác.')}</span></label><button class="primary" type="submit" data-button-variant="confirm">${t('Submit application','Nộp hồ sơ')}</button></form>`;
}
const recruitmentStats = {
 'jobs-stat-active':['Active vacancies','Tin đang tuyển'],
 'jobs-stat-applications':['Applications','Hồ sơ ứng tuyển'],
 'jobs-stat-candidates':['Candidates','Ứng viên'],
 'jobs-stat-hired':['Hired','Đã tuyển']
};
let recruitmentCounts={}, recruitmentGeneration=-1, recruitmentRequest=0;
function resetRecruitmentStats(){
 recruitmentCounts={};recruitmentGeneration=-1;recruitmentRequest++;
 clearCounterValues(document,Object.keys(recruitmentStats));
}
function renderRecruitmentStats(target){
 target.querySelector('h1').insertAdjacentHTML('afterend',`<dl class="jobs-recruitment-stats">${Object.entries(recruitmentStats).map(([id,[en,vi]])=>`<div class="jobs-record"><dt>${t(en,vi)}</dt><dd id="${id}">—</dd></div>`).join('')}</dl>`);
 setCounterValues(document,recruitmentCounts,language);
}
async function loadRecruitmentStats(force=false){
 if(view!=='applications'||!caps.recruit||!user||(!force&&recruitmentGeneration===generation))return;
 const currentGeneration=generation,request=++recruitmentRequest;
 const count=table=>db.from(table).select('id',{count:'exact',head:true});
 recruitmentGeneration=generation;
 const results=await Promise.allSettled([
  Promise.resolve().then(()=>deadline(count('jobs_public_content').eq('kind','vacancy'))),
  Promise.resolve().then(()=>deadline(count('jobs_applications'))),
  Promise.resolve().then(()=>deadline(count('jobs_candidates'))),
  Promise.resolve().then(()=>deadline(count('jobs_applications').eq('stage','hired')))
 ]);
 if(currentGeneration!==generation||request!==recruitmentRequest||view!=='applications'||!caps.recruit)return;
 const ids=Object.keys(recruitmentStats);
 for(const [index,result] of results.entries()){
  if(result.status==='fulfilled'&&!result.value?.error&&Number.isFinite(result.value?.count))recruitmentCounts[ids[index]]=result.value.count;
 }
 setCounterValues(document,recruitmentCounts,language);
}
async function renderApplications(){
 const target=workspaceBody(),staff=view==='applications';
 target.innerHTML=`<h1>${staff?t('Recruitment workspace','Không gian tuyển dụng'):t('My applications','Hồ sơ của tôi')}</h1>${staff?`<form id="application-filters" class="jobs-filters"><label>${t('Role keyword','Từ khóa vị trí')}<input name="query" type="search" maxlength="80"></label><label>${t('Stage','Giai đoạn')}<select name="stage"><option value="">${t('All stages','Tất cả giai đoạn')}</option>${STAGES.map(s=>`<option value="${s}">${stageLabel(s)}</option>`).join('')}</select></label><label>${t('Assignment','Phân công')}<select name="assignee"><option value="">${t('All recruiters','Tất cả chuyên viên')}</option><option value="unassigned">${t('Unassigned','Chưa phân công')}</option>${roster.map(s=>`<option value="${s.user_id}">${esc(s.full_name)}</option>`).join('')}</select></label><button type="submit">${t('Search','Tìm kiếm')}</button></form>`:''}<div class="jobs-list" id="applications-list" aria-live="polite"></div><div class="jobs-pagination"><button data-action="previous" type="button">${t('Previous','Trước')}</button><span id="page-count"></span><button data-action="next" type="button">${t('Next','Tiếp')}</button></div><section id="application-detail"></section>`;
 if(staff){renderRecruitmentStats(target);void loadRecruitmentStats();}
 await loadApplications();
}
let filterValues={},total=0,applicationsRequest=0;
async function loadApplications(){
 const currentGeneration=generation,request=++applicationsRequest,requestedPage=page;
 const list=$('#applications-list');
 const hasRows=!!list?.querySelector('.jobs-record');
 if(list&&!hasRows)list.querySelector('.jobs-empty')?.remove();
 const stop=startLattice(list,{pattern:'ripple',grid:4,label:t('Loading applications…','Đang tải hồ sơ…'),status:false,reserve:!hasRows});
 try{
 const r=await deadline(applicationList({page:requestedPage,...(view==='applications'?filterValues:{candidateId:user.id})}));
 if(currentGeneration!==generation||request!==applicationsRequest||!user)return;
 total=r.total;
 $('#applications-list').innerHTML=r.records.length?r.records.map(a=>`<article class="jobs-record"><header><div><h2>${esc(a.vacancy_title)}</h2><p class="jobs-meta">${esc(a.receipt_code)} · ${new Date(a.created_at).toLocaleDateString(language==='vi'?'vi-VN':'en-GB')}${view==='applications'?` · ${esc(a.jobs_candidates?.full_name)}`:''}</p></div><span class="jobs-stage">${stageLabel(a.stage)}</span></header><button data-action="open-application" data-id="${a.id}" type="button">${t('View application','Xem hồ sơ')}</button></article>`).join(''):view==='applications'?`<p class="jobs-empty">${t('No applications match this view.','Chưa có hồ sơ phù hợp.')}</p>`:`<div class="jobs-empty"><h2>${t('No applications yet','Bạn chưa có hồ sơ ứng tuyển')}</h2><p>${t('Your submitted applications and recruitment updates will appear here. Find an open vacancy or introduce yourself to the Jobs team.','Hồ sơ đã nộp và cập nhật tuyển dụng sẽ xuất hiện tại đây. Hãy tìm vị trí đang tuyển hoặc giới thiệu bản thân với đội ngũ Jobs.')}</p><div class="jobs-row-actions"><a class="jobs-link-button" href="./#opportunities">${t('Find vacancies','Tìm việc làm')}</a><a class="jobs-link-button" href="portal.html?access=candidate&view=apply">${t('Introduce yourself','Giới thiệu bản thân')}</a></div></div>`;
 $('#page-count').textContent=t(`Page ${requestedPage} · ${total} applications`,`Trang ${requestedPage} · ${total} hồ sơ`);$('[data-action="previous"]').disabled=requestedPage<=1;$('[data-action="next"]').disabled=requestedPage*20>=total;
 }catch(error){if(currentGeneration===generation&&request===applicationsRequest&&user)throw error;}
 finally{stop();}
}
const allowedStages=s=>({submitted:['submitted','screening','rejected','withdrawn'],screening:['screening','shortlisted','rejected','withdrawn'],shortlisted:['shortlisted','interview','rejected','withdrawn'],interview:['interview','offer','rejected','withdrawn'],offer:['offer','hired','rejected','withdrawn']}[s]||[s]);
async function openApplication(id,{scroll=true,preserveStage=false}={}){
 const recruiting=access==='staff'&&caps.recruit,g=generation;const [a,events,documents,notes]=await Promise.all([db.from('jobs_applications').select('*,jobs_candidates(full_name,email,phone,current_location)').eq('id',id).single(),db.from('jobs_application_events').select('*').eq('application_id',id).order('created_at',{ascending:false}).limit(100),db.from('jobs_application_documents').select('*').eq('application_id',id).order('created_at',{ascending:false}).limit(100),recruiting?db.from('jobs_recruitment_notes').select('*').eq('application_id',id).order('created_at',{ascending:false}).limit(20):Promise.resolve({data:[]})]);
 if(g!==generation||!scroll&&selected?.id!==id)return;
 const noteDraft=!scroll?$('#note-form textarea')?.value:null;
 const stageForm=preserveStage?$('#transition-form'):null;
 const stageDraft=stageForm?[stageForm.elements.stage.value,stageForm.elements.assignee.value]:null;
 selected=unwrap(a);const p=selected.jobs_candidates||{};
 $('#application-detail').innerHTML=`<article class="jobs-record"><h2>${esc(selected.receipt_code)}</h2><p>${esc(selected.vacancy_title)} · <span class="jobs-stage">${stageLabel(selected.stage)}</span></p>${recruiting?`<p>${esc(p.full_name)} · ${esc(p.email)} · ${esc(p.phone)} · ${esc(p.current_location)}</p>`:''}<pre>${esc(selected.message)}</pre><div class="jobs-detail-grid"><section><h3>${t('Progress (latest 100 events)','Tiến độ (100 hoạt động gần nhất)')}</h3><ol>${unwrap(events).map(e=>`<li>${stageLabel(e.stage)} · ${new Date(e.created_at).toLocaleString(language==='vi'?'vi-VN':'en-GB')}</li>`).join('')}</ol></section><section><h3>${t('Private documents (latest 100)','Tài liệu riêng tư (100 tệp gần nhất)')}</h3><ul>${unwrap(documents).map(d=>`<li><button type="button" data-action="document" data-path="${esc(d.object_path)}">${esc(d.file_name)}</button></li>`).join('')}</ul>${selected.candidate_id===user.id?`<form id="upload-cv"><label>${t('Attach CV: PDF or DOCX, up to 10 MB','Đính kèm CV: PDF hoặc DOCX, tối đa 10 MB')}<input type="file" name="cv" accept=".pdf,.docx" required></label><button type="submit" data-button-variant="confirm">${t('Upload privately','Tải lên riêng tư')}</button></form>`:''}</section></div>${recruiting?`<form id="transition-form"><div class="jobs-form-grid"><label>${t('Recruitment stage','Giai đoạn tuyển dụng')}<select name="stage">${allowedStages(selected.stage).map(s=>`<option value="${s}" ${s===selected.stage?'selected':''}>${stageLabel(s)}</option>`).join('')}</select></label><label>${t('Assigned recruiter','Chuyên viên phụ trách')}<select name="assignee"><option value="">${t('Unassigned','Chưa phân công')}</option>${roster.map(s=>`<option value="${s.user_id}" ${s.user_id===selected.assigned_staff_id?'selected':''}>${esc(s.full_name)}</option>`).join('')}</select></label></div><button type="submit" data-button-variant="save">${t('Save stage and assignment','Lưu giai đoạn và phân công')}</button></form><h3>${t('Private recruitment notes','Ghi chú tuyển dụng riêng tư')}</h3>${unwrap(notes).map(n=>`<p>${esc(n.body)}</p>`).join('')}<p class="jobs-meta">${t('Latest 20 notes. Notes are not visible to candidates.','20 ghi chú gần nhất. Ứng viên không xem được ghi chú.')}</p><form id="note-form"><label>${t('New note','Ghi chú mới')}<textarea name="body" required maxlength="5000"></textarea></label><button type="submit" data-button-variant="confirm">${t('Add private note','Thêm ghi chú riêng tư')}</button></form>`:''}</article>`;
 const note=$('#note-form textarea');
 if(note&&noteDraft!=null)note.value=noteDraft;
 if(stageDraft){
  const form=$('#transition-form');
  for(const [index,name] of ['stage','assignee'].entries()){
   const select=form?.elements[name],value=stageDraft[index];
   if([...select?.options||[]].some(option=>option.value===value))select.value=value;
  }
 }
 if(scroll)$('#application-detail').scrollIntoView({block:'start',behavior:'smooth'});
}
async function authenticate(){
 clearTimeout(authSyncTimer);
 const previousStaff=access==='staff'&&!recovery?user?.id:null;
 const g=++generation;clearWorkspace(false,Boolean(previousStaff));user=null;caps={};roster=[];capabilityError=false;loading=true;status('');renderChrome();
 try{
  const r=await deadline(db.auth.getUser());if(g!==generation)return;
  if(r.error&&r.error.name!=='AuthSessionMissingError')throw r.error;
  user=r.data?.user||null;
  if(previousStaff&&user?.id!==previousStaff)$('#workspace-nav').replaceChildren();
  if(user&&!recovery){
   try{const nextCaps=await deadline(capabilities());if(g!==generation)return;caps=nextCaps||{};}
   catch(e){if(g!==generation)return;capabilityError=true;status(t('Your Jobs permissions could not be loaded. Check your connection and try again.','Chưa thể tải quyền Jobs của bạn. Kiểm tra kết nối rồi thử lại.'),true,true);}
   if(access==='staff'&&caps.recruit){try{const nextRoster=unwrap(await deadline(db.rpc('jobs_staff_directory')));if(g!==generation)return;roster=nextRoster||[];}catch(e){if(g!==generation)return;status(errorText(e,language),true,true);}}
  }
  if(g!==generation)return;loading=false;renderChrome();renderAuth();
  if(user&&!recovery){if(access==='candidate'&&new URL(location.href).searchParams.has('vacancy'))view='apply';await deadline(renderView());}
 }catch(e){
  if(g!==generation)return;generation++;loading=false;if(!user)$('#workspace-nav').replaceChildren();renderChrome();renderAuth();
  status(e.message==='portal_timeout'?t('The portal is taking too long to respond. Check your connection and try again.','Cổng thông tin phản hồi quá lâu. Kiểm tra kết nối rồi thử lại.'):t('The portal could not be loaded. Check your connection and try again.','Chưa thể tải cổng thông tin. Kiểm tra kết nối rồi thử lại.'),true,true);
 }
}
$('#portal-language').addEventListener('click',()=>{language=language==='en'?'vi':'en';try{localStorage.setItem('gary-language',JSON.stringify(language));}catch{}renderChrome();renderAuth();if(user&&!loading&&!recovery)nav();if(cms)cms.setLanguage(language);else if(staffPage)staffPage.setLanguage(language);else if(talentPage)talentPage.setLanguage(language);else if(user&&!loading&&!recovery)void renderView().catch(e=>status(errorText(e,language),true,true));});
const accountMenu=mountJobsAccountMenu($('#portal-account'),{
 showGuest:false,
 canNavigate:mayLeave,
 async signOut(){
  const actor=user.id;
  unwrap(await deadline(db.auth.signOut({scope:'local'})));
  if(user?.id===actor)showSignedOut();
 },
});
function showSignedOut(){
 clearTimeout(authSyncTimer);
 generation++;clearWorkspace();user=null;caps={};roster=[];recovery=false;loading=false;status('');renderChrome();renderAuth();
}
document.addEventListener('click',event=>{
 const b=event.target.closest('[data-action]');if(!b)return;const action=b.dataset.action;
 if(action==='access')setAccess(b.dataset.access);
 if(action==='retry')void authenticate();
 if(action==='view')setView(b.dataset.view);
 if(action==='staff-collection')void openStaffCollection(b.dataset.collection).catch(e=>status(errorText(e,language),true));
 if(action==='previous'&&page>1){page--;void guarded(loadApplications).catch(()=>{});}
 if(action==='next'&&page*20<total){page++;void guarded(loadApplications).catch(()=>{});}
 if(action==='open-application')void guarded(()=>openApplication(b.dataset.id)).catch(()=>{});
 if(action==='document')void guarded(async()=>{const r=unwrap(await db.storage.from(jobsConfig.cvBucket).createSignedUrl(b.dataset.path,60));const a=document.createElement('a');a.href=r.signedUrl;a.target='_blank';a.rel='noopener noreferrer';a.click();}).catch(()=>{});
 if(action==='register'||action==='reset')void guarded(async()=>{
  const f=$('#auth-form');if(!f||recovery||action==='register'&&access==='staff')return;if(action==='register'&&!f.reportValidity())return;if(action==='register'&&f.elements.password.value.length<12){status(t('Use at least 12 characters for a new password.','Mật khẩu mới cần có ít nhất 12 ký tự.'),true);return;}const email=f.elements.email.value;if(!email||!f.elements.email.checkValidity()){f.elements.email.reportValidity();return;}
  b.disabled=true;const stopConnection=startLattice(f,{pattern:'dots',grid:3,label:t('Connecting securely…','Đang kết nối an toàn…'),status:true});try{const redirect=new URL('./portal.html',location.href).href;
   if(action==='register'){unwrap(await db.auth.signUp({email,password:f.elements.password.value,options:{emailRedirectTo:redirect}}));status(t('Check your email to confirm your account, then sign in.','Kiểm tra email để xác minh tài khoản, sau đó đăng nhập.'));}
   else {unwrap(await db.auth.resetPasswordForEmail(email,{redirectTo:redirect}));status(t('If this account exists, a recovery email will arrive shortly.','Nếu tài khoản tồn tại, email khôi phục sẽ sớm được gửi.'));}
  }finally{b.disabled=false;stopConnection();}
 }).catch(()=>{});
});
document.addEventListener('submit',event=>{
 const form=event.target;if(!['auth-form','persistent-application','application-filters','transition-form','note-form','upload-cv'].includes(form.id))return;event.preventDefault();const button=form.querySelector('button[type="submit"]');if(button?.disabled)return;const data=new FormData(form);
 void guarded(async()=>{
  const actor=user?.id,currentGeneration=generation;
  if(button)button.disabled=true;
  try{
   if(form.id==='auth-form'){
    const stopConnection=startLattice(form,{pattern:'dots',grid:3,label:t('Connecting securely…','Đang kết nối an toàn…'),status:true});
    try{
    if(recovery){unwrap(await deadline(db.auth.updateUser({password:String(data.get('password'))})));recovery=false;success(t('Password saved.','Đã lưu mật khẩu.'));await authenticate();}
    else{unwrap(await deadline(db.auth.signInWithPassword({email:String(data.get('email')),password:String(data.get('password'))})));await authenticate();}
    }finally{stopConnection();}
   }
   if(form.id==='persistent-application'){
    const vacancy=form.dataset.vacancy||null,cv=data.get('cv');if(cv?.size) {const {validateCv}=await import('./jobs-backend.js');validateCv(cv);}
    const r=await submitApplication({vacancyId:vacancy,profile:{full_name:data.get('full_name'),phone:data.get('phone'),current_location:data.get('current_location'),consent:data.get('consent')==='on'},message:String(data.get('message')||''),requestId:requestKey(vacancy)});
    if(actor!==user?.id)return;
    success(t(`Application saved. Receipt: ${r.receipt_code}.`,`Đã lưu hồ sơ. Mã tiếp nhận: ${r.receipt_code}.`));
    let uploaded=true;if(cv?.size){try{await uploadCv(r,cv);}catch{uploaded=false;}}
    if(actor!==user?.id)return;
    if(cv?.size&&uploaded)success(t('Private CV saved.','Đã lưu CV riêng tư.'));
    try{sessionStorage.removeItem('jobs-request:'+user.id+':'+(vacancy||'general'));}catch{}
    const u=new URL(location.href);u.searchParams.delete('vacancy');u.searchParams.set('view','mine');history.replaceState({},'',u);currentViewUrl=u.href;view='mine';await renderView();
    if(!uploaded)status(t('Your CV upload failed; open your application to retry.','Tải CV thất bại; mở hồ sơ để thử lại.'),true);
   }
   if(form.id==='application-filters'){filterValues=Object.fromEntries(data);page=1;await loadApplications();}
   if(form.id==='transition-form'){const id=selected.id,updated=await transitionApplication(id,String(data.get('stage')),String(data.get('assignee')),selected.version);if(actor!==user?.id||currentGeneration!==generation)return;if(selected?.id===id)selected=updated;status('');success(t('Stage and assignment saved.','Đã lưu giai đoạn và phân công.'));void loadRecruitmentStats(true);await loadApplications();if(currentGeneration===generation&&selected?.id===id)await openApplication(id,{scroll:false});}
   if(form.id==='note-form'){const id=selected.id,body=String(data.get('body'));unwrap(await db.from('jobs_recruitment_notes').insert({application_id:id,body}));if(actor!==user?.id||currentGeneration!==generation)return;if(form.elements.body.value===body)form.reset();status('');success(t('Private note added.','Đã thêm ghi chú riêng tư.'));await openApplication(id,{scroll:false,preserveStage:true});}
   if(form.id==='upload-cv'){const id=selected.id;await uploadCv(selected,data.get('cv'));if(actor!==user?.id||currentGeneration!==generation)return;status('');success(t('Private CV saved.','Đã lưu CV riêng tư.'));await openApplication(id,{scroll:false});}
  }finally{if(button?.isConnected)button.disabled=false;}
 }).catch(()=>{});
});
window.addEventListener('popstate',()=>{
 const nextUrl=new URL(location.href);
 if(!mayLeave()){history.pushState({},'',currentViewUrl);return;}
 const nextAccess=accessFromUrl(nextUrl),sameStaffSession=access==='staff'&&nextAccess==='staff'&&user&&!loading&&!recovery;
 access=nextAccess;view=nextUrl.searchParams.get('view')||'';staffCollection=collectionFromUrl(nextUrl);currentViewUrl=nextUrl.href;
 if(sameStaffSession){
  const current=++generation;
  clearWorkspace(true);
  void renderView().catch(e=>{if(current===generation)status(errorText(e,language),true,true);});
  schedulePermissionRefresh();
  return;
 }
 void authenticate();
});
let permissionRefreshTimer,permissionRefreshing=false,permissionDenied=false;
function schedulePermissionRefresh(denied=false){
 if(!user||recovery)return;permissionDenied ||= denied;if(permissionRefreshing)return;
 clearTimeout(permissionRefreshTimer);permissionRefreshTimer=setTimeout(()=>{const force=permissionDenied;permissionDenied=false;void refreshPermissions(force)},0);
}
async function refreshPermissions(denied=false){
 if(permissionRefreshing||loading||!user||recovery)return;
 permissionRefreshing=true;const g=generation,id=user.id;
 try{
  const identity=await deadline(db.auth.getUser());if(g!==generation)return;
  if(identity.error){if([401,403].includes(identity.error.status)||['AuthSessionMissingError','AuthInvalidJwtError'].includes(identity.error.name)||['session_not_found','user_banned','user_not_found','bad_jwt'].includes(identity.error.code)){generation++;clearWorkspace();user=null;caps={};roster=[];loading=false;renderChrome();renderAuth();}else if(denied||permissionDenied){generation++;clearWorkspace();caps={};roster=[];capabilityError=true;await renderView();}return;}
  if(identity.data?.user?.id!==id){await authenticate();return;}
  const next=await deadline(capabilities());if(g!==generation)return;
  const keys=['role','read','edit','publish','media','recruit','manage_staff','manage_admins'];
  if(denied||permissionDenied||keys.some(key=>(next?.[key]??null)!==(caps?.[key]??null)))await authenticate();
 }catch(e){if(g===generation&&(denied||permissionDenied||e?.code==='42501'||[401,403].includes(e?.status))){generation++;clearWorkspace();caps={};roster=[];capabilityError=true;loading=false;renderChrome();await renderView();}}
 finally{permissionRefreshing=false;permissionDenied=false;}
}
window.addEventListener('focus',()=>schedulePermissionRefresh());
window.addEventListener('pageshow',()=>schedulePermissionRefresh());
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')schedulePermissionRefresh();});
window.addEventListener('jobs:access-denied',()=>schedulePermissionRefresh(true));
let authSyncTimer;
db.auth.onAuthStateChange((event,session)=>{
 if(event==='PASSWORD_RECOVERY'){clearTimeout(authSyncTimer);generation++;clearWorkspace();recovery=true;loading=false;user=session?.user||user;renderChrome();renderAuth();return;}
 if(event==='SIGNED_OUT'){showSignedOut();return;}
 if(!['INITIAL_SESSION','SIGNED_IN','TOKEN_REFRESHED','USER_UPDATED'].includes(event)||recovery)return;
 // Supabase may emit SIGNED_IN again on tab focus. Keep an active editor intact.
 if(session?.user?.id===user?.id&&!loading){schedulePermissionRefresh();return;}
 clearTimeout(authSyncTimer);authSyncTimer=setTimeout(()=>void authenticate(),0);
});
renderChrome();void authenticate();
