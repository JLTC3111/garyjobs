import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createClient} from '@supabase/supabase-js';
import {createDiscoveryHandler,readVacancyIndex} from '../api/discovery.js';
import {createVacancyHandler,readPublishedVacancy} from '../api/vacancy.js';
import {createJobsPublicClient} from '../dist/jobs-public-data.js';
import {mountSquishSwitches} from '../dist/squish-switch.js';

const row={
  id:'fixture-job',kind:'vacancy',slug:'teacher',published_at:'2026-11-04T08:00:00Z',expires_on:'2099-11-30',
  title_en:'English teacher',body_en:'Teach English at a local school.',
  title_vi:'Giáo viên tiếng Anh',body_vi:'Dạy tiếng Anh tại địa phương. </script><img>',
  seo_title_en:'English teaching opportunity',
  data:{employer_name_en:'Example School',location_slug:'hanoi',street_address:'School street'},
};
async function request(handler,url,method='GET',headers={}){
  const res={writeHead(status,headers){Object.assign(this,{status,headers});return this;},end(body){this.body=body;}};
  await handler({url,method,headers},res);
  return res;
}

test('the Jobs homepage and sitemap expose active vacancy links in the response',async()=>{
  const handler=createDiscoveryHandler(async()=>[row,{...row,slug:'english-only',title_vi:'',body_vi:''}]);
  const home=await request(handler,'/');
  assert.match(home.body,/<a href="\/jobs\/teacher">English teacher<\/a>/);
  assert.doesNotMatch(home.body,/JobPosting/);
  const sitemap=await request(handler,'/sitemap.xml');
  const {window}=new JSDOM(sitemap.body,{contentType:'application/xml'});
  try{
    assert.deepEqual([...window.document.querySelectorAll('loc')].map(node=>node.textContent),[
      'https://jobs.garyhome.vn/','https://jobs.garyhome.vn/jobs/teacher','https://jobs.garyhome.vn/jobs/teacher?lang=vi','https://jobs.garyhome.vn/jobs/english-only',
    ]);
  }finally{window.close();}
  assert.equal((await request(handler,'/sitemap.xml','HEAD')).body,undefined);
  const failed=createDiscoveryHandler(async()=>{throw Error('offline');});
  assert.equal((await request(failed,'/sitemap.xml')).status,503);
  assert.match((await request(failed,'/')).body,/temporarily unavailable/);
});

test('the public HTTP handlers fetch the current snapshot on every request without forwarding a session',async()=>{
  let live=null, reads=0;
  const client=createJobsPublicClient(createClient,async(input,options)=>{
    reads++;
    const {pathname,searchParams}=new URL(input),headers=new Headers(options.headers);
    assert.equal(pathname,'/rest/v1/jobs_public_content');
    assert.equal(searchParams.get('kind'),'eq.vacancy');
    assert.equal(options.cache,'no-store');
    assert.equal(headers.has('cookie'),false);
    const authorization=headers.get('authorization');
    assert.ok(authorization===null||authorization===`Bearer ${headers.get('apikey')}`);
    const slug=searchParams.get('slug');
    const rows=live&&(!slug||slug===`eq.${live.slug}`)?[live]:[];
    return Response.json(rows,{headers:{'Content-Range':rows.length?'0-0/1':'*/0'}});
  });
  const discovery=createDiscoveryHandler(sitemap=>readVacancyIndex(client,sitemap));
  const vacancy=createVacancyHandler(slug=>readPublishedVacancy(slug,client));
  const check=async(headers, expected)=>{
    const home=await request(discovery,'/','GET',headers);
    const sitemap=await request(discovery,'/sitemap.xml','GET',headers);
    const detail=await request(vacancy,'/jobs/teacher','GET',headers);
    for(const res of [home,sitemap,detail])assert.equal(res.headers['Cache-Control'],'no-store');
    assert.equal(home.status,200);
    assert.equal(sitemap.status,200);
    assert.equal(detail.status,expected?200:404);
    if(expected){
      assert.ok(home.body.includes(expected.title_en));
      assert.match(sitemap.body,/jobs\/teacher/);
      assert.ok(detail.body.includes(expected.seo_title_en));
      assert.ok(detail.body.includes(expected.body_en));
      assert.match(detail.body,/JobPosting/);
    }else{
      assert.doesNotMatch(home.body,/href="\/jobs\/teacher"/);
      assert.doesNotMatch(sitemap.body,/jobs\/teacher/);
      assert.doesNotMatch(detail.body,/JobPosting|data-vacancy-alternate|rel="canonical"/);
      assert.match(detail.body,/noindex,follow/);
    }
  };
  const candidate={authorization:'Bearer fixture-candidate'};
  const staff={authorization:'Bearer fixture-staff',cookie:'jobs-session=fixture-staff'};
  await check({},null);
  await check(candidate,null);
  live=row;
  await check({},row);
  await check(staff,row);
  live={...row,title_en:'Newly published title',seo_title_en:'Newly published SEO',body_en:'Newly published body.'};
  await check(candidate,live);
  live=null;
  await check(staff,null); // Unpublish
  live=row;
  await check(staff,row);
  live=null;
  await check(candidate,null); // Delete
  assert.equal(reads,24);
});

