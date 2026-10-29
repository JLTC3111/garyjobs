import { mountGaryApps, mountPhotoGallery } from './photo-gallery.js';

const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
const esc = (value = '') => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const readStored = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const persist = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Private browser sessions can still use the site. */ } };
const state = { lang: readStored('gary-language', 'en') === 'vi' ? 'vi' : 'en', category: 'all', location: 'all', keyword: '', expanded: false, saved: new Set(readStored('gary-saved-jobs', []).filter?.(id => typeof id === 'string') || []) };
let photoGalleryMount;
let headerApps = [];
function clearHeaderApps() {
  headerApps.forEach(mount => mount.unmount());
  headerApps = [];
}
function mountHeaderApps() {
  const shared = { language: state.lang, onFollow: () => toggleMenu(false) };
  const header = $('#gary-apps-header');
  const mobile = $('#gary-apps-mobile');
  if (header) headerApps.push(mountGaryApps(header, { ...shared, className: 'gary-apps-menu--header' }));
  if (mobile) headerApps.push(mountGaryApps(mobile, shared));
}
const t = (en, vi) => state.lang === 'vi' ? vi : en;
const pick = value => Array.isArray(value) ? value[state.lang === 'vi' ? 1 : 0] : value;
const icons = {
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  northeast: '<path d="M6 18 18 6M6 6h12v12"/>',
  chevron: '<path d="m7 10 5 5 5-5"/>',
  pin: '<path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  briefcase: '<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12a22 22 0 0 0 18 0M10 12h4v3h-4z"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6zM8 12l3 3 5-6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a18 18 0 0 1 0 18 18 18 0 0 1 0-18Z"/>',
  school: '<path d="m3 10 9-7 9 7M5 9v12h14V9M9 21v-7h6v7M11 8h2"/>',
  books: '<path d="M3 4h5v16H3zM10 4h5v16h-5zM17 5l4-1 3 16-4 1zM4 8h3m4 0h3"/>',
  cap: '<path d="m2 9 10-6 10 6-10 6zM6 12v6q6 5 12 0v-6M22 9v9"/>',
  chat: '<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l1-5a8.5 8.5 0 1 1 16-3.5Z"/><path d="M8 11h.01M12 11h.01M16 11h.01"/>',
  document: '<path d="M14 3H5v18h14V8zM14 3v5h5M8 12h8M8 16h6"/>',
  home: '<path d="m3 11 9-8 9 8M5 10v11h14V10M9 21v-8h6v8"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/>',
  phone: '<path d="m6 3 4 5-3 3q2 4 6 6l3-3 5 4q-1 4-5 3C8 19 5 16 3 8Q2 4 6 3Z"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  spark: '<path d="M12 2q0 10 10 10-10 0-10 10 0-10-10-10 10 0 10-10Z"/>',
  leaf: '<path d="M20 3Q1 1 4 15q5 11 15-2Q22 8 20 3ZM5 19 16 8"/>',
  people: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5"/>',
  facebook: '<path d="M14 21v-8h3l.5-4H14V7c0-1 .5-2 2-2h2V1h-3c-4 0-6 2-6 6v2H6v4h3v8"/>',
};
const icon = (name, extra = '') => `<svg class="icon ${extra}" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.arrow}</svg>`;
const arrow = () => icon('northeast');
const brand = () => `<a class="brand" href="#" aria-label="Gary Agency — ${t('Home', 'Trang chủ')}"><img class="brand-logo" src="assets/gary-agency-logo.png" alt="Vietnam English Teaching Jobs — Gary Agency" width="772" height="394"></a>`;
const serviceSites = {
  documents: { name: 'Gary Visa Service', url: 'https://visa.garyhome.vn/' },
  housing: { name: 'Gary Homes', url: 'https://garyhome.vn/' },
};
const serviceSiteLink = (id, className = '') => {
  const site = serviceSites[id];
  return `<a class="service-site-link ${className}" href="${site.url}" target="_blank" rel="noopener noreferrer" aria-label="${site.name}${t(' (opens in a new tab)', ' (mở trong thẻ mới)')}">${site.name} ${arrow()}</a>`;
};

