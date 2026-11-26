import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHmac, randomBytes, timingSafeEqual} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {PGlite} from '@electric-sql/pglite';
import {createClient} from '@supabase/supabase-js';
import {readAvatarReferences, saveProfilePhoto} from '../dist/profile-photo-editor.js';
import {normalizeProfileWebp} from '../dist/profile-webp.js';
import {imageBytes, taggedAlphaBytes, taggedImageBytes, taggedLosslessBytes} from './helpers/jobs-avatar-webp.mjs';

const origin = 'https://jobs-avatar-fixture.invalid';
const functionUrl = origin + '/functions/v1/jobs-profile-avatar';
const bucket = 'gary-jobs-profile-photos';
const publishableKey = 'sb_publishable_jobs_fixture';
const serviceKey = 'sb_secret_jobs_fixture';
const password = 'fixture-account-password';
const actors = [
  {id:'90000000-0000-4000-8000-000000000001', email:'owner@avatar.test', is_anonymous:false},
  {id:'90000000-0000-4000-8000-000000000002', email:'peer@avatar.test', is_anonymous:false},
  {id:'90000000-0000-4000-8000-000000000003', email:'anonymous@avatar.test', is_anonymous:true},
];
const bundle = new URL('../supabase/functions/jobs-profile-avatar/index.ts', import.meta.url);

