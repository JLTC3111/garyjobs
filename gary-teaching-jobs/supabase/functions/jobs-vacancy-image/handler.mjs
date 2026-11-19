import {boundedImageBody, imageType, inspectImage} from './image.mjs';

const bucket = 'jobs-vacancy-images';
const idPattern = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, POST, OPTIONS',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-jobs-cleanup-key',
};
const json = (body, status = 200) => Response.json(body, {status, headers: {...cors, 'cache-control': 'no-store'}});
const error = (code, status) => json({code}, status);

export function vacancyImageHandler({url, publishableKey, serviceKey, cleanupKey, fetcher = fetch}) {
  const system = {apikey: serviceKey, authorization: `Bearer ${serviceKey}`};
  const rpc = (name, payload, headers = system) => fetcher(`${url}/rest/v1/rpc/jobs_vacancy_image_${name}`, {
    method: 'POST', headers: {...headers, 'content-type': 'application/json'}, body: JSON.stringify(payload),
  });

  async function upload(request, parameters) {
    const authorization = request.headers.get('authorization') || '';
    if (!authorization.startsWith('Bearer ')) return error('forbidden', 401);
    const vacancy = parameters.get('vacancy') || '', type = imageType(request.headers.get('content-type'));
    if (!idPattern.test(vacancy)) return error('draft_required', 400);
    if (!type) return error('invalid_file', 415);
    const bytes = await boundedImageBody(request);
    if (!bytes) return error('file_size', 413);
    const dimensions = inspectImage(bytes, type);
    if (!dimensions) return error('invalid_file', 422);
    // The caller's JWT goes to PostgREST for verification and the existing
    // CMS role check. Only the server key can write to the managed bucket.
    const reservation = await rpc('reserve', {
      p_vacancy_id: vacancy, p_mime: type, p_bytes: bytes.length,
      p_width: dimensions.width, p_height: dimensions.height,
    }, {apikey: publishableKey, authorization});
    if (!reservation.ok) {
      if ([401, 403].includes(reservation.status)) return error('forbidden', reservation.status);
      const result = await reservation.json().catch(() => ({}));
      if (result.message === 'jobs.vacancy_image_limit') return error('upload_limit', 429);
      if (result.message === 'jobs.vacancy_image_draft_required') return error('draft_required', 409);
      return error('upload_failed', 502);
    }
    const id = await reservation.json();
    if (typeof id !== 'string' || !idPattern.test(id)) return error('upload_failed', 502);
    const stored = await fetcher(`${url}/storage/v1/object/${bucket}/${id}`, {
      method: 'POST', headers: {...system, 'content-type': type, 'x-upsert': 'false'}, body: bytes,
    });
    if (!stored.ok) return error('upload_failed', 502);
    const ready = await rpc('ready', {p_image_id: id});
    if (!ready.ok) return error('upload_failed', 502);
    if (!await ready.json()) return error('forbidden', 403);
    return json({id, ...dimensions}, 201);
  }

  async function serve(request, parameters) {
    const id = parameters.get('image') || '';
    if (!idPattern.test(id)) return error('not_found', 404);
    const published = await rpc('published_mime', {p_image_id: id});
    if (!published.ok) return error('unavailable', 503);
    if (published.status === 204) return error('not_found', 404);
    const type = imageType(await published.json());
    if (!type) return error('not_found', 404);
    const headers = {...cors, 'content-type': type, 'x-content-type-options': 'nosniff',
      'cache-control': 'public, max-age=0, must-revalidate', etag: `"${id}"`};
    if (request.headers.get('if-none-match') === headers.etag) return new Response(null, {status: 304, headers});
    const stored = await fetcher(`${url}/storage/v1/object/authenticated/${bucket}/${id}`, {headers: system, method: request.method});
    if (!stored.ok) return error(stored.status === 404 ? 'not_found' : 'unavailable', stored.status === 404 ? 404 : 503);
    return new Response(request.method === 'HEAD' ? null : stored.body, {headers});
  }

  async function cleanup(request) {
    if (!cleanupKey || request.headers.get('x-jobs-cleanup-key') !== cleanupKey) return error('forbidden', 403);
    const claimed = await rpc('cleanup_claim', {});
    if (!claimed.ok) return error('cleanup_failed', 502);
    const ids = await claimed.json();
    if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !idPattern.test(id))) return error('cleanup_failed', 502);
    if (!ids.length) return json({processed: 0});
    const deleted = await fetcher(`${url}/storage/v1/object/${bucket}`, {
      method: 'DELETE', headers: {...system, 'content-type': 'application/json'}, body: JSON.stringify({prefixes: ids}),
    });
    if (!deleted.ok) return error('cleanup_failed', 502);
    const finished = await rpc('cleanup_finish', {p_image_ids: ids});
    return finished.ok ? json({processed: ids.length}) : error('cleanup_failed', 502);
  }

  return async request => {
    if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: cors});
    try {
      const parameters = new URL(request.url).searchParams;
      if (request.method === 'GET' || request.method === 'HEAD') return await serve(request, parameters);
      if (request.method === 'POST') return await (parameters.has('cleanup') ? cleanup(request) : upload(request, parameters));
      return error('method', 405);
    } catch { return error('unavailable', 503); }
  };
}
