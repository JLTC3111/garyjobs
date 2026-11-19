import {escapeText, signedPortrait} from './jobs-public-content.js';

export function publicTeacherProfiles(rows, backend) {
  const valid = [];
  const seen = new Set();
  if (!Array.isArray(rows)) return valid;
  const required = {public_name:100, specialty_en:120, specialty_vi:120, story_en:800, story_vi:800};
  for (const row of rows) {
    if (row?.status !== 'published' || row.placement_confirmed !== true || row.consent_confirmed !== true
        || row.approval_confirmed !== true || typeof row.public_id !== 'string' || !row.public_id || seen.has(row.public_id)) continue;
    const portrait = signedPortrait(row.portrait_url, backend, 'jobs-showcase-portraits');
    if (!portrait || !Object.entries(required).every(([field,limit]) =>
      typeof row[field] === 'string' && row[field].trim() && row[field].length <= limit)) continue;
    seen.add(row.public_id);
    valid.push({portrait, ...Object.fromEntries(Object.keys(required).map(field=>[field,row[field].trim()]))});
  }
  return valid;
}

export function mountTeacherShowcase(doc, {read, backend}) {
  let teachers = [], validUntil = 0, request = 0, disposed = false;
  const render = () => {
    const section = doc.getElementById('teacher-showcase');
    if (!section) return;
    section.hidden = !teachers.length;
    const language = doc.documentElement.lang === 'vi' ? 'vi' : 'en';
    section.innerHTML = teachers.length ? `<div class="container">
      <h2 id="teacher-showcase-title">${language==='vi'?'Gương mặt giáo viên':'Teacher Showcase'}</h2>
      <div class="teacher-card-grid">${teachers.map(row=>`<article class="teacher-card">
        <div class="teacher-card-badge"><div class="teacher-card-portrait">
          <img src="${escapeText(row.portrait)}" alt="" width="360" height="440" loading="lazy" decoding="async" referrerpolicy="no-referrer">
          <div class="teacher-card-caption"><h3>${escapeText(row.public_name)}</h3><p>${escapeText(row['specialty_'+language])}</p></div>
        </div></div>
        <p class="teacher-card-story">${escapeText(row['story_'+language])}</p>
      </article>`).join('')}</div>
    </div>` : '';
  };
  async function refresh() {
    const current = ++request;
    teachers = [];
    render();
    try {
      const result = await read();
      if (disposed || current!==request) return;
      validUntil = Date.parse(result?.expires_at);
      if (!(validUntil>Date.now())) return;
      teachers = publicTeacherProfiles(result.profiles, backend);
      render();
    } catch { /* Only a confirmed public response can populate this section. */ }
  }
  const rerender = () => {
    if (teachers.length && Date.now()>=validUntil) void refresh();
    else render();
  };
  const resume = () => { if(!doc.hidden && teachers.length && Date.now()>=validUntil) void refresh(); };
  const restore = event => { if(event.persisted) void refresh(); };
  doc.addEventListener('jobs:public-render',rerender);
  doc.addEventListener('visibilitychange',resume);
  doc.defaultView.addEventListener('pageshow',restore);
  return {ready:refresh(), destroy(){
    disposed=true;
    doc.removeEventListener('jobs:public-render',rerender);
    doc.removeEventListener('visibilitychange',resume);
    doc.defaultView.removeEventListener('pageshow',restore);
    teachers=[];render();
  }};
}

if (typeof document !== 'undefined' && document.body?.classList.contains('jobs-public')) {
  void import('./jobs-backend.js').then(({db})=>import('./jobs-config.js').then(({jobsConfig})=>{
    mountTeacherShowcase(document,{
      backend:jobsConfig.supabaseUrl,
      async read(){
        const result=await db.functions.invoke('jobs-teacher-showcase',{method:'GET'});
        if(result.error) throw result.error;
        return result.data;
      }
    });
  })).catch(()=>{});
}