async function fixture(t) {
  const pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create schema storage;
    create schema jobs_private;
    create table auth.users(id uuid primary key);
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb
    $$;
    create function auth.uid() returns uuid language sql stable as $$
      select (auth.jwt()->>'sub')::uuid
    $$;
    create table storage.buckets(id text primary key, name text, public boolean,
      file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(bucket_id text references storage.buckets(id), name text,
      user_metadata jsonb, primary key(bucket_id,name));
    alter table storage.objects enable row level security;
    create policy fixture_other_app_storage on storage.objects for all to anon,authenticated
      using (true) with check (true);
    grant usage on schema auth,storage,jobs_private to anon,authenticated,service_role;
    grant select on storage.objects to anon,authenticated;
    grant select,insert,delete on storage.objects to service_role;
  `);
  const sql = await readFile(new URL('../supabase/migrations/20261126101517_gary_jobs_profile_photos.sql', import.meta.url), 'utf8');
  // Install the photo schema as test fixtures in memory. Leave out the
  // deployment transaction and the PostgREST schema reload notification.
  await pg.exec(sql.replace(/^begin;\s*/, '').replace(/\nnotify pgrst,'reload schema';\s*commit;\s*$/, ''));
  for (const actor of actors) await pg.query('insert into auth.users(id) values($1)', [actor.id]);

  const jwtKey = randomBytes(32);
  const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const signature = text => createHmac('sha256', jwtKey).update(text).digest();
  const now = () => Math.floor(Date.now() / 1000);
  function tokenFor(actor, exp = now() + 3600) {
    const signed = b64({alg:'HS256',typ:'JWT'}) + '.' + b64({
      sub:actor.id, aud:'authenticated', role:'authenticated', is_anonymous:actor.is_anonymous, exp,
    });
    return signed + '.' + signature(signed).toString('base64url');
  }
  function verifiedClaims(req) {
    const auth = req.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/i);
    if (!auth) return null;
    try {
      const [header, payload, digest, extra] = auth[1].split('.');
      const signed = Buffer.from(digest, 'base64url');
      if (extra !== undefined || signed.length !== 32 || !timingSafeEqual(signed, signature(header + '.' + payload))) return null;
      const claims = JSON.parse(Buffer.from(payload, 'base64url'));
      if (claims.exp > now() && claims.role === 'authenticated' && actors.some(actor => actor.id === claims.sub)) return claims;
    } catch { /* Invalid credentials are equivalent to a missing session. */ }
    return null;
  }

  const bodies = new Map(), background = [];
  let handler;
  async function api(input, init) {
    const req = new Request(input, init);
    const url = new URL(req.url);
    assert.equal(url.origin, origin, 'Fixture requests must stay in-process');
    if (url.pathname === '/functions/v1/jobs-profile-avatar') return handler(req);
    const key = req.headers.get('apikey');
    const claims = verifiedClaims(req);
    const json = Response.json;
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
      const body = await req.json();
      const user = actors.find(actor => actor.email === body.email && !actor.is_anonymous);
      if (key !== publishableKey || !user || body.password !== password) return json({error:'sign_in'}, {status:400});
      return json({access_token:tokenFor(user), refresh_token:'fixture-refresh', token_type:'bearer', expires_in:3600, user});
    }
    if (url.pathname === '/auth/v1/user') {
      if (key !== publishableKey || !claims) return json({error:'sign_in'}, {status:401});
      return json(actors.find(actor => actor.id === claims.sub));
    }

    const role = key === serviceKey ? 'service_role' : (claims ? 'authenticated' : 'anon');
    return pg.transaction(async db => {
      await db.exec('set local role ' + role);
      await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify(claims || {})]);
      try {
        switch (url.pathname) {
          case '/rest/v1/rpc/jobs_avatar_maintenance': {
            const {p_action, p_owner, p_id, p_remove, p_token} = await req.json();
            const {rows} = await db.query('select public.jobs_avatar_maintenance($1,$2,$3,$4,$5) as result',
              [p_action,p_owner ?? null,p_id ?? null,p_remove ?? false,p_token ?? null]);
            return json(rows[0].result);
          }
          case '/rest/v1/rpc/jobs_avatar_save': {
            const {p_id, p_expected} = await req.json();
            const {rows} = await db.query('select public.jobs_avatar_save($1,$2) as result', [p_id,p_expected]);
            return json(rows[0].result);
          }
          case '/rest/v1/jobs_avatar_profiles': {
            const filter = url.searchParams.get('user_id');
            const users = filter.startsWith('in.(') ? filter.slice(4,-1).split(',') : [filter.slice(3)];
            const {rows} = await db.query('select user_id,version,path from public.jobs_avatar_profiles where user_id=any($1::uuid[])', [users]);
            return json(rows);
          }
        }
        const object = url.pathname.match(/^\/storage\/v1\/object\/(?:authenticated\/)?gary-jobs-profile-photos(?:\/(.+))?$/);
        assert.ok(object, 'Unexpected fixture endpoint: ' + url.pathname);
        const path = object[1];
        if (req.method === 'POST') {
          assert.equal(role, 'service_role');
          assert.equal(req.headers.get('content-type'), 'image/webp');
          assert.equal(req.headers.get('x-upsert'), 'false');
          const metadata = JSON.parse(Buffer.from(req.headers.get('x-metadata'), 'base64'));
          await db.query('insert into storage.objects(bucket_id,name,user_metadata) values($1,$2,$3)', [bucket,path,metadata]);
          bodies.set(path, await req.arrayBuffer());
          return json({Key:bucket + '/' + path});
        }
        if (req.method === 'DELETE') {
          assert.equal(role, 'service_role');
          const {prefixes} = await req.json();
          for (const name of prefixes) {
            await db.query('delete from storage.objects where bucket_id=$1 and name=$2', [bucket,name]);
            bodies.delete(name);
          }
          return json([]);
        }
        assert.equal(req.method, 'GET');
        const {rows} = await db.query('select 1 from storage.objects where bucket_id=$1 and name=$2', [bucket,path]);
        if (!rows.length || !bodies.has(path)) return json({error:'not_found'}, {status:404});
        return new Response(bodies.get(path), {headers:{'content-type':'image/webp'}});
      } catch (error) {
        // Keep database failures visible to the test runner.
        if (error.code === '42501') return json({code:error.code,message:'permission'}, {status:403});
        if (error.code === 'PT409') return json({code:error.code,message:'conflict'}, {status:409});
        throw error;
      }
    });
  }

  const source = await readFile(bundle, 'utf8');
  assert.doesNotMatch(source, /^\s*import\b/m);
  const env = {
    SUPABASE_URL: origin,
    SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({default:publishableKey}),
    SUPABASE_SECRET_KEYS: JSON.stringify({default:serviceKey}),
  };
  vm.runInNewContext(source, {
    Deno:{env:{get:name => env[name]}, serve:callback => { handler = callback; }},
    EdgeRuntime:{waitUntil:task => background.push(task)},
    Request, Response, URL, Uint8Array, DataView, AbortSignal, fetch:api, crypto, btoa,
  }, {filename:fileURLToPath(bundle)});
  return {
    async signIn(actor) {
      const client = createClient(origin, publishableKey, {
        global:{fetch:api}, auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
      });
      const {data,error} = await client.auth.signInWithPassword({email:actor.email,password});
      assert.ifError(error);
      assert.equal(data.user.id, actor.id);
      return client;
    },
    rawUpload(token, actor, body = imageBytes) {
      return api(functionUrl, {method:'POST', body, headers:{
        authorization:'Bearer ' + token, apikey:publishableKey,
        'x-avatar-owner':actor.id, 'x-avatar-version':'none', 'content-type':'image/webp',
      }});
    },
    tokenFor, bodies, pg,
    settle: () => Promise.all(background.splice(0)),
  };
}

test('the default Jobs Edge entry point is the current standalone bundle', () => {
  execFileSync(process.execPath, [
    fileURLToPath(new URL('../scripts/bundle-profile-avatar.mjs', import.meta.url)), '--check',
  ]);
});

test('the standalone accepts a tagged WebP from a signed-in user and enforces the owner-only lifecycle', async t => {
  const h = await fixture(t);
  const [actor, other, anonymous] = actors;
  const owner = await h.signIn(actor);
  const peer = await h.signIn(other);
  const photo = new Blob([imageBytes], {type:'image/webp'});

  const token = h.tokenFor(actor);
  const forged = token.slice(0, token.lastIndexOf('.') + 1) + 'a'.repeat(43);
  assert.equal((await h.rawUpload(forged, actor)).status, 401);
  assert.equal((await h.rawUpload(h.tokenFor(actor, 0), actor)).status, 401);
  assert.equal((await h.rawUpload(h.tokenFor(anonymous), anonymous)).status, 401);
  assert.equal((await h.rawUpload(token, other)).status, 403);
  const invalid = await h.rawUpload(token, actor, new Uint8Array(24));
  assert.equal(invalid.status, 415);
  assert.equal((await invalid.json()).error, 'avatarInvalidWebp');
  assert.equal(h.bodies.size, 0);
  assert.equal((await h.pg.query('select id from jobs_private.jobs_avatar_uploads')).rows.length, 0);

  // Going straight to the function models an already-deployed client that
  // has not yet removed the optional chunks from its canvas export.
  const first = await saveProfilePhoto(owner, 'jobs', actor.id, null, new Blob([taggedImageBytes], {type:'image/webp'}));
  await h.settle();
  assert.equal(first.path, actor.id + '/' + first.version + '.webp');
  const reference = (await readAvatarReferences(owner, 'jobs', [actor.id])).get(actor.id);
  assert.deepEqual(reference, {user_id:actor.id, version:first.version, path:first.path});
  const {data: blob, error} = await owner.storage.from(bucket).download(first.path);
  assert.ifError(error);
  assert.equal(blob.type, 'image/webp');
  assert.deepEqual(Buffer.from(await blob.arrayBuffer()), imageBytes);
  assert.equal((await readAvatarReferences(peer, 'jobs', [actor.id])).size, 0);
  const peerRead = await peer.storage.from(bucket).download(first.path);
  assert.ok(peerRead.error);
  assert.equal(peerRead.data, null);
  const {error: reserveError, status: reserveStatus} = await peer.rpc('jobs_avatar_maintenance', {
    p_action:'reserve', p_owner:actor.id, p_id:crypto.randomUUID(),
  });
  assert.equal(reserveStatus, 403);
  assert.equal(reserveError?.code, '42501');

  const second = await saveProfilePhoto(owner, 'jobs', actor.id, first.version, photo);
  await h.settle();
  assert.notEqual(second.path, first.path);
  assert.equal((await readAvatarReferences(owner, 'jobs', [actor.id])).get(actor.id).path, second.path);
  assert.equal(h.bodies.has(second.path), true);
  assert.equal(h.bodies.has(first.path), false);

  const removed = await saveProfilePhoto(owner, 'jobs', actor.id, second.version, null);
  await h.settle();
  assert.equal(removed.path, null);
  assert.deepEqual((await readAvatarReferences(owner, 'jobs', [actor.id])).get(actor.id), {
    user_id:actor.id, version:removed.version, path:null,
  });
  assert.equal(h.bodies.size, 0);
});

function webpChunks(image) {
  const bytes = Buffer.from(image);
  const chunks = new Map();
  for (let offset = 12; offset < bytes.length;) {
    const tag = bytes.toString('ascii', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    chunks.set(tag, bytes.subarray(offset + 8, offset + 8 + size));
    offset += 8 + size + (size % 2);
  }
  return chunks;
}

test('WebP normalization strips ancillary chunks while preserving the image and transparency', () => {
  assert.deepEqual(Buffer.from(normalizeProfileWebp(taggedImageBytes)), imageBytes);
  const cleanAlpha = webpChunks(normalizeProfileWebp(taggedAlphaBytes));
  const originalAlpha = webpChunks(taggedAlphaBytes);
  assert.deepEqual([...cleanAlpha.keys()], ['VP8X','ALPH','VP8 ']);
  assert.equal(cleanAlpha.get('VP8X')[0], 0x10);
  assert.deepEqual(cleanAlpha.get('ALPH'), originalAlpha.get('ALPH'));
  assert.deepEqual(cleanAlpha.get('VP8 '), originalAlpha.get('VP8 '));

  const cleanLossless = webpChunks(normalizeProfileWebp(taggedLosslessBytes));
  assert.deepEqual([...cleanLossless.keys()], ['VP8L']);
  assert.deepEqual(cleanLossless.get('VP8L'), webpChunks(taggedLosslessBytes).get('VP8L'));
});

test('WebP normalization still rejects animated, truncated, and oversized images', () => {
  const animated = Buffer.from(taggedImageBytes);
  animated[20] |= 0x02;
  assert.equal(normalizeProfileWebp(animated), null);
  assert.equal(normalizeProfileWebp(taggedImageBytes.subarray(0, -1)), null);
  const wide = Buffer.from(imageBytes);
  wide.writeUInt16LE(513, 26);
  assert.equal(normalizeProfileWebp(wide), null);
  assert.equal(normalizeProfileWebp(new Uint8Array(100 * 1024 + 1)), null);
});
