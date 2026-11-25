import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {inspectImage, maxImageBytes, storedVacancyImage} from '../supabase/functions/jobs-vacancy-image/image.mjs';
import {vacancyImageHandler} from '../supabase/functions/jobs-vacancy-image/handler.mjs';
import {uploadVacancyImage} from '../dist/jobs-vacancy-image.js';

test('browser upload uses verified image bytes and stops if the account changes during optimization',async t=>{
 const png=await readFile(new URL('../dist/assets/favicon-32.png',import.meta.url));
 const mislabeled=new File([png],'photo.jpg',{type:'image/jpeg'});
 const priorBitmap=globalThis.createImageBitmap, priorXhr=globalThis.XMLHttpRequest;
 t.after(()=>{
  if(priorBitmap)globalThis.createImageBitmap=priorBitmap;else delete globalThis.createImageBitmap;
  if(priorXhr)globalThis.XMLHttpRequest=priorXhr;else delete globalThis.XMLHttpRequest;
 });
 globalThis.createImageBitmap=async()=>({width:32,height:32,close(){}});
 const requests=[];
 globalThis.XMLHttpRequest=class {
  headers={};upload={};
  open(method,url){this.method=method;this.url=url;}
  setRequestHeader(key,value){this.headers[key]=value;}
  send(bytes){requests.push({bytes,headers:this.headers,method:this.method});this.status=201;this.response={id:'created'};this.onload();}
 };
 const session=id=>({data:{session:{access_token:'fixture-'+id,user:{id}}}});
 const db={auth:{getSession:async()=>session('editor')}};
 const vacancy='11000000-0000-4000-8000-000000000001';
 assert.deepEqual(await uploadVacancyImage(db,vacancy,mislabeled,()=>{}),{id:'created'});
 assert.equal(requests[0].headers['Content-Type'],'image/png');
 assert.equal(requests[0].headers.Authorization,'Bearer fixture-editor');
 assert.deepEqual(Buffer.from(await requests[0].bytes.arrayBuffer()),png);
 let reads=0;
 db.auth.getSession=async()=>session(++reads===1?'editor':'another-user');
 await assert.rejects(uploadVacancyImage(db,vacancy,mislabeled,()=>{}),/jobs.vacancy_image_forbidden/);
 assert.equal(requests.length,1);
});

test('server distinguishes supported image bytes, rejects truncation, mismatch and oversized dimensions',async()=>{
 const png=await readFile(new URL('../dist/assets/favicon-32.png',import.meta.url));
 const webp=await readFile(new URL('../dist/assets/hanoi.webp',import.meta.url));
 assert.deepEqual(inspectImage(png,'image/png'),{width:32,height:32});
 assert.ok(inspectImage(webp,'image/webp'));
 assert.equal(inspectImage(png,'image/webp'),undefined);
 for(const [bytes,type] of [[png,'image/png'],[webp,'image/webp']]){
  assert.equal(inspectImage(bytes.subarray(0,-1),type),undefined);
 }
 const oversized=Buffer.from(png);
 oversized.writeUInt32BE(4097,16);
 assert.equal(inspectImage(oversized,'image/png'),undefined);
});

test('unverified or invalid uploads cannot reach managed Storage',async()=>{
 const api='https://supabase.example.test', id='11000000-0000-4000-8000-000000000001';
 const requests=[];
 const handler=vacancyImageHandler({
  url:api,publishableKey:'publishable',serviceKey:'server',cleanupKey:'disabled-test',
  fetcher:async(url,options)=>{
   requests.push({url,options});
   if(url.endsWith('/jobs_capabilities'))return Response.json({edit:options.headers.authorization==='Bearer fixture-editor'});
   return Response.json({}, {status:403});
  },
 });
 const send=(body,headers={})=>handler(new Request(api+'/?vacancy='+id,{method:'POST',body,headers}));
 const png=await readFile(new URL('../dist/assets/favicon-32.png',import.meta.url));
 const headers={authorization:'Bearer fixture-editor','content-type':'image/png'};
 assert.equal((await send(png,{'content-type':'image/png'})).status,401);
 assert.equal((await send('<svg/>',{...headers,'content-type':'image/svg+xml'})).status,415);
 const denied=new Request(api+'/?vacancy='+id,{method:'POST',body:png,headers:{...headers,authorization:'Bearer fixture-recruiter'}});
 assert.equal((await handler(denied)).status,403);
 assert.equal(denied.bodyUsed,false,'an unauthorized request is rejected before reading the image');
 assert.equal((await send('<svg/>',headers)).status,422);
 assert.equal((await send(new Uint8Array(maxImageBytes+1),headers)).status,413);
 assert.ok(requests.every(call=>call.url.endsWith('/jobs_capabilities')));
 assert.equal((await send(png,headers)).status,403);
 assert.equal(requests.length,5);
 const reservation=requests.at(-1);
 assert.match(reservation.url,/\/rpc\/jobs_vacancy_image_reserve$/);
 assert.equal(reservation.options.headers.authorization,headers.authorization);
 const reserved=JSON.parse(reservation.options.body);
 assert.equal(reserved.p_mime,'image/webp');
 assert.equal(reserved.p_width,32);
 assert.equal(reserved.p_height,32);
});

