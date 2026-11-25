import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createDiscoveryHandler} from '../api/discovery.js';
import {createVacancyHandler} from '../api/vacancy.js';

const row={
  id:'fixture-job',kind:'vacancy',slug:'teacher',published_at:'2026-11-04T08:00:00Z',expires_on:'2099-11-30',
  title_en:'English teacher',body_en:'Teach English at a local school.',
  title_vi:'Giáo viên tiếng Anh',body_vi:'Dạy tiếng Anh tại địa phương. </script><img>',
  seo_title_en:'English teaching opportunity',
  data:{employer_name_en:'Example School',location_slug:'hanoi',street_address:'School street'},
};
async function request(handler,url,method='GET'){
  const res={writeHead(status,headers){Object.assign(this,{status,headers});return this;},end(body){this.body=body;}};
  await handler({url,method},res);
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

test('expired jobs emit no posting and an English-only job keeps one canonical URL',async()=>{
  const expired=await request(createVacancyHandler(async()=>({...row,expires_on:'2000-01-01'})),'/jobs/teacher');
  assert.equal(expired.status,404);
  assert.doesNotMatch(expired.body,/JobPosting/);
  const english=await request(createVacancyHandler(async()=>({...row,title_vi:'',body_vi:''})),'/jobs/teacher?lang=vi');
  assert.match(english.body,/<html lang="en"/);
  assert.match(english.body,/rel="canonical" href="https:\/\/jobs.garyhome.vn\/jobs\/teacher"/);
  assert.doesNotMatch(english.body,/hreflang="vi"/);
});
