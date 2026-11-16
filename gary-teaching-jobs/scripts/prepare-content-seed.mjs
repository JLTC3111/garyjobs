// Optional editorial import. Every imported record is a draft; no stale role is
// published and no current staff-edited content is overwritten.
import {readFile,writeFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../dist/app.js',import.meta.url),'utf8');
const start=source.indexOf('let jobs = [')+'let jobs = '.length,end=source.indexOf('\n];',start)+2;
const jobs=vm.runInNewContext('('+source.slice(start,end)+')',Object.create(null),{timeout:100});
const records=[],taxonomy=(kind,slug,en,vi)=>({kind,slug,title_en:en,title_vi:vi,summary_en:`Teaching recruitment ${kind}: ${en}.`,summary_vi:`Thông tin tuyển dụng: ${vi}.`,body_en:'',body_vi:'',data:{}});
records.push(taxonomy('category','public','Public schools','Trường công lập'),taxonomy('category','centers','Language centers','Trung tâm tiếng Anh'));
for(const job of jobs){
 if(!records.some(r=>r.kind==='location'&&r.slug===job.region))records.push(taxonomy('location',job.region,job.location,job.location));
 records.push({kind:'vacancy',slug:job.id,title_en:job.title[0],title_vi:job.title[1],summary_en:job.intro[0],summary_vi:job.intro[1],body_en:job.notes[0],body_vi:job.notes[1],data:{employer_slug:'',category_slug:job.category,location_slug:job.region,closes_on:'',hours:job.hours,ages:Array.isArray(job.age)?job.age[0]:job.age||'',contact_email:job.email,source_url:job.source,requirements_en:job.requirements.map(r=>r[0]).join('\n'),requirements_vi:job.requirements.map(r=>r[1]).join('\n'),benefits_en:job.benefit[0],benefits_vi:job.benefit[1]}});
}
const payload=JSON.stringify(records).replaceAll("'","''");
const sql=`-- OPTIONAL: imported reference content for editorial review only.\n-- Complete verified employer and closing-date fields before publication.\n-- Run only after the Jobs migration; no existing content is overwritten.\nbegin;\nwith inserted as (\n insert into public.jobs_cms_entries(kind,slug,title_en,title_vi,summary_en,summary_vi,body_en,body_vi,data,status)\n select kind,slug,title_en,title_vi,summary_en,summary_vi,body_en,body_vi,data,'draft'\n from jsonb_to_recordset('${payload}'::jsonb) as x(kind text,slug text,title_en text,title_vi text,summary_en text,summary_vi text,body_en text,body_vi text,data jsonb)\n on conflict(kind,slug) do nothing returning *\n) insert into public.jobs_cms_revisions(entry_id,version,status,snapshot) select id,version,status,to_jsonb(inserted) from inserted;\ncommit;\n`;
await writeFile(new URL('../supabase/seed-jobs-content.sql',import.meta.url),sql);
console.log(`Prepared ${records.length} draft records; no database connection used.`);