test('png uploads become same-size webp, webp stays unchanged, and an oversized result is not reserved',async()=>{
 const png=await readFile(new URL('../dist/assets/favicon-32.png',import.meta.url));
 const webp=await readFile(new URL('../dist/assets/hanoi.webp',import.meta.url));
 const converted=await storedVacancyImage(png,'image/png');
 assert.equal(converted.type,'image/webp');
 assert.deepEqual(inspectImage(converted.bytes,'image/webp'),{width:32,height:32});
 const kept=await storedVacancyImage(webp,'image/webp');
 assert.equal(kept.type,'image/webp');
 assert.deepEqual(Buffer.from(kept.bytes),webp);
 assert.deepEqual(await storedVacancyImage(png,'image/png',async()=>new Uint8Array(maxImageBytes+1)),{error:'file_size'});
 const requests=[];
 const handler=vacancyImageHandler({
  url:'https://supabase.example.test',publishableKey:'publishable',serviceKey:'server',cleanupKey:'disabled-test',
  prepareImage:async()=>({error:'file_size'}),
  fetcher:async url=>{requests.push(url);return Response.json({edit:true});},
 });
 const response=await handler(new Request('https://supabase.example.test/?vacancy=11000000-0000-4000-8000-000000000001',{
  method:'POST',body:png,headers:{authorization:'Bearer staff','content-type':'image/png'},
 }));
 assert.equal(response.status,413);
 assert.deepEqual(requests,['https://supabase.example.test/rest/v1/rpc/jobs_capabilities']);
});

test('unauthorized or in-use forget does not delete storage',async()=>{
 const api='https://supabase.example.test', id='11000000-0000-4000-8000-000000000001';
 const requests=[];
 const handler=vacancyImageHandler({
  url:api,publishableKey:'publishable',serviceKey:'server',cleanupKey:'disabled-test',
  fetcher:async(url,options)=>{
   requests.push({url,options});
   if(url.endsWith('/jobs_vacancy_image_forget')&&options.headers.authorization==='Bearer site-owner')
    return Response.json({message:'jobs.vacancy_image_in_use',code:'23514'},{status:400});
   return Response.json({}, {status:403});
  },
 });
 const missing=await handler(new Request(api+'/?forget='+id,{method:'POST'}));
 assert.equal(missing.status,401);
 assert.equal(requests.length,0);
 const forbidden=await handler(new Request(api+'/?forget='+id,{method:'POST',headers:{authorization:'Bearer staff'}}));
 assert.equal(forbidden.status,403);
 const inUse=await handler(new Request(api+'/?forget='+id,{method:'POST',headers:{authorization:'Bearer site-owner'}}));
 assert.equal(inUse.status,409);
 assert.equal((await inUse.json()).code,'in_use');
 assert.equal(requests.length,2);
 assert.match(requests[0].url,/\/jobs_vacancy_image_forget$/);
 assert.equal(requests[0].options.headers.authorization,'Bearer staff');
 assert.equal(requests[1].options.headers.authorization,'Bearer site-owner');
 assert.equal(requests.some(request=>request.options.method==='DELETE'),false);
});

test('forget removes the stored file only after confirming it is gone',async()=>{
 const api='https://supabase.example.test', id='11000000-0000-4000-8000-000000000001';
 const handlerFor=storage=>{
  const requests=[];
  const handler=vacancyImageHandler({
   url:api,publishableKey:'publishable',serviceKey:'server',cleanupKey:'disabled-test',
   fetcher:async(url,options)=>{
    requests.push({url,options});
    if(url.endsWith('/jobs_vacancy_image_forget')) return Response.json(id);
    if(options.method==='DELETE') return storage.delete();
    if(url.includes('/object/authenticated/')) return storage.read();
    if(url.endsWith('/jobs_vacancy_image_cleanup_finish')) return Response.json(null);
    if(url.endsWith('/jobs_vacancy_image_forgotten')) return Response.json(storage.forgotten);
    if(url.endsWith('/jobs_vacancy_image_release')) return Response.json(null);
    return Response.json({}, {status:403});
   },
  });
  return {handler,requests};
 };
 const send=handler=>handler(new Request(api+'/?forget='+id,{method:'POST',headers:{authorization:'Bearer staff'}}));
 const present=handlerFor({delete:()=>Response.json([]),read:()=>Response.json({}),forgotten:false});
 assert.equal((await send(present.handler)).status,502);
 assert.equal(present.requests.some(request=>request.url.endsWith('/jobs_vacancy_image_release')),true);
 assert.equal(present.requests.some(request=>request.url.endsWith('/jobs_vacancy_image_cleanup_finish')),false);
 const unfinished=handlerFor({
  delete:()=>Response.json([]),
  read:()=>new Response(null,{status:404}),
  forgotten:false,
 });
 assert.equal((await send(unfinished.handler)).status,502);
 assert.equal(unfinished.requests.at(-1).url.endsWith('/jobs_vacancy_image_release'),true);
 const gone=handlerFor({
  delete:()=>Response.json([]),
  read:()=>Response.json({statusCode:'404',error:'not_found'},{status:400}),
  forgotten:true,
 });
 const deleted=await send(gone.handler);
 assert.equal(deleted.status,200);
 assert.deepEqual(await deleted.json(),{id});
 assert.equal(gone.requests.some(request=>request.url.endsWith('/jobs_vacancy_image_release')),false);
 assert.equal(gone.requests.some(request=>request.options.method==='GET'),true);
});