const jobs = [
  {
    id: 'bac-giang', location: 'Bắc Giang', region: 'bac-giang', category: 'centers', type: ['Center & international school', 'Trung tâm & trường quốc tế'], title: ['English Teacher', 'Giáo viên tiếng Anh'], hours: 100, age: '4–16', date: '2026-09-12', email: 'thuyylingg2107@gmail.com', color: 'peach', icon: 'books',
    benefit: ['50% WP / TRC support', 'Hỗ trợ 50% WP / TRC'], intro: ['Bring your energy to a language center and international school in Bắc Giang. A full-time role teaching young learners, with accommodation support and a negotiable salary.', 'Giảng dạy tại trung tâm và trường quốc tế ở Bắc Giang. Vị trí toàn thời gian dành cho học sinh nhỏ tuổi, có hỗ trợ chỗ ở và mức lương thỏa thuận.'],
    requirements: [['Bachelor’s degree', 'Bằng cử nhân'], ['TESOL or TEFL teaching certificate', 'Chứng chỉ giảng dạy TESOL hoặc TEFL'], ['English proficiency certificate (C1, VSTEP, TOEIC, TOEFL, ESOL or equivalent)', 'Chứng chỉ năng lực tiếng Anh (C1, VSTEP, TOEIC, TOEFL, ESOL hoặc tương đương)'], ['All required documents must be legalized', 'Các giấy tờ cần thiết phải được hợp pháp hóa']],
    notes: ['The original listing gives an ASAP start and 50% work permit / temporary residence card support. Confirm the start date and accommodation arrangements with the recruiter.', 'Tin gốc ghi nhận bắt đầu sớm và hỗ trợ 50% giấy phép lao động / thẻ tạm trú. Xác nhận ngày bắt đầu và chỗ ở với chuyên viên tuyển dụng.'],
    source: 'https://garyagency.com/offer-in-bac-giang-2/',
  },
  {
    id: 'hai-phong', location: 'Hải Phòng', region: 'hai-phong', category: 'public', type: ['Public schools', 'Trường công lập'], title: ['Public School English Teacher', 'Giáo viên tiếng Anh trường công'], hours: 60, age: null, date: '2026-08-19', email: 'chloevu02@gmail.com', color: 'sage', icon: 'school',
    benefit: ['WP / TRC support', 'Hỗ trợ WP / TRC'], intro: ['Find your rhythm in the port city of Hải Phòng with an English teaching role in public schools. The published teaching load is 60 hours per month, with work permit and residence card support.', 'Giảng dạy tiếng Anh tại các trường công lập ở thành phố cảng Hải Phòng. Khối lượng giảng dạy được công bố là 60 giờ/tháng, có hỗ trợ giấy phép lao động và thẻ tạm trú.'],
    requirements: [['CV and bachelor’s degree', 'CV và bằng cử nhân'], ['TEFL, TESOL, CELTA or equivalent teaching certificate', 'Chứng chỉ TEFL, TESOL, CELTA hoặc tương đương'], ['Short introduction video', 'Video giới thiệu ngắn'], ['The listing names South African, Russian, Moroccan, EU and native English-speaking applicants as preferred; ask the recruiter about eligibility.', 'Tin gốc ưu tiên ứng viên Nam Phi, Nga, Ma-rốc, EU và người bản ngữ; liên hệ chuyên viên để xác nhận điều kiện.']],
    notes: ['The published start date was 7 September 2026. Ask the recruiter to confirm whether recruitment is still open and discuss the current start date.', 'Ngày bắt đầu được đăng là 7/9/2026. Liên hệ chuyên viên để xác nhận vị trí còn tuyển và ngày bắt đầu hiện tại.'],
    source: 'https://garyagency.com/%f0%9f%9a%a8-teaching-opportunity-in-hai-phong-%f0%9f%87%bb%f0%9f%87%b3-public-schools-2/',
  },
  {
    id: 'hanoi', location: 'Thạch Thất, Hà Nội', region: 'hanoi', category: 'public', type: ['Public school', 'Trường công lập'], title: ['English Teacher in Hanoi', 'Giáo viên tiếng Anh tại Hà Nội'], hours: 100, age: ['Grades 1–12', 'Lớp 1–12'], date: '2026-08-19', email: 'thuyylingg2107@gmail.com', color: 'lavender', icon: 'cap',
    benefit: ['100% work permit support', 'Hỗ trợ 100% giấy phép lao động'], intro: ['A full-time public school opportunity in Thạch Thất, Hanoi, for Filipino English teachers. Teach students from grades 1 to 12, with work permit support provided.', 'Cơ hội toàn thời gian tại trường công ở Thạch Thất, Hà Nội, dành cho giáo viên tiếng Anh Philippines. Giảng dạy học sinh lớp 1–12, có hỗ trợ giấy phép lao động.'],
    requirements: [['This listing is for Filipino English teachers', 'Vị trí dành cho giáo viên tiếng Anh Philippines'], ['Bachelor’s degree and a C1 / C2 English certificate', 'Bằng cử nhân và chứng chỉ tiếng Anh C1 / C2'], ['TEFL, TESOL, CELTA or equivalent is preferred', 'Ưu tiên chứng chỉ TEFL, TESOL, CELTA hoặc tương đương'], ['Good English communication and a full-time commitment in Hanoi', 'Giao tiếp tiếng Anh tốt và cam kết làm việc toàn thời gian tại Hà Nội']],
    notes: ['Teachers already in Vietnam or able to relocate soon are given priority. Salary is negotiable; confirm the full package directly with the recruiter.', 'Ưu tiên giáo viên đang ở Việt Nam hoặc có thể sớm chuyển đến. Lương thỏa thuận; xác nhận gói quyền lợi trực tiếp với chuyên viên.'],
    source: 'https://garyagency.com/job-offer-in-thach-that-hanoi/',
  },
  {
    id: 'dong-nai', location: 'Định Quán, Đồng Nai', region: 'dong-nai', category: 'centers', type: ['Kindergarten & language center', 'Mầm non & trung tâm tiếng Anh'], title: ['Full-time English Teacher', 'Giáo viên tiếng Anh toàn thời gian'], hours: 100, age: '3–18', date: '2026-08-14', email: 'chloevu02@gmail.com', color: 'peach', icon: 'books',
    benefit: ['Free accommodation', 'Chỗ ở miễn phí'], intro: ['Teach kindergarten and language center classes in Định Quán, Đồng Nai. The listing includes free accommodation, teaching materials and support with invitation letters, visas and 50% of WP / TRC costs.', 'Giảng dạy tại trường mầm non và trung tâm tiếng Anh ở Định Quán, Đồng Nai. Tin tuyển dụng có chỗ ở miễn phí, tài liệu giảng dạy, hỗ trợ thư mời, visa và 50% chi phí WP / TRC.'],
    requirements: [['University degree; English major preferred', 'Bằng đại học; ưu tiên chuyên ngành tiếng Anh'], ['TESOL, CELTA or equivalent', 'Chứng chỉ TESOL, CELTA hoặc tương đương'], ['Teaching experience and relevant certificates', 'Kinh nghiệm giảng dạy và chứng chỉ liên quan'], ['C1 certificate / IELTS is preferred', 'Ưu tiên chứng chỉ C1 / IELTS']],
    notes: ['The listing specifies weekday daytime and evening classes plus Saturday classes, with Sunday off. Confirm your exact timetable and start date with the recruiter.', 'Tin tuyển dụng có lớp ban ngày và buổi tối trong tuần, thêm thứ Bảy, nghỉ Chủ nhật. Xác nhận thời khóa biểu và ngày bắt đầu với chuyên viên.'],
    source: 'https://garyagency.com/%f0%9f%8c%9f-full-time-english-teacher-needed-dong-nai-%f0%9f%8c%9f-4/',
  },
  {
    id: 'thai-nguyen', location: 'Thái Nguyên', region: 'thai-nguyen', category: 'centers', type: ['Language center', 'Trung tâm tiếng Anh'], title: ['Native English Teacher', 'Giáo viên tiếng Anh bản ngữ'], hours: 100, age: '3–15', date: '2026-08-12', email: 'chloevu02@gmail.com', color: 'sage', icon: 'school',
    benefit: ['Housing allowance', 'Hỗ trợ tiền nhà'], intro: ['A language center role in Thái Nguyên City for a native English speaker. Teach learners aged 3–15, with a published housing allowance of 2,000,000 VND per month and 50% WP / TRC support.', 'Vị trí tại trung tâm tiếng Anh ở thành phố Thái Nguyên dành cho giáo viên bản ngữ. Học sinh từ 3–15 tuổi, hỗ trợ tiền nhà 2.000.000 VNĐ/tháng và 50% WP / TRC theo tin gốc.'],
    requirements: [['Native English speaker', 'Người nói tiếng Anh bản ngữ'], ['Bachelor’s degree', 'Bằng cử nhân'], ['CELTA, TESOL, TEFL or equivalent', 'Chứng chỉ CELTA, TESOL, TEFL hoặc tương đương'], ['CV, degree, teaching certificate and introduction video', 'CV, bằng cấp, chứng chỉ giảng dạy và video giới thiệu']],
    notes: ['Salary is negotiable and paid monthly. Confirm the current availability, start date and housing arrangements with the recruiter.', 'Lương thỏa thuận, thanh toán hằng tháng. Xác nhận vị trí còn tuyển, ngày bắt đầu và chỗ ở với chuyên viên.'],
    source: 'https://garyagency.com/native-english-teacher-needed-thai-nguyen-2/',
  },
];

const destinations = {
  hagiang: {
    name: ['Ha Giang', 'Hà Giang'], image: 'assets/public/images/hagiang/destination.webp', width: 1200, height: 1600, position: '50% 57%',
    alt: ['Terraced green mountains and a winding road in Hà Giang', 'Núi đồi xanh, ruộng bậc thang và con đường uốn lượn ở Hà Giang'],
    eyebrow: ['A LITTLE MORE ADVENTURE', 'THÊM MỘT CHÚT PHIÊU LƯU'],
    description: ['Mountain roads, terraced hillsides, and a whole new perspective.', 'Đường đèo, những sườn núi bậc thang và góc nhìn hoàn toàn mới.'],
    detail: ['Take the scenic route on your days off. Hà Giang’s mountain roads and terraced hillsides offer space to slow down and see another side of Vietnam. Talk to the team about teaching opportunities in your preferred region and making room for your own adventures.', 'Để những ngày nghỉ đưa bạn đến cung đường mới. Đường đèo và những sườn núi bậc thang ở Hà Giang mang đến không gian để sống chậm và khám phá một Việt Nam khác. Trao đổi với đội ngũ về công việc tại khu vực bạn yêu thích và dành thời gian cho hành trình của riêng mình.'],
  },
  hoian: {
    name: ['Hoi An', 'Hội An'], image: 'assets/public/images/hoian/destination.webp', width: 1200, height: 1600, position: '50% 48%',
    alt: ['A narrow Hội An alley with yellow walls, an archway and parked motorbikes', 'Ngõ nhỏ Hội An với tường vàng, mái vòm và những chiếc xe máy'],
    eyebrow: ['A LITTLE SLOWER LIVING', 'MỘT NHỊP SỐNG CHẬM HƠN'],
    description: ['Sunlit yellow walls, quiet little alleys, and time to take the scenic route.', 'Tường vàng trong nắng, những con ngõ nhỏ yên bình và thời gian để khám phá.'],
    detail: ['Let your days off take you somewhere different. Hoi An is a beautiful place to enjoy wandering streets, local food and a change of pace. Ask our team about fitting travel plans around your teaching schedule; this destination guide does not represent an available role in Hoi An.', 'Để ngày nghỉ đưa bạn đến một nơi mới. Hội An phù hợp cho những buổi dạo phố, thưởng thức món địa phương và sống chậm lại. Hỏi đội ngũ về cách sắp xếp chuyến đi quanh lịch dạy; giới thiệu điểm đến không đồng nghĩa có vị trí đang tuyển tại Hội An.'],
  },
  hanoi: {
    name: ['Ha Noi', 'Hà Nội'], image: 'assets/public/images/hanoi/destination.webp', width: 900, height: 1600, position: '50% 40%',
    alt: ['Colorful waterfront buildings and a tree-lined promenade in Hà Nội', 'Những tòa nhà nhiều màu bên mặt nước và lối đi rợp bóng cây ở Hà Nội'],
    eyebrow: ['A LITTLE CITY ENERGY', 'NHỊP SỐNG THÀNH PHỐ'],
    description: ['Colorful streets, waterside strolls, and another side of city life.', 'Phố xá nhiều màu, dạo bộ bên mặt nước và một sắc thái khác của cuộc sống thành thị.'],
    detail: ['Make the capital your starting point. Explore its neighborhood cafés, lakeside walks and lively streets between teaching days. Gary Agency’s office is in Hanoi, so you can connect with a local team as you plan your move.', 'Bắt đầu hành trình tại thủ đô. Khám phá quán cà phê, những con đường bên hồ và phố xá nhộn nhịp sau giờ dạy. Văn phòng Gary Agency ở Hà Nội, thuận tiện để bạn gặp đội ngũ địa phương khi lên kế hoạch chuyển đến.'],
  },
};

