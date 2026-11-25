import {escapeText,vacancyPath} from './jobs-public-content.js';
import {locationOptions} from './jobs-vacancy-options.js';

export const jobsOrigin='https://jobs.garyhome.vn';
export const vacancyLanguages=row=>['en','vi'].filter(lang=>
  String(row?.[`title_${lang}`]??'').trim()&&String(row?.[`body_${lang}`]??'').trim());
const local=(record,field,lang)=>String(record?.[`${field}_${lang}`]||record?.[`${field}_en`]||record?.[`${field}_vi`]||'').trim();

export function vacancySeoText(row,language) {
  const title=String(row[`seo_title_${language}`]||'').trim() || local(row,'title',language)+' | Vietnam English Teaching Jobs';
  const text=String(row[`seo_description_${language}`]||'').trim()||local(row,'summary',language)||local(row,'body',language);
  const description=text.replace(/\s+/gu,' ').trim();
  const boundary=description.lastIndexOf(' ',240);
  return {title,description:description.length<=240?description:description.slice(0,boundary>0?boundary:240)};
}

export function vacancyLanguagePath(slug,lang,languages) {
  const path=vacancyPath(slug);
  return path&&lang==='vi'&&languages.length===2 ? path+'?lang=vi' : path;
}

export function vacancyAlternates(slug,languages) {
  if(languages.length!==2)return [];
  return ['en','vi','x-default'].map(lang=>[lang,jobsOrigin+vacancyLanguagePath(slug,lang,languages)]);
}

export function jobParagraphs(value) {
  return String(value??'').split(/\n\s*\n/u).map(text=>text.trim()).filter(Boolean)
    .map(text=>`<p>${escapeText(text)}</p>`).join('');
}

export function jobPosting(row, language, references=[]) {
  const data=row?.data||{};
  const reference=(kind,slug)=>references.find(item=>item.kind===kind&&item.slug===slug);
  const company=reference('employer',data.employer_slug),place=reference('location',data.location_slug);
  const province=locationOptions.find(option=>option.value===data.location_slug);
  const employer=local(data,'employer_name',language)||local(company,'title',language);
  const localName=province?.label[language]||local(place,'title',language);
  const title=local(row,'title',language),body=local(row,'body',language),datePosted=String(row?.published_at??'').slice(0,10);
  const deadline=/^\d{4}-\d{2}-\d{2}$/.test(row?.expires_on||'')?row.expires_on:null;
  const streetAddress=String(data.street_address??'').trim();
  if(!title||!body||!employer||!localName||!/^\d{4}-\d{2}-\d{2}$/.test(datePosted)||data.category_slug==='online')return null;
  return {
    '@context':'https://schema.org', '@type':'JobPosting', title,
    description:jobParagraphs(body), datePosted,
    ...(deadline?{validThrough:deadline+'T23:59:59Z'}:{}),
    hiringOrganization:{'@type':'Organization',name:employer},
    jobLocation:{'@type':'Place',address:{'@type':'PostalAddress',addressLocality:localName,addressCountry:'VN',
      ...(streetAddress?{streetAddress}:{})}},
    identifier:{'@type':'PropertyValue',name:employer,value:row.id},
    url:jobsOrigin+vacancyLanguagePath(row.slug,language,vacancyLanguages(row)),
  };
}

export const jobSchemaJson=value=>JSON.stringify(value).replaceAll('<','\\u003c');
