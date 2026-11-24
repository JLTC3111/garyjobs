import test from 'node:test';
import assert from 'node:assert/strict';
import {attachCv} from '../dist/jobs-cv.js';

test('retrying the same CV after a lost response reuses the stored file and attachment',async()=>{
 const file=new File(['fixture CV'],'candidate.pdf',{type:'application/pdf'});
 const path='candidate/application/reserved.pdf',document={id:'attachment',object_path:path};
 let stored=false,completed=false,uploads=0,finalizations=0;
 const fingerprints=[];
 const db={
  async rpc(name,args){
   if(name==='jobs_reserve_cv_upload'){
    assert.equal(args.p_application_id,'application');
    fingerprints.push(args.p_fingerprint);
    return {data:{id:'reservation',object_path:path,stored,document:completed?document:null}};
   }
   assert.equal(name,'jobs_complete_cv_upload');assert.deepEqual(args,{p_upload_id:'reservation'});
   assert.equal(stored,true);
   if(++finalizations===1)return {error:new Error('network lost')};
   completed=true;return {data:document};
  },
  storage:{from(bucket){
   assert.equal(bucket,'jobs-cv');
   return {async upload(key,bytes,{upsert}){
    assert.equal(key,path);assert.equal(bytes,file);assert.equal(upsert,false);
    uploads++;stored=true;throw new Error('upload response lost');
   }};
  }}
 };
 await assert.rejects(()=>attachCv(db,'application',file),/network lost/);
 assert.deepEqual(await attachCv(db,'application',file),document);
 assert.deepEqual(await attachCv(db,'application',file),document);
 assert.equal(uploads,1);assert.equal(finalizations,2);
 assert.equal(new Set(fingerprints).size,1);
 assert.match(fingerprints[0],/^[a-f0-9]{64}$/);
});