function renderPage() {
  photoGalleryMount?.unmount();
  photoGalleryMount = null;
  clearHeaderApps();
  document.documentElement.lang = state.lang;
  document.title = t('Gary Agency — Teach. Travel. Belong.', 'Gary Agency — Giảng dạy. Khám phá. Gắn kết.');
  $('.skip-link').textContent = t('Skip to content', 'Chuyển đến nội dung');
  $('#app').innerHTML = `
    <div class="announcement"><div class="container announcement-inner"><span>${icon('globe')} ${t('Your local connection to a world of opportunity.', 'Kết nối địa phương, mở ra cơ hội mới.')}</span><div class="announcement-links"><a href="#why-gary">${t('No placement fees. Ever.', 'Không phí giới thiệu việc làm.')} ${icon('arrow')}</a></div></div></div>
    <header class="site-header"><div class="container nav-wrap">${brand()}
      <nav class="desktop-nav" aria-label="${t('Main navigation', 'Điều hướng chính')}">
        <a href="#opportunities">${t('Teaching jobs', 'Việc giảng dạy')}</a><a href="#why-gary">${t('Why Gary', 'Vì sao chọn Gary')}</a><a href="#life">${t('Life in Vietnam', 'Sống ở Việt Nam')}</a><a href="#services">${t('Our support', 'Hỗ trợ')}</a>
      </nav>
      <div class="nav-actions"><div id="gary-apps-header" class="gary-apps-slot"></div><button class="language-button" data-action="language" aria-label="${t('Switch to Vietnamese', 'Chuyển sang tiếng Anh')}">${icon('globe')} <span>${state.lang.toUpperCase()}</span>${icon('chevron')}</button><button class="button button-small nav-cta" data-action="apply">${t('Let’s get started', 'Bắt đầu ngay')} ${arrow()}</button><button class="icon-button menu-toggle" data-action="menu" aria-expanded="false" aria-controls="mobile-nav" aria-label="${t('Open navigation', 'Mở điều hướng')}">${icon('menu')}</button></div>
    </div><nav id="mobile-nav" class="mobile-nav" hidden aria-label="${t('Mobile navigation', 'Điều hướng di động')}"><a href="#opportunities">${t('Teaching jobs', 'Việc giảng dạy')}</a><a href="#why-gary">${t('Why Gary', 'Vì sao chọn Gary')}</a><a href="#life">${t('Life in Vietnam', 'Sống ở Việt Nam')}</a><a href="#services">${t('Our support', 'Hỗ trợ')}</a><a href="#contact">${t('Contact us', 'Liên hệ')}</a><div id="gary-apps-mobile" class="mobile-app-services"></div><button class="button" data-action="apply">${t('Let’s get started', 'Bắt đầu ngay')} ${arrow()}</button></nav></header>
    <main id="main">
      <section class="hero container" aria-labelledby="hero-title">
        <div class="hero-copy"><div class="eyebrow"><span class="tiny-star">✦</span>${t('A NEW CHAPTER STARTS HERE', 'MỘT CHƯƠNG MỚI BẮT ĐẦU')}</div>
          <h1 id="hero-title">${t('Teach English.<br>Live a little <em>more.</em>', 'Dạy tiếng Anh.<br><em>Sống trọn vẹn.</em>')}</h1>
          <p class="hero-description">${t('Meaningful work. Unforgettable experiences. Find your teaching opportunity in Vietnam, with a local team by your side.', 'Công việc ý nghĩa. Trải nghiệm đáng nhớ. Tìm cơ hội giảng dạy tại Việt Nam với một đội ngũ địa phương luôn đồng hành.')}</p>
          <div class="hero-actions"><a class="button" href="#opportunities">${t('Find your teaching job', 'Tìm công việc giảng dạy')} ${arrow()}</a><a class="text-button" href="#how-it-works"><span class="play-icon">${icon('arrow')}</span>${t('How it works', 'Cách chúng tôi hỗ trợ')}</a></div>
          <div class="hero-human"><div class="avatar-stack"><img src="assets/community-1.webp" alt="" width="44" height="44"><img src="assets/community-2.webp" alt="" width="44" height="44"><img src="assets/community-5.webp" alt="" width="44" height="44"></div><p><strong>${t('Real people. A proper welcome.', 'Con người thật. Chào đón tận tâm.')}</strong><span>${t('Your people, before you even arrive.', 'Đồng hành từ trước khi bạn đến.')}</span></p></div>
        </div>
        <div class="hero-visual"><div class="hero-photo"><img src="assets/hero-vietnam.webp" alt="${t('A river winding through green rice fields and limestone mountains in Ninh Binh, Vietnam', 'Sông uốn lượn qua đồng lúa và núi đá vôi ở Ninh Bình, Việt Nam')}" width="1600" height="1067" fetchpriority="high"><div class="photo-location">${icon('pin')} Ninh Bình, Vietnam</div><div class="hero-photo-caption"><span>${t('YOUR NEXT CHAPTER', 'CHƯƠNG TIẾP THEO CỦA BẠN')}</span><p>${t('Looks good on you.', 'Thật xứng đáng với bạn.')}</p></div></div>
          <div class="hero-note"><span class="note-icon">${icon('cap')}</span><span><strong>${t('A career with a view.', 'Một sự nghiệp rộng mở.')}</strong><small>${t('A life with a little more possibility.', 'Cuộc sống với nhiều cơ hội hơn.')}</small></span>${icon('spark')}</div>
          <div class="adventure-stamp" aria-hidden="true"><svg viewBox="0 0 120 120"><defs><path id="circle-text" d="M60,60m-44,0a44,44 0 1,1 88,0a44,44 0 1,1 -88,0"/></defs><text><textPath href="#circle-text" startOffset="0%">TEACH · TRAVEL · BELONG · VIETNAM · </textPath></text><path d="M60 33q0 27 27 27-27 0-27 27 0-27-27-27 27 0 27-27Z"/></svg></div>
        </div>
      </section>
      <div class="container search-container"><form id="job-search" class="job-search" role="search" aria-label="${t('Search teaching jobs', 'Tìm việc giảng dạy')}"><div class="search-field keyword-field">${icon('search')}<label for="keyword"><span>${t('YOUR NEXT OPPORTUNITY', 'CƠ HỘI TIẾP THEO CỦA BẠN')}</span><input id="keyword" name="keyword" type="search" placeholder="${t('Job title or keyword', 'Chức danh hoặc từ khóa')}" value="${esc(state.keyword)}"></label></div><div class="search-field location-field">${icon('pin')}<label for="location"><span>${t('SOMEWHERE YOU’LL LOVE', 'NƠI BẠN MONG MUỐN')}</span><select name="location" id="location"><option value="all">${t('Anywhere in Vietnam', 'Toàn Việt Nam')}</option>${[['hanoi','Hà Nội'],['hai-phong','Hải Phòng'],['bac-giang','Bắc Giang'],['dong-nai','Đồng Nai'],['thai-nguyen','Thái Nguyên']].map(([value,label])=>`<option value="${value}" ${state.location === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>${icon('chevron')}</div><button class="button search-button" type="submit">${t('Find a job', 'Tìm công việc')} ${icon('arrow')}</button></form><div class="search-note">${icon('shield')} ${t('Always free for teachers. Always about finding your fit.', 'Luôn miễn phí cho giáo viên. Luôn tìm công việc phù hợp với bạn.')}</div></div>
      <section class="partner-section container" aria-label="${t('Our education partners', 'Đối tác giáo dục của chúng tôi')}"><span class="partner-caption">${t('GOOD PEOPLE.<br>GREAT CONNECTIONS.', 'ĐỐI TÁC TỐT.<br>KẾT NỐI BỀN VỮNG.')}</span><div class="partner-logos">${[['genius','Genius English School'],['elis','Elis Education'],['dreams','DreamsWorld Montessori'],['language','Language Link'],['ocb','OCB Education'],['au','A&U Language Institute']].map(([src,alt])=>`<img src="assets/partner-${src}.webp" alt="${alt}" loading="lazy" width="140" height="65">`).join('')}</div></section>
      <section id="opportunities" class="opportunities section-pad"><div class="container"><div class="section-heading"><div><p class="eyebrow">${t('GOOD WORK STARTS WITH A GOOD FIT', 'CÔNG VIỆC TỐT BẮT ĐẦU TỪ SỰ PHÙ HỢP')}</p><h2>${t('Find your kind of <em>classroom.</em>', 'Tìm lớp học <em>dành cho bạn.</em>')}</h2></div><p class="section-intro">${t('Big city or a change of pace?<br>There’s more than one way to teach in Vietnam.', 'Thành phố lớn hay một nhịp sống mới?<br>Có nhiều cách để giảng dạy tại Việt Nam.')}</p></div><div class="job-toolbar"><div class="job-tabs" role="group" aria-label="${t('Filter opportunities', 'Lọc cơ hội việc làm')}" id="job-tabs"></div><span id="job-count" class="job-count" aria-live="polite"></span></div><div id="active-filters"></div><div id="job-grid" class="job-grid"></div><div class="jobs-footer"><span>${icon('chat')}${t('Not sure where to start?', 'Bạn chưa biết bắt đầu từ đâu?')} <button class="inline-link" data-action="apply">${t('Let’s find your fit.', 'Cùng tìm việc phù hợp.')}</button></span><button id="more-jobs" class="text-button" data-action="more-jobs">${t('Explore all opportunities', 'Xem tất cả cơ hội')} ${icon('arrow')}</button></div><p class="listing-note">${t('Listings from Gary Agency. Your recruiter will confirm availability and the final offer.', 'Tin tuyển dụng từ Gary Agency. Chuyên viên sẽ xác nhận vị trí còn tuyển và đề nghị cuối cùng.')}</p></div></section>
      <section id="why-gary" class="why-section section-pad"><div class="container why-grid"><div class="why-visual"><div class="why-photo"><img src="assets/community-4.webp" alt="${t('Teachers and friends enjoying a boat trip in Vietnam', 'Giáo viên và bạn bè tận hưởng chuyến đi thuyền ở Việt Nam')}" loading="lazy" width="900" height="600"></div><div class="zero-card"><span>0<span>₫</span></span><div><strong>${t('Placement fees.', 'Phí giới thiệu.')}</strong><p>${t('All the possibility.<br>None of the commission.', 'Trọn vẹn cơ hội.<br>Không phí hoa hồng.')}</p></div>${icon('spark')}</div><span class="photo-footnote">${t('REAL MOMENTS FROM OUR COMMUNITY', 'KHOẢNH KHẮC THẬT TỪ CỘNG ĐỒNG')}</span></div><div class="why-copy"><p class="eyebrow">${t('A LITTLE LOCAL KNOWLEDGE GOES A LONG WAY', 'HIỂU ĐỊA PHƯƠNG, ĐỒNG HÀNH LÂU DÀI')}</p><h2>${t('A new country.<br>A familiar <em>feeling.</em>', 'Một đất nước mới.<br>Một cảm giác <em>thân quen.</em>')}</h2><p class="body-copy">${t('Moving abroad is a big step. We make the work part feel smaller. Gary Agency connects English teachers with schools across Vietnam, with real people to guide you along the way.', 'Chuyển đến một đất nước khác là bước đi lớn. Gary Agency giúp việc tìm công việc trở nên dễ dàng hơn, kết nối giáo viên tiếng Anh với trường học trên khắp Việt Nam và đồng hành trong hành trình của bạn.')}</p><div class="benefit-list">${[
        ['heart', ['Your next role, without the fees', 'Công việc mới, không phí giới thiệu'], ['Our job placement service is free for teachers. You focus on what comes next.', 'Dịch vụ giới thiệu việc làm miễn phí cho giáo viên. Bạn tập trung vào hành trình phía trước.']],
        ['people', ['A local team who gets it', 'Đội ngũ địa phương thấu hiểu'], ['Personal conversations and practical support, from the very first hello.', 'Trao đổi trực tiếp và hỗ trợ thiết thực, từ lời chào đầu tiên.']],
        ['globe', ['More places. More possibilities.', 'Nhiều điểm đến. Thêm cơ hội.'], ['Public schools, language centers and international schools. Let’s find your fit.', 'Trường công, trung tâm tiếng Anh và trường quốc tế. Cùng tìm nơi phù hợp với bạn.']],
      ].map(([symbol,title,desc])=>`<div class="benefit-row"><span class="benefit-icon">${icon(symbol)}</span><div><h3>${pick(title)}</h3><p>${pick(desc)}</p></div></div>`).join('')}</div></div></div></section>
      <section id="how-it-works" class="process-section"><div class="container"><div class="process-intro"><p class="eyebrow">${t('BIG MOVE. SIMPLE STEPS.', 'BƯỚC ĐI LỚN. KHỞI ĐẦU ĐƠN GIẢN.')}</p><h2>${t('From “what if” to <em>“I’m here.”</em>', 'Từ “nếu như” đến <em>“mình đã đến.”</em>')}</h2></div><div class="process-grid">${[
        [['Tell us your story', 'Chia sẻ câu chuyện của bạn'], ['Your experience, your goals, your kind of place. We start by getting to know you.', 'Kinh nghiệm, mục tiêu và nơi bạn yêu thích. Chúng tôi bắt đầu bằng việc hiểu bạn.']],
        [['Find your right fit', 'Tìm công việc phù hợp'], ['Explore roles together, meet the school, and ask all the questions that matter.', 'Cùng khám phá công việc, gặp nhà trường và giải đáp những điều bạn quan tâm.']],
        [['Start your next chapter', 'Bắt đầu chương mới'], ['Get support with the next steps, so you can arrive ready for your first day.', 'Nhận hỗ trợ cho các bước tiếp theo để sẵn sàng cho ngày đầu tiên.']],
      ].map(([title,desc],i)=>`<div class="process-step"><span class="step-number">0${i+1}</span><div><h3>${pick(title)}</h3><p>${pick(desc)}</p></div>${i<2?icon('arrow'):icon('spark')}</div>`).join('')}</div></div></section>
      <section id="life" class="life-section section-pad"><div class="container"><div class="section-heading"><div><p class="eyebrow">${t('THERE’S A WHOLE LIFE BEYOND THE CLASSROOM', 'CÒN CẢ MỘT CUỘC SỐNG BÊN NGOÀI LỚP HỌC')}</p><h2>${t('Make a living.<br>Make a little <em>more of life.</em>', 'Tạo dựng sự nghiệp.<br>Thêm sắc màu <em>cho cuộc sống.</em>')}</h2></div><p class="section-intro">${t('New routines. Unexpected friendships.<br>Weekends that feel like a world away.<br>This is your invitation to explore.', 'Thói quen mới. Tình bạn bất ngờ.<br>Cuối tuần với những hành trình khác biệt.<br>Mời bạn cùng khám phá.')}</p></div><div id="photo-gallery"></div><div class="life-bottom">${icon('sun')}<p>${t('Come for the teaching. Stay for everything else.', 'Đến vì giảng dạy. Gắn bó vì tất cả những điều còn lại.')}</p><span class="handwritten">${t('That’s the Vietnam feeling.', 'Đó là cảm giác Việt Nam.')}</span></div></div></section>
      <section id="services" class="support-section section-pad"><div class="container"><div class="section-heading"><div><p class="eyebrow">${t('YOUR LANDING, A LITTLE SOFTER', 'ĐỂ KHỞI ĐẦU NHẸ NHÀNG HƠN')}</p><h2>${t('More than a <em>job match.</em>', 'Hơn cả một <em>công việc.</em>')}</h2></div><p class="section-intro">${t('A new home comes with a few moving parts.<br>We’re here to help you put them together.', 'Một cuộc sống mới có nhiều điều cần sắp xếp.<br>Chúng tôi ở đây để hỗ trợ bạn.')}</p></div><div class="support-grid">${[
        ['documents','document',['Paperwork, made clearer', 'Giấy tờ, rõ ràng hơn'],['Work permits, visas, temporary residence cards and document services. Get a clearer picture of your next steps.', 'Giấy phép lao động, visa, thẻ tạm trú và dịch vụ giấy tờ. Hiểu rõ hơn các bước bạn cần thực hiện.'],['Explore document support','Khám phá hỗ trợ giấy tờ']],
        ['housing','home',['A place to call home', 'Một nơi để gọi là nhà'],['From a studio of your own to room for a bigger adventure. Explore rental support as you settle into Hanoi.', 'Từ studio riêng đến không gian cho hành trình lớn hơn. Khám phá hỗ trợ thuê nhà khi đến Hà Nội.'],['Find your space','Tìm không gian của bạn']],
        ['settling','chat',['Someone in your corner', 'Luôn có người đồng hành'],['Questions before the move? A little help after you arrive? It starts with a conversation with our local team.', 'Băn khoăn trước khi chuyển đến? Cần giúp đỡ khi đã đến nơi? Bắt đầu bằng cuộc trò chuyện với đội ngũ địa phương.'],['Meet your local support','Kết nối đội ngũ hỗ trợ']],
      ].map(([id,symbol,title,desc,cta])=>`<article class="support-card"><button class="support-card-main" data-action="service" data-id="${id}"><span class="support-icon">${icon(symbol)}</span><h3>${pick(title)}</h3><p>${pick(desc)}</p><span class="support-cta">${pick(cta)} ${arrow()}</span></button>${serviceSites[id] ? serviceSiteLink(id, 'support-site-link') : ''}</article>`).join('')}</div></div></section>
      <section class="community-section"><div class="container community-top"><div><p class="eyebrow">${t('TEACHERS. TRAVELERS. YOUR PEOPLE.', 'GIÁO VIÊN. NGƯỜI KHÁM PHÁ. CỘNG ĐỒNG CỦA BẠN.')}</p><h2>${t('A place to <em>belong.</em>', 'Một nơi để <em>gắn kết.</em>')}</h2></div><a class="text-button" href="https://www.facebook.com/vnenglishteachingjobs/" target="_blank" rel="noopener noreferrer">${t('Meet the community', 'Gặp gỡ cộng đồng')} ${arrow()}</a></div><div class="community-gallery container">${[5,1,4,2,3].map((n,i)=>`<figure><img src="assets/community-${n}.webp" alt="${pick([['Gary Agency community members sharing a meal', 'Thành viên cộng đồng Gary Agency dùng bữa cùng nhau'],['Teachers visiting an agency partner', 'Giáo viên gặp gỡ đối tác'],['Friends exploring Vietnam by boat', 'Bạn bè khám phá Việt Nam bằng thuyền'],['A teacher and agency partner', 'Giáo viên và đối tác'],['Gary Agency community gathering', 'Buổi gặp mặt cộng đồng Gary Agency']][i])}" loading="lazy" width="600" height="600"></figure>`).join('')}</div><div class="container community-bottom"><span>${icon('heart')}${t('Real moments. Real connections. A life of your own.', 'Khoảnh khắc thật. Kết nối thật. Cuộc sống của riêng bạn.')}</span><a class="inline-link" href="https://www.facebook.com/vnenglishteachingjobs/" target="_blank" rel="noopener noreferrer">@vnenglishteachingjobs ${arrow()}</a></div></section>
      <section id="questions" class="faq-section section-pad"><div class="container faq-grid"><div><p class="eyebrow">${t('A FEW THINGS YOU MIGHT BE WONDERING', 'MỘT VÀI ĐIỀU BẠN CÓ THỂ MUỐN BIẾT')}</p><h2>${t('Big questions.<br><em>Straight answers.</em>', 'Câu hỏi lớn.<br><em>Giải đáp rõ ràng.</em>')}</h2><p class="body-copy">${t('Still have something on your mind?<br>We’re just a conversation away.', 'Vẫn còn điều bạn muốn hỏi?<br>Chúng tôi luôn sẵn lòng trò chuyện.')}</p><button class="text-button" data-action="contact">${t('Ask our team', 'Hỏi đội ngũ của chúng tôi')} ${arrow()}</button></div><div class="faq-list">${[
        [['Is there a fee to find a teaching job?', 'Tìm việc giảng dạy có mất phí không?'], ['No. Gary Agency does not charge teachers a commission or job placement fee. Separate services, such as visas, document processing or housing, may have their own costs. Ask your recruiter for the details before you commit.', 'Không. Gary Agency không thu hoa hồng hoặc phí giới thiệu việc làm của giáo viên. Các dịch vụ riêng như visa, xử lý giấy tờ hoặc nhà ở có thể có chi phí riêng. Hãy hỏi chuyên viên chi tiết trước khi quyết định.']],
        [['What qualifications will I need?', 'Tôi cần những bằng cấp gì?'], ['Requirements vary by school and role. Many published listings ask for a bachelor’s degree, a TEFL, TESOL or CELTA teaching certificate, and a short introduction video. Some roles have additional language or applicant requirements. Every role’s details are available in its listing.', 'Yêu cầu tùy thuộc trường và vị trí. Nhiều tin yêu cầu bằng cử nhân, chứng chỉ TEFL, TESOL hoặc CELTA và video giới thiệu ngắn. Một số vị trí có điều kiện bổ sung về ngôn ngữ hoặc ứng viên. Xem chi tiết trong từng tin.']],
        [['Can I apply before moving to Vietnam?', 'Tôi có thể ứng tuyển trước khi đến Việt Nam không?'], ['Tell the team where you are now and when you plan to arrive. Eligibility and start dates depend on the position; some schools prioritize teachers already in Vietnam. Your recruiter can help identify which roles fit your timing.', 'Hãy cho đội ngũ biết bạn đang ở đâu và dự định đến khi nào. Điều kiện và ngày bắt đầu tùy vị trí; một số trường ưu tiên giáo viên đã ở Việt Nam. Chuyên viên sẽ hỗ trợ tìm vị trí phù hợp với thời gian của bạn.']],
        [['Can you help with visas and accommodation?', 'Có hỗ trợ visa và chỗ ở không?'], ['Gary Agency offers document services and rental assistance. Some teaching roles also include work permit or housing support from the school. The level of support and costs vary, so confirm the specific terms with the team.', 'Gary Agency có dịch vụ giấy tờ và hỗ trợ thuê nhà. Một số vị trí còn được nhà trường hỗ trợ giấy phép lao động hoặc chỗ ở. Mức hỗ trợ và chi phí khác nhau; vui lòng xác nhận cụ thể với đội ngũ.']],
        [['How do I start my application?', 'Tôi bắt đầu ứng tuyển như thế nào?'], ['Choose a role and select “Apply for this role,” or use “Let’s get started” for a general introduction. The form prepares an email in your email app. Attach your CV, degree, teaching certificate and introduction video before you send it.', 'Chọn công việc và bấm “Ứng tuyển vị trí này”, hoặc “Bắt đầu ngay” để giới thiệu chung. Biểu mẫu chuẩn bị email trong ứng dụng của bạn. Đính kèm CV, bằng cấp, chứng chỉ giảng dạy và video giới thiệu trước khi gửi.']],
      ].map(([q,a],i)=>`<details class="faq-item"><summary><span>${pick(q)}</span><span class="faq-plus" aria-hidden="true">+</span></summary><p>${pick(a)}</p></details>`).join('')}</div></div></section>
      <section class="final-cta"><div class="container cta-inner"><div class="cta-decoration" aria-hidden="true">${icon('spark')}</div><p class="eyebrow">${t('A NEW JOB. A NEW COUNTRY. A NEW CHAPTER.', 'CÔNG VIỆC MỚI. ĐẤT NƯỚC MỚI. CHƯƠNG MỚI.')}</p><h2>${t('Your next chapter<br>looks good <em>from here.</em>', 'Chương mới của bạn<br>đang chờ <em>phía trước.</em>')}</h2><p>${t('Bring your curiosity. We’ll help with the next step.', 'Mang theo sự tò mò. Chúng tôi đồng hành ở bước tiếp theo.')}</p><button class="button button-light" data-action="apply">${t('Let’s find your place', 'Cùng tìm nơi dành cho bạn')} ${arrow()}</button><span class="cta-footnote">${icon('check')}${t('No placement fees. Just possibilities.', 'Không phí giới thiệu. Trọn vẹn cơ hội.')}</span></div></section>
    </main>
    <footer id="contact" class="site-footer"><div class="container"><div class="footer-main"><div class="footer-brand"><p>${t('Good work. Great adventures.<br>A little more life in Vietnam.', 'Công việc tốt. Hành trình tuyệt vời.<br>Cuộc sống trọn vẹn hơn ở Việt Nam.')}</p><div class="footer-social"><a href="https://www.facebook.com/vnenglishteachingjobs/" target="_blank" rel="noopener noreferrer" aria-label="Gary Agency on Facebook">${icon('facebook')}</a><a href="https://zalo.me/84356175046" target="_blank" rel="noopener noreferrer" aria-label="Gary Agency on Zalo"><span class="zalo-word">Zalo</span></a><a href="mailto:thuyylingg2107@gmail.com" aria-label="${t('Email Gary Agency', 'Gửi email đến Gary Agency')}">${icon('mail')}</a></div></div><div class="footer-column"><h3>${t('Your next chapter', 'Chương tiếp theo')}</h3><a href="#opportunities">${t('Find a teaching job', 'Tìm việc giảng dạy')}</a><a href="#why-gary">${t('Why Gary Agency', 'Vì sao chọn Gary Agency')}</a><a href="#life">${t('Explore Vietnam', 'Khám phá Việt Nam')}</a><a href="#services">${t('Our support', 'Hỗ trợ của chúng tôi')}</a></div><div class="footer-column"><h3>${t('Let’s talk', 'Cùng trò chuyện')}</h3><a href="tel:+84356175046">+84 356 175 046</a><a href="tel:+84977654134">+84 977 654 134</a><button class="footer-link" data-action="contact">${t('Say hello to the team', 'Chào đội ngũ Gary')} ${arrow()}</button><span class="office-note">${t('Based in Hanoi. Here for you.', 'Tại Hà Nội. Luôn bên bạn.')}</span></div><div class="footer-column footer-office"><h3>${t('Find us in Hanoi', 'Gặp chúng tôi tại Hà Nội')}</h3><p>${t('Eurowindow Building<br>27 Trần Duy Hưng, Trung Hòa<br>Cầu Giấy, Hanoi, Vietnam', 'Tòa nhà Eurowindow<br>27 Trần Duy Hưng, Trung Hòa<br>Cầu Giấy, Hà Nội, Việt Nam')}</p><a class="map-link" href="https://www.google.com/maps/search/?api=1&query=Eurowindow+27+Tran+Duy+Hung+Hanoi" target="_blank" rel="noopener noreferrer">${t('Get directions', 'Chỉ đường')} ${arrow()}</a></div></div><div class="footer-bottom"><span>© ${new Date().getFullYear()} Gary Agency · G-CONNECT VIETNAM</span><div><button data-action="privacy">${t('Privacy', 'Quyền riêng tư')}</button><a href="https://garyagency.com/hotel-term-condition/" target="_blank" rel="noopener noreferrer">${t('Terms & conditions', 'Điều khoản & điều kiện')}</a><a href="#">${t('Back to top', 'Về đầu trang')} ↑</a></div></div></div></footer>
    <button class="floating-contact" data-action="contact" aria-label="${t('Talk to Gary Agency', 'Trò chuyện với Gary Agency')}">${icon('chat')}<span>${t('Let’s talk', 'Trò chuyện')}</span><i></i></button>`;
  renderJobs();
  observeNavigation();
  mountHeaderApps();
  photoGalleryMount = mountPhotoGallery($('#photo-gallery'), { locale: state.lang, onExploreRegion: openDestination });
}

function filteredJobs() {
  const normalize = str => str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/đ/g,'d');
  const query = normalize(state.keyword.trim());
  return jobs.filter(job => (state.location === 'all' || job.region === state.location)
    && (state.category === 'all' || job.category === state.category || state.category === 'saved' && state.saved.has(job.id))
    && (!query || normalize(`${job.title.join(' ')} ${job.type.join(' ')} ${job.location} English teacher teaching full time tieng Anh giao vien ${job.benefit.join(' ')}`).includes(query)));
}

function renderJobs() {
  const results = filteredJobs();
  const visible = state.expanded ? results : results.slice(0,3);
  const labels = [['all', t('All opportunities','Tất cả cơ hội')], ['public',t('Public schools','Trường công lập')], ['centers',t('Language centers','Trung tâm tiếng Anh')], ['saved', `${icon('bookmark')} ${t('Saved','Đã lưu')} <span>${state.saved.size}</span>`]];
  $('#job-tabs').innerHTML = labels.map(([id,label])=>`<button data-action="filter" data-id="${id}" class="job-tab ${state.category===id?'is-active':''}" aria-pressed="${state.category===id}">${label}</button>`).join('');
  $('#job-count').textContent = t(`${results.length} ${results.length === 1 ? 'opportunity' : 'opportunities'} to explore`, `${results.length} cơ hội để khám phá`);
  $('#active-filters').innerHTML = state.keyword || state.location !== 'all' ? `<div class="active-filter"><span>${t('Your search', 'Tìm kiếm')}: <strong>${esc(state.keyword || t('All roles', 'Tất cả vị trí'))}</strong>${state.location !== 'all' ? ` · ${esc(jobs.find(j=>j.region===state.location)?.location || '')}` : ''}</span><button data-action="clear-search">${t('Clear search', 'Xóa tìm kiếm')} ${icon('close')}</button></div>` : '';
  $('#job-grid').innerHTML = visible.length ? visible.map(job=>`<article class="job-card"><div class="job-card-top"><span class="job-school-icon ${job.color}">${icon(job.icon)}</span><button class="icon-button save-job ${state.saved.has(job.id)?'is-saved':''}" data-action="save" data-id="${job.id}" aria-pressed="${state.saved.has(job.id)}" aria-label="${state.saved.has(job.id)?t('Unsave','Bỏ lưu'):t('Save','Lưu')} ${esc(pick(job.title))} · ${job.location}">${icon('bookmark')}</button></div><div class="job-location">${icon('pin')} ${job.location}</div><h3><button data-action="job" data-id="${job.id}">${pick(job.title)}</button></h3><p class="job-type">${pick(job.type)}</p><div class="job-tags"><span>${icon('clock')}${job.hours} ${t('hrs / month','giờ / tháng')}</span><span>${t('Full-time','Toàn thời gian')}</span></div><div class="job-benefit">${icon('check')} ${pick(job.benefit)}</div><div class="job-card-bottom"><div><span>${t('Salary','Mức lương')}</span><strong>${t('Let’s discuss','Thỏa thuận')}</strong></div><button class="round-arrow" data-action="job" data-id="${job.id}" aria-label="${t('View role in','Xem vị trí ở')} ${job.location}">${arrow()}</button></div></article>`).join('') : `<div class="empty-state">${icon(state.category==='saved'?'bookmark':'search')}<h3>${state.category==='saved'?t('Your next chapter is waiting.','Chương tiếp theo đang chờ bạn.'):t('Let’s widen the search.','Cùng mở rộng tìm kiếm.')}</h3><p>${state.category==='saved'?t('Tap the bookmark on a role to keep it here.','Bấm biểu tượng lưu trên công việc để lưu tại đây.'):t('No roles match these filters. Try another location or tell our team what you’re looking for.','Không có công việc phù hợp bộ lọc. Thử nơi khác hoặc chia sẻ mong muốn với đội ngũ.')}</p><button class="button" data-action="reset-jobs">${t('See all opportunities','Xem tất cả cơ hội')} ${icon('arrow')}</button></div>`;
  const more = $('#more-jobs');
  more.hidden = results.length <= 3;
  more.innerHTML = `${state.expanded?t('Show fewer opportunities','Thu gọn danh sách'):t(`Explore all ${results.length} opportunities`,`Xem cả ${results.length} cơ hội`)} ${icon(state.expanded?'chevron':'arrow')}`;
}

let navigationObserver;
function observeNavigation() {
  navigationObserver?.disconnect();
  navigationObserver = new IntersectionObserver(entries=>{
    entries.forEach(entry=>{
      if(entry.isIntersecting) {
        $$('.desktop-nav a').forEach(a=>a.classList.toggle('current', a.getAttribute('href') === `#${entry.target.id}`));
      }
    });
  },{rootMargin:'-20% 0px -55% 0px'});
  ['opportunities','why-gary','life','services'].forEach(id=>navigationObserver.observe(document.getElementById(id)));
}

