import {readFile} from 'node:fs/promises';
import {createClient} from '@supabase/supabase-js';
import {createJobsPublicClient} from '../dist/jobs-public-data.js';
import {escapeText,vacancyPath} from '../dist/jobs-public-content.js';
import {jobsOrigin,vacancyLanguages,vacancyLanguagePath,vacancyAlternates} from '../dist/jobs-seo.js';

const shell=readFile(new URL('../dist/index.html',import.meta.url),'utf8');
const db=createJobsPublicClient(createClient);

export async function readVacancyIndex(client,includeLocales) {
  const rows=[],signal=AbortSignal.timeout(5000);
  const fields=includeLocales?'slug,title_en,title_vi,body_en,body_vi':'slug,title_en,title_vi';
  let total=null;
  for(let offset=0;offset<25000;){
    const {data,error,count}=await client.from('jobs_public_content').select(fields,offset===0?{count:'exact'}:{})
      .eq('kind','vacancy').order('slug').range(offset,offset+199).abortSignal(signal);
    if(error)throw error;
    if(!Array.isArray(data)||data.some(row=>!vacancyPath(row?.slug)))throw new Error('Invalid published vacancies');
    rows.push(...data);
    offset+=data.length;
    if(typeof count==='number')total=count;
    if(!data.length||total!==null&&offset>=total)return rows;
  }
  throw new Error('Vacancy index exceeds its URL limit');
}

export function jobsSitemap(rows) {
  const urls=[`<url><loc>${jobsOrigin}/</loc></url>`];
  for(const row of rows){
    const languages=vacancyLanguages(row);
    const alternates=vacancyAlternates(row.slug,languages)
      .map(([lang,url])=>`<xhtml:link rel="alternate" hreflang="${lang}" href="${escapeText(url)}"/>`).join('');
    for(const lang of languages.length?languages:['en']){
      const url=jobsOrigin+vacancyLanguagePath(row.slug,lang,languages);
      urls.push(`<url><loc>${escapeText(url)}</loc>${alternates}</url>`);
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${urls.join('')}</urlset>\n`;
}

export function jobsHomepage(html, rows) {
  const links=rows?.map(row=>`<li><a href="${vacancyPath(row.slug)}">${escapeText(row.title_en||row.title_vi)}</a></li>`).join('');
  const result=links?`<ul>${links}</ul>`:`<p>${rows?'There are no published vacancies right now.':'Vacancies are temporarily unavailable.'}</p>`;
  return html.replace('<!-- jobs-index -->',()=>`<section id="opportunities"><h2>Current teaching vacancies</h2>${result}</section>`);
}

export function createDiscoveryHandler(load=(sitemap)=>readVacancyIndex(db,sitemap)){
  return async function discovery(req,res){
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{Allow:'GET, HEAD'}).end();return;}
    const url=new URL(req.url,jobsOrigin);
    const sitemap=url.pathname==='/sitemap.xml'||(url.pathname==='/api/discovery'&&(req.query?.format??url.searchParams.get('format'))==='sitemap');
    let rows;
    try{rows=await load(sitemap);}catch{
      if(sitemap){
        res.writeHead(503,{'Retry-After':'60','Cache-Control':'no-store','Content-Type':'text/plain; charset=utf-8'})
          .end(req.method==='HEAD'?undefined:'Sitemap temporarily unavailable');
        return;
      }
    }
    const type=sitemap?'application/xml':'text/html';
    const body=sitemap?jobsSitemap(rows):jobsHomepage(await shell,rows);
    res.writeHead(200,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'})
      .end(req.method==='HEAD'?undefined:body);
  };
}
export default createDiscoveryHandler();
