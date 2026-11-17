// Curated vacancy choices are application data, not separately published CMS records.
// Current provinces/cities: https://datafiles.chinhphu.vn/cpp/files/vbpq/2025/6/202qh.signed.pdf
const choices = rows => Object.freeze(rows.map(([value,en,vi]) => Object.freeze({value,label:Object.freeze({en,vi})})));
export const categoryOptions = choices([
 ['public','Public schools','Trường công lập'],
 ['centers','Language centers','Trung tâm tiếng Anh'],
 ['international-schools','International schools','Trường quốc tế'],
 ['private-schools','Private schools','Trường tư thục'],
 ['kindergarten','Kindergartens','Trường mầm non'],
 ['universities','Universities and colleges','Đại học và cao đẳng'],
 ['online','Online teaching','Giảng dạy trực tuyến'],
 ['other','Other teaching jobs','Việc làm giảng dạy khác'],
]);
export const locationOptions = choices([
 ['hanoi','Hanoi','Hà Nội'],['ho-chi-minh','Ho Chi Minh City','Thành phố Hồ Chí Minh'],
 ['hai-phong','Hai Phong','Hải Phòng'],['hue','Hue','Huế'],['da-nang','Da Nang','Đà Nẵng'],['can-tho','Can Tho','Cần Thơ'],
 ['an-giang','An Giang','An Giang'],['bac-ninh','Bac Ninh','Bắc Ninh'],['ca-mau','Ca Mau','Cà Mau'],['cao-bang','Cao Bang','Cao Bằng'],
 ['dak-lak','Dak Lak','Đắk Lắk'],['dien-bien','Dien Bien','Điện Biên'],['dong-nai','Dong Nai','Đồng Nai'],['dong-thap','Dong Thap','Đồng Tháp'],
 ['gia-lai','Gia Lai','Gia Lai'],['ha-tinh','Ha Tinh','Hà Tĩnh'],['hung-yen','Hung Yen','Hưng Yên'],['khanh-hoa','Khanh Hoa','Khánh Hòa'],
 ['lai-chau','Lai Chau','Lai Châu'],['lam-dong','Lam Dong','Lâm Đồng'],['lang-son','Lang Son','Lạng Sơn'],['lao-cai','Lao Cai','Lào Cai'],
 ['nghe-an','Nghe An','Nghệ An'],['ninh-binh','Ninh Binh','Ninh Bình'],['phu-tho','Phu Tho','Phú Thọ'],['quang-ngai','Quang Ngai','Quảng Ngãi'],
 ['quang-ninh','Quang Ninh','Quảng Ninh'],['quang-tri','Quang Tri','Quảng Trị'],['son-la','Son La','Sơn La'],['tay-ninh','Tay Ninh','Tây Ninh'],
 ['thai-nguyen','Thai Nguyen','Thái Nguyên'],['thanh-hoa','Thanh Hoa','Thanh Hóa'],['tuyen-quang','Tuyen Quang','Tuyên Quang'],['vinh-long','Vinh Long','Vĩnh Long'],
]);
const fold = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[đĐ]/g,'d').replace(/[^a-z0-9]/gi,'').toLowerCase();
export function resolveVacancyOption(value, options) {
 const key=fold(value); return options.find(option => [option.value,option.label.en,option.label.vi].some(label => fold(label)===key))?.value || value;
}