let toastTimer;
function toast(message) {
  const el=$('#toast');el.innerHTML=`${icon('check')}<span>${esc(message)}</span>`;el.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('visible'),3000);
}

let dialogOpener;
function openDialog(content) {
  const dialog=$('#detail-dialog');
  if(!dialog.open) dialogOpener=document.activeElement;
  $('#dialog-content').innerHTML=content;
  $('.dialog-close').setAttribute('aria-label',t('Close dialog','Đóng hộp thoại'));
  if(!dialog.open)dialog.showModal();
  document.body.classList.add('dialog-open');dialog.scrollTop=0;
  requestAnimationFrame(()=>$('.dialog-close').focus({preventScroll:true}));
}
function closeDialog() { $('#detail-dialog').close(); }

function openDestination(id) {
  const d=destinations[id];if(!d)return;openDialog(`<div class="destination-dialog-photo"><img src="${d.image}" alt="${pick(d.alt)}" width="${d.width}" height="${d.height}" style="object-position:${d.position}"></div><p class="eyebrow">${pick(d.eyebrow)}</p><h2 id="dialog-title">${pick(d.name)}<em>, Vietnam.</em></h2><p class="dialog-intro">${pick(d.detail)}</p><button class="button" data-action="destination-jobs" data-id="${id}">${t('Explore teaching opportunities','Khám phá cơ hội giảng dạy')} ${arrow()}</button>`);
}

