import {createClient} from './vendor/supabase.js';
import {jobsConfig} from './jobs-config.js';
import {isConflictResponse,responseError} from './conflict-response.js';
import {attachCv, validateCv as validateCvFile} from './jobs-cv.js';
import {createJobsPublishingAdapter} from './jobs-publishing-adapter.js';
import {categoryOptions, locationOptions} from './jobs-vacancy-options.js';
import {forgetVacancyImage, mountVacancyImageEditor, uploadVacancyImage, vacancyImageErrorText} from './jobs-vacancy-image.js';
// Observe only this app's data/Storage denials; Auth login failures are unrelated.
async function permissionFetch(input,options){
 const response=await globalThis.fetch(input,options);
 const url=new URL(typeof input==='string'?input:input.url,jobsConfig.supabaseUrl);
 if([401,403].includes(response.status)&&url.origin===new URL(jobsConfig.supabaseUrl).origin&&/^\/(rest|storage)\/v1\//.test(url.pathname))globalThis.dispatchEvent?.(new Event('jobs:access-denied'));
 return response;
}
export const db=createClient(jobsConfig.supabaseUrl,jobsConfig.publishableKey,{global:{fetch:permissionFetch},auth:{storageKey:'gary-jobs-auth',persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,flowType:'pkce'}});
export const STAGES=['submitted','screening','shortlisted','interview','offer','hired','rejected','withdrawn'];
export const STAGE_LABELS={submitted:['Submitted','Đã nộp'],screening:['Screening','Sàng lọc'],shortlisted:['Shortlisted','Danh sách ngắn'],interview:['Interview','Phỏng vấn'],offer:['Offer','Đề nghị'],hired:['Hired','Đã tuyển'],rejected:['Not selected','Không được chọn'],withdrawn:['Withdrawn','Đã rút']};
export function unwrap(result){if(result.error){if(result.error.code==='42501'||[401,403].includes(result.error.status))globalThis.dispatchEvent?.(new Event('jobs:access-denied'));throw responseError(result);}return result.data;}
export function errorText(error,language='en'){
 if(error?.code==='42501'||[401,403].includes(error?.status))globalThis.dispatchEvent?.(new Event('jobs:access-denied'));
 const imageMessage=vacancyImageErrorText(error,language);if(imageMessage)return imageMessage;
 const vi=language==='vi',code=String(error?.message||'').match(/jobs\.([a-z_]+)/)?.[1];
 const messages={publication_invalid:['Please complete the highlighted vacancy fields.','Vui lòng hoàn thành các trường tuyển dụng được đánh dấu.'],title_required:['Enter the job title to generate its URL.','Nhập tiêu đề công việc để tạo đường dẫn tự động.'],version_conflict:['This record changed. Reload it before saving.','Bản ghi đã thay đổi. Tải lại trước khi lưu.'],publisher_required:['A Jobs publisher must publish or archive this content.','Cần người có quyền xuất bản của Jobs để đăng hoặc lưu trữ.'],review_required:['Send this draft for review before publishing.','Gửi bản nháp để duyệt trước khi xuất bản.'],translation_required:['Complete both English and Vietnamese titles and summaries.','Hoàn thành tiêu đề và tóm tắt tiếng Anh và tiếng Việt.'],contact_required:['Enter a valid recruiter email address.','Nhập email chuyên viên tuyển dụng hợp lệ.'],body_required:['Complete the primary content in both languages.','Hoàn thành nội dung chính bằng cả hai ngôn ngữ.'],expiry_required:['Set a vacancy closing date.','Nhập hạn tuyển dụng.'],expiry_past:['The closing date must not be in the past.','Hạn tuyển dụng không được ở quá khứ.'],references_required:['A selected employer, category or location is no longer published. Refresh the selection lists and choose the highlighted item again.','Một nhà tuyển dụng, danh mục hoặc địa điểm đã chọn không còn được đăng. Làm mới danh sách và chọn lại mục được đánh dấu.'],reference_in_use:['An open vacancy still uses this profile. Update or archive that vacancy first.','Tin tuyển dụng đang mở vẫn dùng hồ sơ này. Cập nhật hoặc lưu trữ tin trước.'],email_verification_required:['Verify your account email before applying.','Xác minh email tài khoản trước khi ứng tuyển.'],vacancy_closed:['This vacancy is no longer accepting applications.','Vị trí này không còn nhận hồ sơ.'],intake_limit:['Your daily application limit has been reached. Please try tomorrow.','Bạn đã đạt giới hạn nộp hồ sơ trong ngày. Hãy thử vào ngày mai.'],stage_invalid:['That recruitment stage transition is not allowed.','Không thể chuyển sang giai đoạn tuyển dụng đó.'],assignee_invalid:['Choose an active Jobs recruiter.','Chọn chuyên viên Jobs đang hoạt động.'],forbidden:['Your Jobs permissions do not allow this action.','Quyền Jobs của bạn không cho phép thao tác này.'],self_change_forbidden:['You cannot change your own Jobs access. Ask another authorized administrator.','Bạn không thể tự thay đổi quyền Jobs của mình. Hãy nhờ một quản trị viên có thẩm quyền khác.'],protected_account:['This protected account can only be changed through the reviewed owner process.','Tài khoản được bảo vệ này chỉ có thể thay đổi qua quy trình chủ sở hữu đã được duyệt.'],owner_required:['Only a protected Jobs owner can grant, change or suspend Administrator access.','Chỉ chủ sở hữu Jobs được bảo vệ mới có thể cấp, thay đổi hoặc tạm ngưng quyền Quản trị viên.'],last_admin_required:['At least one active Jobs administrator must remain.','Luôn phải còn ít nhất một quản trị viên Jobs đang hoạt động.'],account_unavailable:['No verified Gary account uses this email. Ask the person to sign up and confirm their email first.','Không có tài khoản Gary đã xác minh nào dùng email này. Hãy nhờ người đó đăng ký và xác minh email trước.'],staff_exists:['This account already has Jobs staff history. Change or restore it in the staff list.','Tài khoản này đã có lịch sử nhân viên Jobs. Hãy thay đổi hoặc khôi phục trong danh sách nhân viên.'],staff_not_found:['This staff membership no longer exists. Refresh the list.','Tư cách nhân viên này không còn tồn tại. Hãy làm mới danh sách.'],role_invalid:['Choose Editor, Publisher, Recruiter or Admin.','Chọn Biên tập viên, Người xuất bản, Chuyên viên tuyển dụng hoặc Quản trị viên.'],name_invalid:['Use a display name of 120 characters or fewer.','Tên hiển thị tối đa 120 ký tự.']};
 if(messages[code])return messages[code][vi?1:0];
 if(isConflictResponse(error))return messages.version_conflict[vi?1:0];
 if(['42P01','PGRST202','PGRST205','42883'].includes(error?.code))return vi?'Backend Jobs chưa được cài đặt. Chủ sở hữu cần triển khai cấu trúc dữ liệu đã được kiểm thử.':'Jobs backend is not provisioned. The owner must install the tested database release.';
 return vi?'Chưa thể hoàn tất thao tác. Kiểm tra kết nối và thử lại.':'The action could not be completed. Check your connection and try again.';
}
export async function capabilities(){return unwrap(await db.rpc('jobs_capabilities'));}
export async function publicContent(){
 const rows=[],signal=AbortSignal.timeout(8000);
 for(let from=0;from<10000;from+=500){
  const page=unwrap(await db.from('jobs_public_content').select('*').order('published_at',{ascending:false}).order('id').range(from,from+499).abortSignal(signal));
  if(!Array.isArray(page))throw new Error('Invalid published catalogue response.');
  rows.push(...page);if(page.length<500)return rows;
 }
 throw new Error('Published catalogue exceeds this view limit.');
}
const fields=['hours','ages','salary_en','salary_vi','benefits_en','benefits_vi','requirements_en','requirements_vi','contact_email','source_url','employer_slug','category_slug','location_slug','closes_on'];
const field=(key,en,vi,type='text',extra={})=>({key,label:{en,vi},type,...extra});
export const collections=[
 {kind:'vacancy',label:{en:'Vacancies',vi:'Tin tuyển dụng'},automaticSlug:true,publicPath:'/jobs/',directPublish:true,publishTextFields:['title_en','body_en'],fields:[field('employer_name_en','Employer name (English)','Tên nhà tuyển dụng (tiếng Anh)','text',{required:true,maxLength:200}),field('employer_name_vi','Employer name (Vietnamese, optional)','Tên nhà tuyển dụng (tiếng Việt, không bắt buộc)','text',{maxLength:200}),field('category_slug','Job category','Danh mục việc làm','select',{options:categoryOptions,required:true,preservePublished:true,allowUnknownDraft:true,excludedValues:['british-council']}),field('location_slug','City / province','Thành phố / tỉnh','select',{options:locationOptions,required:true,preservePublished:true,allowUnknownDraft:true}),field('workplace_name','Workplace / branch (optional)','Nơi làm việc / chi nhánh (không bắt buộc)'),field('street_address','Street address (optional)','Địa chỉ đường phố (không bắt buộc)'),field('closes_on','Closing date','Hạn tuyển dụng','date',{required:true,minDate:'today'}),field('contact_email','Recruiter email','Email chuyên viên','email',{required:true,maxLength:254}),field('hours','Hours per month','Giờ mỗi tháng','number',{min:0}),field('ages','Learner ages','Độ tuổi học sinh'),field('salary','Salary','Mức lương','text',{bilingual:true}),field('benefits','Benefits','Quyền lợi','textarea',{bilingual:true}),field('requirements','Requirements, one per line','Yêu cầu, mỗi dòng một mục','textarea',{bilingual:true}),field('source_url','Original source URL','Đường dẫn nguồn','url')]},
 {kind:'employer',automaticSlug:true,label:{en:'Employers',vi:'Nhà tuyển dụng'},requireBody:false,fields:[field('website','Website','Website','url'),field('logo_url','Logo URL','Đường dẫn logo','url')]},
 {kind:'category',automaticSlug:true,label:{en:'Job categories',vi:'Danh mục việc làm'},requireBody:false,fields:[]},
 {kind:'location',automaticSlug:true,label:{en:'Locations',vi:'Địa điểm'},requireBody:false,fields:[]},
 {kind:'guide',label:{en:'Guides',vi:'Cẩm nang'},fields:[]},
 {kind:'faq',label:{en:'FAQs',vi:'Câu hỏi thường gặp'},fields:[]},
].map(collection=>({...collection,publishMinimums:collection.kind==='vacancy'?{title:1,body:1}:{title:3,summary:10,body:20}}));
export function createCmsAdapter(){return {
 errorText,
 mediaPolicy:{mimeTypes:['image/jpeg','image/png','image/webp','image/avif'],maxBytes:8388608},
 mountVacancyImage(root, options){
  return mountVacancyImageEditor(root,{
   ...options,
   upload:(id,file,progress)=>uploadVacancyImage(db,id,file,progress),
   removed:async id=>unwrap(await db.rpc('jobs_vacancy_removed_images',{p_vacancy_id:id})),
   forget:id=>forgetVacancyImage(db,id),
   async preview(id){return unwrap(await db.storage.from('jobs-vacancy-images').createSignedUrl(id,120)).signedUrl;},
  });
 },
 capabilities,
 async list({kind,query='',status='',page=1,pageSize=20}={}){
  const size=Math.min(100,Math.max(1,pageSize));let q=db.from('jobs_cms_entries').select('*',{count:'exact'}).eq('kind',kind).order('updated_at',{ascending:false}).order('id').range((page-1)*size,page*size-1);
  if(status)q=q.eq('status',status);if(query){const s=query.replace(/[,%()\\]/g,' ').trim().slice(0,100);if(s)q=q.or(`title_en.ilike.%${s}%,title_vi.ilike.%${s}%,slug.ilike.%${s}%`);}
  const r=await q;unwrap(r);return {records:r.data,total:r.count||0};
 },
 ...createJobsPublishingAdapter(db,{collections}),
 async revisions(id){return unwrap(await db.from('jobs_cms_revisions').select('id,version,status,created_at,snapshot').eq('entry_id',id).order('version',{ascending:false}).limit(100));},
 async restore(id,revisionId,{expectedVersion}={}){return unwrap(await db.rpc('jobs_cms_restore',{p_id:id,p_revision_id:revisionId,p_expected_version:expectedVersion}));},
 async listMedia(){return unwrap(await db.from('jobs_cms_media').select('*').order('created_at',{ascending:false}).limit(100)).map(r=>({...r,url:db.storage.from(jobsConfig.mediaBucket).getPublicUrl(r.object_path).data.publicUrl}));},
 async uploadMedia(file,metadata={}){
  if(!['image/jpeg','image/png','image/webp','image/avif'].includes(file.type)||file.size<1||file.size>8388608)throw new Error('Choose an image under 8 MB.');
  const user=(await db.auth.getUser()).data.user;if(!user)throw new Error('Sign in again.');
  const extension={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/avif':'avif'}[file.type],path=`${user.id}/${crypto.randomUUID()}.${extension}`;
  unwrap(await db.storage.from(jobsConfig.mediaBucket).upload(path,file,{upsert:false,contentType:file.type}));
  const r=unwrap(await db.from('jobs_cms_media').insert({object_path:path,file_name:file.name.slice(0,200),mime_type:file.type,size_bytes:file.size,alt_en:String(metadata.alt_en||'').trim(),alt_vi:String(metadata.alt_vi||'').trim()}).select().single());
  return {...r,url:db.storage.from(jobsConfig.mediaBucket).getPublicUrl(path).data.publicUrl};
 }
};}
export function validateCv(file){return validateCvFile(file);}
export async function uploadCv(application,file){
 try{return await attachCv(db,application.id,file);}
 catch(error){return unwrap({error});}
}
export async function submitApplication({vacancyId=null,profile,message,requestId}){return unwrap(await db.rpc('jobs_submit_application',{p_vacancy_id:vacancyId,p_profile:profile,p_message:message,p_client_request_id:requestId}));}
export async function applicationList({page=1,stage='',assignee='',query='',candidateId=null}={}){
 let q=db.from('jobs_applications').select('*,jobs_candidates(full_name,email,phone,current_location)',{count:'exact'}).order('created_at',{ascending:false}).order('id').range((page-1)*20,page*20-1);
 if(candidateId)q=q.eq('candidate_id',candidateId);
 if(stage)q=q.eq('stage',stage);if(assignee==='unassigned')q=q.is('assigned_staff_id',null);else if(assignee)q=q.eq('assigned_staff_id',assignee);
 if(query)q=q.ilike('vacancy_title','%'+query.replace(/[%_]/g,'').slice(0,80)+'%');const r=await q;unwrap(r);return {records:r.data,total:r.count||0};
}
export function createStaffAdapter(){return {
 async overview(){return unwrap(await db.rpc('jobs_staff_overview'));},
 async assign({email,role,display_name=''}){return unwrap(await db.rpc('jobs_staff_assign',{p_email:email,p_role:role,p_display_name:display_name}));},
 async update({user_id,role,active,display_name=null,version}){return unwrap(await db.rpc('jobs_staff_update',{p_user_id:user_id,p_role:role,p_active:active,p_expected_version:version,p_display_name:display_name}));},
};}
export async function transitionApplication(id,stage,assignee,version){return unwrap(await db.rpc('jobs_transition_application',{p_id:id,p_stage:stage,p_assignee:assignee||null,p_expected_version:version}));}