test('translated vacancies expose self canonicals, reciprocal alternates and escaped JobPosting',async()=>{
  const handler=createVacancyHandler(async()=>row);
  for(const variant of ['', '?lang=vi']){
    const res=await request(handler,'/jobs/teacher'+variant);
    const {window}=new JSDOM(res.body);
    try{
      const doc=window.document;
      assert.equal(doc.querySelector('link[rel=canonical]').href,'https://jobs.garyhome.vn/jobs/teacher'+variant);
      assert.equal(doc.querySelector('link[hreflang=vi]').href,'https://jobs.garyhome.vn/jobs/teacher?lang=vi');
      assert.equal(doc.querySelector('link[hreflang=en]').href,'https://jobs.garyhome.vn/jobs/teacher');
      const posting=JSON.parse(doc.querySelector('script[data-vacancy-schema]').textContent);
      assert.equal(posting['@type'],'JobPosting');
      assert.equal(posting.title,variant?row.title_vi:row.title_en);
      assert.equal(posting.datePosted,'2026-11-04');
      assert.equal(posting.validThrough,'2099-11-30T23:59:59Z');
      assert.equal(posting.hiringOrganization.name,'Example School');
      assert.equal(posting.jobLocation.address.addressCountry,'VN');
      assert.equal(doc.querySelector('#main img'),null);
      if(variant)assert.match(doc.title,/^Giáo viên tiếng Anh/);
    }finally{window.close();}
  }
});

test('server-rendered vacancy shows only an explicitly selected flexible schedule',async()=>{
  const handler=createVacancyHandler(async()=>({...row,data:{...row.data,hours:0,flexible_hours:true}}));
  for(const [query,label] of [['','Flexible Hours'],['?lang=vi','Giờ làm việc linh hoạt']]){
    const res=await request(handler,'/jobs/teacher'+query);
    const {window}=new JSDOM(res.body);
    try{
      const hours=window.document.querySelector('.vacancy-hours');
      assert.equal(hours.textContent,label);
      assert.ok(hours.querySelector('svg[aria-hidden=true]'));
      assert.doesNotMatch(hours.textContent,/0 hours/);
    }finally{window.close();}
  }
  const legacy=await request(createVacancyHandler(async()=>({...row,data:{...row.data,hours:0}})),'/jobs/teacher');
  assert.doesNotMatch(legacy.body,/Flexible Hours/);
});

test('Squish Switch follows both bilingual vacancy URLs from the server-rendered page',async()=>{
  const handler=createVacancyHandler(async()=>row);
  for(const vi of [false,true]){
    const path='/jobs/teacher'+(vi?'?lang=vi':'');
    const res=await request(handler,path);
    const {window}=new JSDOM(res.body,{url:`https://jobs.garyhome.vn${path}`});
    const doc=window.document;
    const nav=doc.querySelector('#main [data-squish-key=jobs-vacancy-page-language]');
    const alternate=nav.querySelector(vi?'a[hreflang=en]':'a[hreflang=vi]');
    assert.equal(alternate.hidden,false);
    const switches=mountSquishSwitches(doc);
    try{
      const button=nav.querySelector('[role=switch]');
      assert.equal(button.getAttribute('aria-checked'),String(vi));
      assert.equal(alternate.hidden,true);
      let destination;
      alternate.addEventListener('click',event=>{
        event.preventDefault();
        destination=event.currentTarget.pathname+event.currentTarget.search;
      });
      button.click();
      assert.equal(destination,vi?'/jobs/teacher':'/jobs/teacher?lang=vi');
    }finally{switches.destroy();window.close();}
  }
});

test('expired jobs emit no posting and an English-only job keeps one canonical URL',async()=>{
  const expired=await request(createVacancyHandler(async()=>({...row,expires_on:'2000-01-01'})),'/jobs/teacher');
  assert.equal(expired.status,404);
  assert.doesNotMatch(expired.body,/JobPosting/);
  const english=await request(createVacancyHandler(async()=>({...row,title_vi:'',body_vi:''})),'/jobs/teacher?lang=vi');
  assert.match(english.body,/<html lang="en"/);
  assert.match(english.body,/rel="canonical" href="https:\/\/jobs.garyhome.vn\/jobs\/teacher"/);
  assert.doesNotMatch(english.body,/hreflang="vi"/);
});