function openJob(id) {
  const job=jobs.find(j=>j.id===id);if(!job)return;
  const date=new Intl.DateTimeFormat(state.lang==='vi'?'vi-VN':'en-GB',{day:'numeric',month:'short',year:'numeric'}).format(new Date(`${job.date}T12:00:00Z`));
  openDialog(`<div class="dialog-job-head"><span class="eyebrow">${pick(job.type)}</span><h2 id="dialog-title">${pick(job.title)}</h2><div class="dialog-location">${icon('pin')}${job.location} <span>· ${t('Posted','Đăng')} ${date}</span></div></div><p class="dialog-intro">${pick(job.intro)}</p><div class="role-facts"><div>${icon('clock')}<span>${t('Teaching hours','Giờ giảng dạy')}<strong>${job.hours} ${t('hours / month','giờ / tháng')}</strong></span></div><div>${icon('briefcase')}<span>${t('Contract type','Hình thức')}<strong>${t('Full-time','Toàn thời gian')}</strong></span></div><div>${icon('people')}<span>${t('Students','Học sinh')}<strong>${job.age?(Array.isArray(job.age)?pick(job.age):`${job.age} ${t('years old','tuổi')}`):t('Public school learners','Học sinh trường công')}</strong></span></div><div>${icon('shield')}<span>${t('Support','Hỗ trợ')}<strong>${pick(job.benefit)}</strong></span></div></div><h3>${t('What you’ll need','Yêu cầu ứng tuyển')}</h3><ul class="check-list">${job.requirements.map(r=>`<li>${icon('check')}<span>${pick(r)}</span></li>`).join('')}</ul><div class="role-note">${icon('document')}<p>${pick(job.notes)}</p></div><div class="dialog-actions"><button class="button" data-action="apply" data-id="${job.id}">${t('Apply for this role','Ứng tuyển vị trí này')} ${arrow()}</button><a class="text-button" href="${job.source}" target="_blank" rel="noopener noreferrer">${t('Original listing','Tin tuyển dụng gốc')} ${arrow()}</a></div><p class="dialog-small">${t('Placement is free for teachers. Availability and terms are confirmed by the recruiter.','Dịch vụ giới thiệu miễn phí cho giáo viên. Chuyên viên xác nhận vị trí còn tuyển và điều kiện.')}</p>`);
}

