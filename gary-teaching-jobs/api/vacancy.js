import {readFile} from 'node:fs/promises';
import {createClient} from '@supabase/supabase-js';
import {jobsConfig} from '../dist/jobs-config.js';
import {escapeText, vacancyPath, vacancySlug} from '../dist/jobs-public-content.js';

const origin = 'https://jobs.garyhome.vn';
const shell = readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
const db = createClient(jobsConfig.supabaseUrl, jobsConfig.publishableKey, {
  auth: {persistSession: false, autoRefreshToken: false, detectSessionInUrl: false},
});

async function readPublishedVacancy(slug) {
  const {data, error} = await db.from('jobs_public_content')
    .select('id,kind,slug,title_en,title_vi,summary_en,summary_vi,body_en,body_vi,seo_title_en,seo_title_vi,seo_description_en,seo_description_vi')
    .eq('kind', 'vacancy').eq('slug', slug).abortSignal(AbortSignal.timeout(8000)).maybeSingle();
  if (error) throw error;
  return data;
}

function renderVacancy(shell, row, {slug, language, status}) {
  const vi = language === 'vi';
  const text = field => String(row?.[`${field}_${language}`] || row?.[`${field}_en`] || row?.[`${field}_vi`] || '').trim();
  const heading = row ? text('title') : status === 503
    ? (vi ? 'Chưa thể tải tin tuyển dụng' : 'Vacancy could not be loaded')
    : (vi ? 'Tin tuyển dụng không còn khả dụng' : 'Vacancy unavailable');
  const message = row ? text('summary') : status === 503
    ? (vi ? 'Vui lòng thử tải lại sau.' : 'Please try again shortly.')
    : (vi ? 'Xem danh sách vị trí đang tuyển.' : 'Browse current opportunities to find another role.');
  const title = text('seo_title') || `${heading} | Vietnam English Teaching Jobs`;
  const description = (text('seo_description') || message || text('body')).replace(/\s+/gu, ' ').slice(0, 240);
  const url = row ? origin + vacancyPath(slug) : '';
  const metadata = row
    ? `<link rel="canonical" href="${escapeText(url)}"><meta property="og:url" content="${escapeText(url)}">`
    : '<meta name="robots" data-vacancy-robots content="noindex,follow">';
  const body = text('body').split(/\n\s*\n/u).filter(Boolean).map(paragraph => `<p>${escapeText(paragraph)}</p>`).join('');
  const apply = row ? `/portal.html?${new URLSearchParams({access:'candidate', view:'apply', vacancy:row.id})}` : '';
  const main = `<main id="main" class="container section-pad"><h1>${escapeText(heading)}</h1>`
    + `${message ? `<p>${escapeText(message)}</p>` : ''}${body}`
    + `${apply ? `<p><a class="button" href="${escapeText(apply)}">${vi ? 'Ứng tuyển' : 'Apply for this role'}</a></p>` : ''}`
    + `<p><a href="/#opportunities">${vi ? 'Xem tin đang tuyển' : 'Browse vacancies'}</a></p></main>`;

  return shell.replace('<html lang="en">', `<html lang="${language}" data-server-vacancy>`)
    .replace(/<title>[^<]*<\/title>/, () => `<title>${escapeText(title)}</title>`)
    .replace(/(<meta (?:name="description"|property="og:description") content=")[^"]*(">)/g, (_, start, end) => start + escapeText(description) + end)
    .replace(/(<meta property="og:title" content=")[^"]*(">)/, (_, start, end) => start + escapeText(title) + end)
    .replace('</head>', () => `${metadata}\n</head>`)
    .replace(/<!-- vacancy-content:start -->[\s\S]*?<!-- vacancy-content:end -->/, () => main)
    .replace(/<noscript>[\s\S]*?<\/noscript>/, '');
}

export function createVacancyHandler(load = readPublishedVacancy) {
  return async function vacancy(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, {Allow:'GET, HEAD'}).end(); return; }
    const url = new URL(req.url, origin);
    const requestedSlug = url.pathname.startsWith('/jobs/') ? vacancySlug(url.pathname) : (req.query?.slug ?? url.searchParams.get('slug'));
    const slug = vacancyPath(requestedSlug) ? requestedSlug : null;
    const language = (req.query?.lang ?? url.searchParams.get('lang')) === 'vi' ? 'vi' : 'en';
    let status = 404, row = null;
    if (slug) {
      try {
        row = await load(slug);
        if (row && (row.kind !== 'vacancy' || row.slug !== slug)) throw new Error('Invalid vacancy snapshot');
        if (row) status = 200;
      } catch { row = null; status = 503; }
    }
    const headers = {'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff'};
    if (status === 503) headers['Retry-After'] = '60';
    const body = req.method === 'HEAD' ? undefined : renderVacancy(await shell, row, {slug, language, status});
    res.writeHead(status, headers).end(body);
  };
}

export default createVacancyHandler();
