import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {bindFeedbackDom} from './feedback-dom.mjs';
import {mountCms} from '../../dist/cms-foundation/index.js';
import {mountJobsStaffSidebar} from '../../dist/jobs-staff-sidebar.js';
import {mountJobsAccountMenu} from '../../dist/jobs-account-menu.js';
import {mountStaffManagement} from '../../dist/jobs-staff-management.js';
import {mountTalentPool} from '../../dist/jobs-talent-pool.js';
import * as vacancyOptions from '../../dist/jobs-vacancy-options.js';
const backend=(await readFile(new URL('../../dist/jobs-backend.js',import.meta.url),'utf8')).replace(/^import .*$/gm,'').replace(/^export /gm,'');
const context=vm.createContext({createClient:()=>({}),jobsConfig:{},...vacancyOptions});vm.runInContext(backend+'\nglobalThis.value=collections;',context);
export const collections=JSON.parse(JSON.stringify(context.value));
export const settle=async()=>{for(let i=0;i<16;i++)await new Promise(resolve=>setImmediate(resolve));};
export async function staffPortal({caps={read:true,edit:true,publish:true,media:true,recruit:true,role:'admin'},access='staff',view='cms',collection,width=1440,height=960,records=[],confirm=()=>false,theme='light',staff=null,talent=null}={}){
 const url=new URL('https://jobs.garyhome.vn/portal.html');
 url.search=new URLSearchParams({access,view,...(collection?{collection}:{})});
 const dom=new JSDOM(await readFile(new URL('../../dist/portal.html',import.meta.url),'utf8'),{url:url.href,runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,doc=w.document;
  bindFeedbackDom(dom.window);
 w.mountJobsAccountMenu=mountJobsAccountMenu;

 Object.defineProperty(w,'innerWidth',{value:width,writable:true});Object.defineProperty(w,'innerHeight',{value:height,writable:true});doc.documentElement.dataset.jobsTheme=theme;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};w.HTMLElement.prototype.scrollIntoView=function(){};w.confirm=confirm;
 const calls={lists:[],saves:[],transitions:[],applications:[],uploads:[],mediaLists:0};let cms=null,rows=structuredClone(records);
 w.errorText=e=>e.message;w.unwrap=r=>{if(r.error)throw r.error;return r.data;};w.capabilities=async()=>caps;w.collections=collections;w.STAGES=['submitted'];w.STAGE_LABELS={submitted:['Submitted','Đã nộp']};w.jobsConfig={cvBucket:'jobs-cv'};
 w.createCmsAdapter=()=>({capabilities:async()=>caps,list:async options=>{calls.lists.push(options);return{records:rows.filter(r=>r.kind===options.kind),total:rows.filter(r=>r.kind===options.kind).length};},revisions:async()=>[],listMedia:async()=>{calls.mediaLists++;return[];},uploadMedia:async(file,metadata)=>{calls.uploads.push({file,metadata});return{};},save:async(record,options)=>{calls.saves.push({record:structuredClone(record),options});const saved={...record,id:record.id||'vacancy-one',version:record.version+1,status:'draft'};rows=[...rows.filter(r=>r.id!==saved.id),saved];return saved;},transition:async(id,status,{expectedVersion})=>{calls.transitions.push({id,status,expectedVersion});const row=rows.find(r=>r.id===id);const next={...row,status,version:expectedVersion+1};rows=rows.map(r=>r.id===id?next:r);return next;}});
 w.mountCms=(root,options)=>{cms=mountCms(root,options);return cms;};
 w.createStaffAdapter=()=>staff||{overview:async()=>({viewer:{},members:[],events:[]})};w.mountStaffManagement=mountStaffManagement;
 w.createTalentAdapter=()=>talent;w.mountTalentPool=mountTalentPool;
 w.db={auth:{getUser:async()=>({data:{user:{id:'test-user',email:'staff@example.test'}}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>({data:{}})},rpc:async()=>({data:[]}),from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:null})})};
 w.applicationList=async options=>{calls.applications.push(options);return{records:[],total:0};};w.uploadCv=async()=>{};w.transitionApplication=async()=>{};w.submitApplication=async()=>({});
 const sidebar=mountJobsStaffSidebar(doc);
 const source=(await readFile(new URL('../../dist/jobs-portal.js',import.meta.url),'utf8')).split('\n').filter(line=>!line.startsWith('import ')).join('\n');vm.runInContext(source,dom.getInternalVMContext());await settle();if(cms)await cms.ready;await settle();
 return{dom,w,doc,calls,sidebar,get cms(){return cms;},input(name,value){const element=doc.querySelector(`[name="${name}"]`);element.value=value;element.dispatchEvent(new w.Event('input',{bubbles:true}));return element;},async click(selector){doc.querySelector(selector).click();await settle();},async changeCapabilities(next){caps=next;w.dispatchEvent(new w.Event('focus'));await new Promise(resolve=>setTimeout(resolve,0));await settle();},async close(){cms?.destroy({force:true});sidebar.destroy();dom.window.close();}};
}