function openApplication(id, subject) {
  const job=jobs.find(j=>j.id===id);
  const role=job?`${pick(job.title)} — ${job.location}`:subject || t('My next chapter in Vietnam','Chương mới của tôi ở Việt Nam');
  openDialog(`<p class="eyebrow">${t('LET’S GET TO KNOW YOU','CÙNG LÀM QUEN')}</p><h2 id="dialog-title">${t('Your story starts <em>here.</em>','Câu chuyện bắt đầu <em>từ đây.</em>')}</h2><p class="dialog-intro">${t('A few details and a little about what you’re looking for. We’ll prepare an email for you to send to our team.','Chia sẻ một vài thông tin và mong muốn. Chúng tôi sẽ chuẩn bị email để bạn gửi đến đội ngũ.')}</p><form id="application-form" data-job="${esc(job?.id || '')}"><input type="hidden" name="subject" value="${esc(role)}"><div class="application-role">${icon(job?'briefcase':'chat')}<span>${esc(role)}</span></div><div class="form-grid"><label>${t('Your full name','Họ và tên')} <span>*</span><input name="name" autocomplete="name" required maxlength="100" placeholder="${t('e.g. Alex Taylor','Ví dụ: Nguyễn Minh Anh')}"></label><label>${t('Email address','Địa chỉ email')} <span>*</span><input name="email" type="email" autocomplete="email" required maxlength="160" placeholder="you@example.com"></label><label>${t('Phone / WhatsApp','Số điện thoại / WhatsApp')}<input name="phone" type="tel" autocomplete="tel" maxlength="60" placeholder="+84…"></label><label>${t('Where are you now?','Bạn đang ở đâu?')}<select name="current-location"><option>${t('I’m already in Vietnam','Tôi đang ở Việt Nam')}</option><option>${t('I’m planning my move','Tôi đang lên kế hoạch chuyển đến')}</option><option>${t('I’m exploring my options','Tôi đang tìm hiểu cơ hội')}</option></select></label></div><label class="form-message">${t('Tell us a little about yourself','Chia sẻ một chút về bạn')}<textarea name="message" rows="4" maxlength="2500" placeholder="${t('Your teaching experience, qualifications, preferred location or any questions…','Kinh nghiệm, bằng cấp, nơi muốn làm việc hoặc câu hỏi của bạn…')}"></textarea></label><div class="application-note">${icon('document')}<p>${t('This opens a draft in your email app. Attach your CV, degree, teaching certificate and introduction video before sending. Nothing is submitted by this form.','Biểu mẫu mở bản nháp trong ứng dụng email. Đính kèm CV, bằng cấp, chứng chỉ và video giới thiệu trước khi gửi. Biểu mẫu không tự gửi thông tin.')}</p></div><button class="button form-submit" type="submit">${t('Prepare my email','Chuẩn bị email của tôi')} ${icon('mail')}</button><div id="email-fallback" class="email-fallback" hidden></div><p class="dialog-small">${t('Prefer to chat?','Muốn trò chuyện trực tiếp?')} <a href="https://zalo.me/84356175046" target="_blank" rel="noopener noreferrer">${t('Say hello on Zalo','Liên hệ trên Zalo')} ${arrow()}</a></p></form>`);
}

