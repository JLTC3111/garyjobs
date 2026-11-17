/* Local visual QA: actual portal/CMS/sidebar/appearance with in-memory services.
   No authentication request, storage upload or publication reaches a server. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import vm from 'node:vm';
import {build} from 'esbuild';
import * as choices from '../dist/jobs-vacancy-options.js';
const dist=fileURLToPath(new URL('../dist/',import.meta.url));
const out=resolve(process.argv[2]||'/private/tmp/gary-jobs-theme-qa');
await mkdir(out,{recursive:true});
const backend=(await readFile(new URL('../dist/jobs-backend.js',import.meta.url),'utf8')).replace(/^import .*$/gm,'').replace(/^export /gm,'');
const context=vm.createContext({createClient:()=>({}),jobsConfig:{},...choices});
vm.runInContext(backend+'\nglobalThis.fixture={collections,STAGES,STAGE_LABELS};',context);
const vacancy={id:'fixture-vacancy',kind:'vacancy',slug:'english-teacher-hanoi',title_en:'English Teacher in Hanoi',title_vi:'Giáo viên tiếng Anh tại Hà Nội',summary_en:'Join a supportive teaching team.',summary_vi:'Đồng hành cùng đội ngũ giảng dạy.',body_en:'Teach English with a supportive team in Hanoi. Share your experience and help learners grow.',body_vi:'Giảng dạy tiếng Anh cùng đội ngũ tận tâm tại Hà Nội.',status:'published',version:3,updated_at:'2026-11-17T08:00:00Z',data:{employer_name_en:'Example Education',category_slug:'centers',location_slug:'hanoi',salary_en:'35–45 million VND / month',salary_vi:'35–45 triệu đồng / tháng',contact_email:'recruitment@example.test',closes_on:'2099-12-31'}};
const applications=[{id:'fixture-application',candidate_id:'fixture-user',vacancy_title:'English Teacher in Hanoi',receipt_code:'TJ-2026-1042',stage:'screening',version:2,created_at:'2026-11-16T09:00:00Z',message:'I have a CELTA certificate and three years of classroom experience. I would love to discuss the next step.',jobs_candidates:{full_name:'Alex Taylor',email:'alex@example.test',phone:'+84 900 000 000',current_location:'Hanoi'}},{id:'fixture-application-2',candidate_id:'fixture-user',vacancy_title:'Primary Teacher · International School',receipt_code:'TJ-2026-1038',stage:'submitted',version:1,created_at:'2026-11-15T10:30:00Z',message:'Application received by the recruitment team.',jobs_candidates:{full_name:'Alex Taylor'}}];
const mock=`const {collections,STAGES,STAGE_LABELS}=${JSON.stringify(context.fixture)},jobsConfig={cvBucket:'jobs-cv'};
let fixtureRecords=[${JSON.stringify(vacancy)}],fixtureApplications=${JSON.stringify(applications)};
const capabilities=async()=>new URL(location.href).searchParams.get('access')==='candidate'?{}:({read:true,edit:true,publish:true,media:true,recruit:true,role:'admin'}),unwrap=r=>{if(r.error)throw r.error;return r.data;},errorText=e=>e.message||'The action could not be completed.';
const createCmsAdapter=()=>({capabilities,list:async({kind})=>({records:fixtureRecords.filter(r=>r.kind===kind),total:fixtureRecords.filter(r=>r.kind===kind).length}),revisions:async()=>[],listMedia:async()=>[],uploadMedia:async(file,metadata)=>({id:'demo-media',...metadata,file_name:file.name}),save:async r=>{const next={...r,id:r.id||'fixture-saved',version:(r.version||0)+1,status:r.status||'draft'};fixtureRecords=fixtureRecords.filter(item=>item.id!==next.id).concat(next);return next;},transition:async(id,status,{expectedVersion})=>{const r=fixtureRecords.find(r=>r.id===id);const next={...r,status,version:expectedVersion+1};fixtureRecords=fixtureRecords.map(item=>item.id===id?next:item);return next;}});
function fixtureQuery(table){let id;const result=()=>table==='jobs_candidates'?{id:'fixture-user',full_name:'Alex Taylor',phone:'+84 900 000 000',current_location:'Hanoi'}:table==='jobs_public_content'?fixtureRecords[0]:table==='jobs_applications'?fixtureApplications.find(a=>a.id===id)||fixtureApplications[0]:table==='jobs_application_events'?[{stage:'screening',created_at:'2026-11-17T09:00:00Z'},{stage:'submitted',created_at:'2026-11-16T09:00:00Z'}]:[];const query={select(){return this},eq(key,value){if(key==='id')id=value;return this},order(){return this},limit(){return Promise.resolve({data:result()})},single:async()=>({data:result()}),maybeSingle:async()=>({data:result()})};return query;}
const db={auth:{getUser:async()=>({data:{user:{id:'fixture-user',email:'alex@example.test',email_confirmed_at:'2026-01-01'}}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>({data:{}})},rpc:async()=>({data:[]}),from:fixtureQuery,storage:{from:()=>({createSignedUrl:async()=>({data:{signedUrl:'#demo-document'}})})}};
const applicationList=async()=>({records:fixtureApplications,total:fixtureApplications.length}),submitApplication=async()=>({receipt_code:'TJ-DEMO'}),uploadCv=async()=>{},transitionApplication=async()=>fixtureApplications[0];`;
const portal=(await readFile(new URL('../dist/jobs-portal.js',import.meta.url),'utf8')).split('\n').filter(line=>!line.startsWith('import ')).join('\n');
const validator=backend.match(/^function validateCv[^\n]+/m)?.[0];
await build({stdin:{contents:`import {mountCms} from './cms-foundation/index.js';import './jobs-staff-sidebar.js';import './jobs-portal-appearance.js';${mock}\n${portal}`,resolveDir:dist,sourcefile:'portal-theme-fixture.js'},bundle:true,format:'iife',target:'es2022',outfile:resolve(out,'portal.js'),plugins:[{name:'fixture-cv-validation',setup(bundler){bundler.onResolve({filter:/^\.\/jobs-backend\.js$/},()=>({path:'cv-validation',namespace:'fixture'}));bundler.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`const jobsConfig={maxCvBytes:10485760};export ${validator}`,loader:'js'}));}}]});
const seed=`(()=>{const params=new URL(location.href).searchParams;try{localStorage.setItem('gary-jobs-theme',params.get('theme')||'system');localStorage.setItem('gary-language',JSON.stringify(params.get('lang')==='vi'?'vi':'en'));}catch{}})();`;
const init=await readFile(new URL('../dist/jobs-theme-init.js',import.meta.url),'utf8');
let html=await readFile(new URL('../dist/portal.html',import.meta.url),'utf8');
html=html.replace(/<script[^>]*>[\s\S]*?<\/script>/g,'').replace(/(?:href|src)="(?!https?:|#|\/)([^"]+)"/g,(match,path)=>match.replace(path,pathToFileURL(resolve(dist,path)).href));
html=html.replace('<head>','<head>\n<script>'+seed+'\n'+init+'</script>').replace('</body>','<script src="portal.js"></script></body>');
await writeFile(resolve(out,'portal.html'),html);
console.log(pathToFileURL(resolve(out,'portal.html')).href+'?access=staff&theme=dark');
console.log(pathToFileURL(resolve(out,'portal.html')).href+'?access=candidate&theme=dark&lang=vi');
