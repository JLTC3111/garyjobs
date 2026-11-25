import {readFile} from 'node:fs/promises';
import {createClient} from '@supabase/supabase-js';
import {jobsConfig} from '../dist/jobs-config.js';
import {escapeText, vacancyPath, vacancySlug} from '../dist/jobs-public-content.js';
import {jobParagraphs,jobPosting,jobSchemaJson,jobsOrigin,vacancyAlternates,vacancyLanguagePath,vacancyLanguages,vacancySeoText} from '../dist/jobs-seo.js';
import {locationOptions} from '../dist/jobs-vacancy-options.js';

const shell = readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
const db = createClient(jobsConfig.supabaseUrl, jobsConfig.publishableKey, {
  auth: {persistSession: false, autoRefreshToken: false, detectSessionInUrl: false},
});

async function readPublishedVacancy(slug) {
  const signal=AbortSignal.timeout(8000);
  const {data, error} = await db.from('jobs_public_content')
    .select('id,kind,slug,title_en,title_vi,summary_en,summary_vi,body_en,body_vi,seo_title_en,seo_title_vi,seo_description_en,seo_description_vi,data,published_at,expires_on')
    .eq('kind', 'vacancy').eq('slug', slug).abortSignal(signal).maybeSingle();
  if (error) throw error;
  if(!data)return null;
  const fields=data.data||{}, refs=[];
  if(!fields.employer_name_en&&!fields.employer_name_vi&&fields.employer_slug)refs.push(fields.employer_slug);
  if(fields.location_slug&&!locationOptions.some(option=>option.value===fields.location_slug))refs.push(fields.location_slug);
  if(refs.length){
    const reference=await db.from('jobs_public_content').select('kind,slug,title_en,title_vi')
      .in('kind',['employer','location']).in('slug',refs).abortSignal(signal);
    if(!reference.error)data.seoReferences=reference.data||[];
  }
  return data;
}

function renderVacancy(shell, row, {slug, language, status}) {
  const languages=vacancyLanguages(row);
  language=languages.includes(language)?language:languages[0]||language;
  const vi = language === 'vi';
  const text = field => String(row?.[`${field}_${language}`] || row?.[`${field}_en`] || row?.[`${field}_vi`] || '').trim();
  const heading = row ? text('title') : status === 503
    ? (vi ? 'Chưa thể tải tin tuyển dụng' : 'Vacancy could not be loaded')
    : (vi ? 'Tin tuyển dụng không còn khả dụng' : 'Vacancy unavailable');
  const message = row ? text('summary') : status === 503
    ? (vi ? 'Vui lòng thử tải lại sau.' : 'Please try again shortly.')
    : (vi ? 'Xem danh sách vị trí đang tuyển.' : 'Browse current opportunities to find another role.');
  const {title,description}=row?vacancySeoText(row,language):{title:`${heading} | Vietnam English Teaching Jobs`,description:message};
  const url = row ? jobsOrigin + vacancyLanguagePath(slug,language,languages) : '';
  const alternates=vacancyAlternates(slug,languages).map(([lang,href])=>
    `<link rel="alternate" hreflang="${lang}" href="${escapeText(href)}" data-vacancy-alternate>`).join('');
  const posting=row&&jobPosting(row,language,row.seoReferences);
  const metadata = row
    ? `<link rel="canonical" href="${escapeText(url)}"><meta property="og:url" content="${escapeText(url)}">${alternates}`
      + (posting?`<script type="application/ld+json" data-vacancy-schema>${jobSchemaJson(posting)}</script>`:'')
    : '<meta name="robots" data-vacancy-robots content="noindex,follow">';
  const body=jobParagraphs(text('body'));
  const location=posting?.jobLocation.address;
  const publishedDetails=posting?`<p>${[posting.hiringOrganization.name,location.streetAddress,location.addressLocality].filter(Boolean).map(escapeText).join(' · ')}</p>`
    + (posting.validThrough?`<p>${vi?'Hạn nộp hồ sơ':'Applications close'} <time datetime="${posting.validThrough}">${posting.validThrough.slice(0,10)}</time></p>`:''):'';
  const languageLinks=languages.length===2?`<nav aria-label="${vi?'Ngôn ngữ':'Language'}">${languages.map(lang=>
    `<a lang="${lang}" hreflang="${lang}" href="${escapeText(vacancyLanguagePath(slug,lang,languages))}"${language===lang?' aria-current="page"':''}>${lang==='en'?'English':'Tiếng Việt'}</a>`).join(' · ')}</nav>`:'';
  const apply = row ? `/portal.html?${new URLSearchParams({access:'candidate', view:'apply', vacancy:row.id})}` : '';
  const main = `<main id="main" class="container section-pad"><h1>${escapeText(heading)}</h1>`
    + `${languageLinks}${publishedDetails}${message ? `<p>${escapeText(message)}</p>` : ''}${body}`
    + `${apply ? `<p><a class="button" href="${escapeText(apply)}">${vi ? 'Ứng tuyển' : 'Apply for this role'}</a></p>` : ''}`
    + `<p><a href="/#opportunities">${vi ? 'Xem tin đang tuyển' : 'Browse vacancies'}</a></p></main>`;

  return shell.replace('<html lang="en">', `<html lang="${language}" data-server-vacancy>`)
    .replace(/<title>[^<]*<\/title>/, () => `<title>${escapeText(title)}</title>`)
    .replace(/<link rel="canonical" href="[^"]*">|<meta property="og:url" content="[^"]*">/g,'')
    .replace(/(<meta (?:name="description"|property="og:description") content=")[^"]*(">)/g, (_, start, end) => start + escapeText(description) + end)
    .replace(/(<meta property="og:title" content=")[^"]*(">)/, (_, start, end) => start + escapeText(title) + end)
    .replace('</head>', () => `${metadata}\n</head>`)
    .replace(/<!-- vacancy-content:start -->[\s\S]*?<!-- vacancy-content:end -->/, () => main)
    .replace(/<noscript>[\s\S]*?<\/noscript>/, '');
}

export function createVacancyHandler(load = readPublishedVacancy) {
  return async function vacancy(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, {Allow:'GET, HEAD'}).end(); return; }
    const url = new URL(req.url, jobsOrigin);
    const requestedSlug = url.pathname.startsWith('/jobs/') ? vacancySlug(url.pathname) : (req.query?.slug ?? url.searchParams.get('slug'));
    const slug = vacancyPath(requestedSlug) ? requestedSlug : null;
    const language = (req.query?.lang ?? url.searchParams.get('lang')) === 'vi' ? 'vi' : 'en';
    let status = 404, row = null;
    if (slug) {
      try {
        row = await load(slug);
        if (row && (row.kind !== 'vacancy' || row.slug !== slug)) throw new Error('Invalid vacancy snapshot');
        if (row?.expires_on && row.expires_on<new Date().toISOString().slice(0,10)) row=null;
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
