import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {inspectImage, maxImageBytes} from '../supabase/functions/jobs-vacancy-image/image.mjs';
import {vacancyImageHandler} from '../supabase/functions/jobs-vacancy-image/handler.mjs';

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
  fetcher:async(url,options)=>{requests.push({url,options});return Response.json({}, {status:403});},
 });
 const send=(body,headers={})=>handler(new Request(api+'/?vacancy='+id,{method:'POST',body,headers}));
 const png=await readFile(new URL('../dist/assets/favicon-32.png',import.meta.url));
 const headers={authorization:'Bearer no-cms-access','content-type':'image/png'};
 assert.equal((await send(png,{'content-type':'image/png'})).status,401);
 assert.equal((await send('<svg/>',{...headers,'content-type':'image/svg+xml'})).status,415);
 assert.equal((await send('<svg/>',headers)).status,422);
 assert.equal((await send(new Uint8Array(maxImageBytes+1),headers)).status,413);
 assert.equal(requests.length,0);
 assert.equal((await send(png,headers)).status,403);
 assert.equal(requests.length,1);
 assert.match(requests[0].url,/\/rpc\/jobs_vacancy_image_reserve$/);
 assert.equal(requests[0].options.headers.authorization,headers.authorization);
});