function openService(id) {
  const data={
    documents:{icon:'document',title:['Paperwork, made clearer.','Giấy tờ, rõ ràng hơn.'],intro:['Get help understanding which document services you may need for your next chapter. The team can discuss your situation and the services available.','Tìm hiểu những dịch vụ giấy tờ có thể cần cho hành trình mới. Đội ngũ sẽ trao đổi tình huống cụ thể và dịch vụ phù hợp.'],items:[['Work permits and temporary residence cards','Giấy phép lao động và thẻ tạm trú'],['Visa and entry document services','Dịch vụ visa và giấy tờ nhập cảnh'],['Consular legalization and notarized translation','Hợp pháp hóa lãnh sự và dịch thuật công chứng'],['Criminal record document support','Hỗ trợ giấy tờ lý lịch tư pháp']]},
    housing:{icon:'home',title:['A space that feels like you.','Không gian mang dấu ấn của bạn.'],intro:['Explore rental assistance in Hanoi, from studios to one-bedroom and larger apartments. Tell the team your budget, preferred neighborhood and move-in date.','Khám phá hỗ trợ thuê nhà tại Hà Nội, từ studio đến căn hộ một phòng ngủ và căn hộ lớn hơn. Chia sẻ ngân sách, khu vực yêu thích và ngày dự định chuyển đến.'],items:[['Studios and one-bedroom apartments','Studio và căn hộ một phòng ngủ'],['Larger apartments for couples or friends','Căn hộ lớn cho cặp đôi hoặc nhóm bạn'],['Help discussing your preferred neighborhood','Trao đổi về khu vực bạn mong muốn'],['Current availability and costs confirmed by the team','Đội ngũ xác nhận tình trạng và chi phí hiện tại']]},
    settling:{icon:'chat',title:['A familiar voice in a new place.','Một giọng nói thân quen ở nơi mới.'],intro:['From your first question to the next step in your teaching journey, start with a conversation. Our Hanoi-based team can discuss teaching opportunities and direct you to the support that fits.','Từ câu hỏi đầu tiên đến bước tiếp theo trong hành trình giảng dạy, hãy bắt đầu bằng cuộc trò chuyện. Đội ngũ tại Hà Nội sẽ trao đổi cơ hội và hướng dẫn hỗ trợ phù hợp.'],items:[['Talk through your teaching goals','Trao đổi mục tiêu giảng dạy'],['Understand a role’s requirements and benefits','Hiểu yêu cầu và quyền lợi của vị trí'],['Discuss timing and your move to Vietnam','Thảo luận thời gian chuyển đến Việt Nam'],['Ask about document and rental services','Hỏi về dịch vụ giấy tờ và thuê nhà']]},
  }[id];if(!data)return;
  openDialog(`<span class="dialog-service-icon">${icon(data.icon)}</span><h2 id="dialog-title">${pick(data.title)}</h2><p class="dialog-intro">${pick(data.intro)}</p><ul class="check-list">${data.items.map(item=>`<li>${icon('check')}<span>${pick(item)}</span></li>`).join('')}</ul><p class="role-note">${t('Service availability, eligibility and fees depend on your circumstances. The team will confirm the scope and costs before you decide.','Dịch vụ, điều kiện và chi phí tùy trường hợp. Đội ngũ sẽ xác nhận phạm vi và chi phí trước khi bạn quyết định.')}</p><div class="dialog-actions"><button class="button" data-action="service-enquiry" data-id="${id}">${t('Talk to the team','Trao đổi với đội ngũ')} ${arrow()}</button>${serviceSites[id] ? serviceSiteLink(id, 'text-button') : ''}</div>`);
}

function openContact() {
  openDialog(`<p class="eyebrow">${t('REAL PEOPLE. RIGHT HERE.','CON NGƯỜI THẬT. LUÔN Ở ĐÂY.')}</p><h2 id="dialog-title">${t('Let’s say <em>hello.</em>','Cùng nói lời <em>chào.</em>')}</h2><p class="dialog-intro">${t('A teaching question, a big idea, or a little help with what comes next. Pick the way that suits you.','Câu hỏi giảng dạy, một ý tưởng mới hay hỗ trợ cho bước tiếp theo. Chọn cách liên hệ phù hợp với bạn.')}</p><div class="contact-options"><a href="tel:+84356175046">${icon('phone')}<span><small>${t('Give us a call','Gọi cho chúng tôi')}</small><strong>+84 356 175 046</strong></span>${arrow()}</a><a href="https://zalo.me/84356175046" target="_blank" rel="noopener noreferrer">${icon('chat')}<span><small>${t('Start a conversation','Bắt đầu trò chuyện')}</small><strong>${t('Chat on Zalo','Trò chuyện trên Zalo')}</strong></span>${arrow()}</a><button data-action="contact-email">${icon('mail')}<span><small>${t('Tell us your story','Chia sẻ câu chuyện của bạn')}</small><strong>${t('Write to our team','Viết cho đội ngũ')}</strong></span>${arrow()}</button></div><p class="dialog-small">${t('Visit us at Eurowindow Building, 27 Trần Duy Hưng, Hanoi.','Ghé thăm tại tòa nhà Eurowindow, 27 Trần Duy Hưng, Hà Nội.')}</p>`);
}

function toggleMenu(force) {
  const nav=$('#mobile-nav');if(!nav)return;
  const open=typeof force==='boolean'?force:nav.hidden;
  nav.hidden=!open;$('.menu-toggle').setAttribute('aria-expanded',String(open));$('.menu-toggle').setAttribute('aria-label',open?t('Close navigation','Đóng điều hướng'):t('Open navigation','Mở điều hướng'));$('.menu-toggle').innerHTML=icon(open?'close':'menu');
}

document.addEventListener('click',event=>{
  const control=event.target.closest('[data-action]');
  if(!control){if(event.target.closest('#mobile-nav a'))toggleMenu(false);return;}
  const {action,id}=control.dataset;
  if(action==='language'){const y=window.scrollY;state.lang=state.lang==='en'?'vi':'en';persist('gary-language',state.lang);renderPage();window.scrollTo({top:y,behavior:'instant'});$('.language-button').focus({preventScroll:true});}
  if(action==='menu')toggleMenu();
  if(action==='filter'){state.category=id;state.expanded=false;renderJobs();$(`[data-action="filter"][data-id="${id}"]`).focus({preventScroll:true});}
  if(action==='save'){if(state.saved.has(id))state.saved.delete(id);else state.saved.add(id);persist('gary-saved-jobs',[...state.saved]);renderJobs();$(`[data-action="save"][data-id="${id}"]`)?.focus({preventScroll:true});toast(state.saved.has(id)?t('Saved for your next chapter.','Đã lưu cho chương tiếp theo.'):t('Opportunity removed from saved.','Đã bỏ lưu cơ hội.'));}
  if(action==='more-jobs'){state.expanded=!state.expanded;renderJobs();if(!state.expanded)$('#opportunities').scrollIntoView({behavior:'smooth'});}
  if(action==='clear-search'||action==='reset-jobs'){state.keyword='';state.location='all';if(action==='reset-jobs')state.category='all';state.expanded=false;$('#keyword').value='';$('#location').value='all';renderJobs();}
  if(action==='job')openJob(id);
  if(action==='apply'){toggleMenu(false);openApplication(id);}
  if(action==='close-dialog')closeDialog();
  if(action==='destination')openDestination(id);
  if(action==='destination-jobs'){closeDialog();state.location=id==='hanoi'?'hanoi':'all';state.category='all';state.keyword='';state.expanded=true;$('#keyword').value='';$('#location').value=state.location;renderJobs();$('#opportunities').scrollIntoView({behavior:'smooth'});}
  if(action==='service')openService(id);
  if(action==='service-enquiry')openApplication(null,t(`Enquiry: ${id==='documents'?'Document support':id==='housing'?'Rental assistance':'Local support'}`,`Yêu cầu: ${id==='documents'?'Hỗ trợ giấy tờ':id==='housing'?'Hỗ trợ thuê nhà':'Hỗ trợ địa phương'}`));
  if(action==='contact')openContact();
  if(action==='contact-email')openApplication(null,t('Hello Gary Agency','Xin chào Gary Agency'));
  if(action==='privacy')openDialog(`<p class="eyebrow">${t('YOUR INFORMATION','THÔNG TIN CỦA BẠN')}</p><h2 id="dialog-title">${t('A little about <em>privacy.</em>','Một chút về <em>quyền riêng tư.</em>')}</h2><p class="dialog-intro">${t('This site remembers your language preference and saved jobs on this device. It does not send application form entries to a server. Selecting “Prepare my email” opens a draft using your email app; you decide whether to send it.','Trang này lưu lựa chọn ngôn ngữ và mã công việc đã lưu trong trình duyệt. Nội dung biểu mẫu không được gửi đến máy chủ. “Chuẩn bị email của tôi” mở bản nháp trong ứng dụng email; bạn quyết định có gửi hay không.')}</p><p class="body-copy">${t('Contact links take you to third-party services such as Facebook, Zalo, Google Maps or your email provider. Their own privacy policies apply. You can clear locally saved preferences using the button below.','Liên kết liên hệ mở dịch vụ bên thứ ba như Facebook, Zalo, Google Maps hoặc nhà cung cấp email. Các dịch vụ áp dụng chính sách riêng. Bạn có thể xóa lựa chọn được lưu trên trình duyệt bằng nút bên dưới.')}</p><button class="button" data-action="clear-data">${t('Clear saved preferences','Xóa dữ liệu đã lưu')} ${icon('arrow')}</button>`);
  if(action==='clear-data'){try{localStorage.removeItem('gary-language');localStorage.removeItem('gary-saved-jobs');}catch{}state.saved.clear();renderJobs();toast(t('Saved browser preferences cleared.','Đã xóa lựa chọn lưu trên trình duyệt.'));closeDialog();}
  if(action==='copy-email')copyPreparedEmail(control);
});

document.addEventListener('submit',event=>{
  if(event.target.id==='job-search'){
    event.preventDefault();const form=new FormData(event.target);state.keyword=String(form.get('keyword')||'').trim();state.location=String(form.get('location')||'all');state.category='all';state.expanded=true;renderJobs();$('#opportunities').scrollIntoView({behavior:'smooth'});
  }
  if(event.target.id==='application-form'){
    event.preventDefault();const form=new FormData(event.target);const job=jobs.find(j=>j.id===event.target.dataset.job);const email=job?.email||'thuyylingg2107@gmail.com';
    const subject=`${t('Gary Agency enquiry','Yêu cầu Gary Agency')}: ${form.get('subject')}`;
    const body=`${t('Hello Gary Agency,','Xin chào Gary Agency,')}\n\n${t('I’m interested in','Tôi quan tâm đến')}: ${form.get('subject')}\n\n${t('Name','Họ tên')}: ${form.get('name')}\nEmail: ${form.get('email')}\n${t('Phone / WhatsApp','Điện thoại / WhatsApp')}: ${form.get('phone')||'—'}\n${t('Current situation','Hiện tại')}: ${form.get('current-location')}\n\n${form.get('message')||''}\n\n${t('I will attach my relevant documents before sending.','Tôi sẽ đính kèm giấy tờ liên quan trước khi gửi.')}\n\n${t('Thank you,','Cảm ơn,')}\n${form.get('name')}`;
    const href=`mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    const fallback=$('#email-fallback');fallback.hidden=false;fallback.innerHTML=`<strong>${t('Your email draft is ready.','Bản nháp email đã sẵn sàng.')}</strong><p>${t('If your email app doesn’t open, use this address and copy your message:','Nếu ứng dụng email không mở, sử dụng địa chỉ sau và sao chép nội dung:')}</p><a href="mailto:${email}">${email}</a><div><a class="inline-link" id="open-email-draft">${t('Open email draft','Mở bản nháp email')} ${arrow()}</a><button class="inline-link" data-action="copy-email">${t('Copy email text','Sao chép nội dung email')}</button></div><textarea class="email-copy-area" aria-label="${t('Prepared email text','Nội dung email đã chuẩn bị')}" readonly></textarea>`;
    $('#open-email-draft').href=href;$('.email-copy-area').value=`To: ${email}\nSubject: ${subject}\n\n${body}`;
    const launcher=document.createElement('a');launcher.href=href;launcher.click();
    fallback.scrollIntoView({behavior:'smooth',block:'nearest'});
  }
});

async function copyPreparedEmail(control){
  const field=$('.email-copy-area');
  try{await navigator.clipboard.writeText(field.value);control.textContent=t('Copied!','Đã sao chép!');}
  catch{field.focus();field.select();toast(t('Select and copy the email text below.','Chọn và sao chép nội dung email bên dưới.'));}
}

$('#detail-dialog').addEventListener('click',event=>{if(event.target===$('#detail-dialog')){const rect=event.target.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)closeDialog();}});
$('#detail-dialog').addEventListener('close',()=>{document.body.classList.remove('dialog-open');if(dialogOpener?.isConnected)dialogOpener.focus({preventScroll:true});});
document.addEventListener('keydown',event=>{if(event.key==='Escape' && !event.target.closest('.gary-apps-menu[open]'))toggleMenu(false);});
document.addEventListener('toggle',event=>{if(event.target.matches('.faq-item')&&event.target.open)$$('.faq-item[open]').filter(item=>item!==event.target).forEach(item=>item.open=false);},true);
window.addEventListener('resize',()=>{if(window.innerWidth>1000)toggleMenu(false);},{passive:true});
renderPage();
