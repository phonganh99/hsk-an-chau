// An Chau AI public knowledge, hand-reviewed before production enablement.
// Pricing, scholarship, visa and guarantees deliberately excluded until verified.
export const KNOWLEDGE_VERSION = "hsk-ai-2026-10-29";
export const FACTS = Object.freeze([
  {id:"courses", title:"Các khóa học", value:"An Châu giới thiệu lộ trình học tiếng Trung HSK 1, HSK 2, HSK 3 và combo HSK 1–3.", source:"hsk-an-chau/index.html#courses"},
  {id:"placement",title:"Đánh giá trình độ",value:"Người mới có thể bắt đầu với HSK 1. Người muốn vào HSK 2 hoặc HSK 3 cần được đánh giá trình độ đầu vào trước khi xếp lớp.",source:"hsk-an-chau/index.html#courses"},
  {id:"offices",title:"Cơ sở",value:"Landing Page hiện liệt kê hai cơ sở tư vấn: Hà Nội và Nghệ An. Vui lòng xác nhận địa điểm học cụ thể với An Châu.",source:"hsk-an-chau/index.html#schedule"},
  {id:"schedule",title:"Lịch học",value:"Có các ca học nguyện vọng AC1, AC2, AC3, AC4 trên trang đăng ký; việc chọn ca không có nghĩa đã giữ chỗ.",source:"hsk-an-chau/index.html#schedule"},
  {id:"contact",title:"Liên hệ",value:"Có thể để lại form đăng ký trên website hoặc liên hệ hotline 0923 181 123, 093 123 2222 để được nhân viên xác nhận.",source:"hsk-an-chau/index.html#footer"}
]);
export function normalizeText(input,max=1200){
  if(typeof input!=="string")return "";
  return input.replace(/[\u0000-\u001F\u007F]/g," ").trim().slice(0,max);
}
export function normalizePhone(input){
  const raw=String(input||"").trim().replace(/[\s.()-]/g,"");
  const p=raw.startsWith("+84")?"0"+raw.slice(3):raw.startsWith("84")&&raw.length===11?"0"+raw.slice(2):raw;
  return /^0[35789][0-9]{8}$/.test(p)?p:null;
}
export function isHandoffIntent(text){
  return /(gặp|nói chuyện|liên hệ|chuyển|kết nối).{0,24}(nhân viên|sale|tư vấn viên|người thật)|(?:nhân viên|sale|tư vấn viên).{0,20}(gọi|liên hệ|tư vấn)|đăng ký tư vấn/i.test(text);
}
export function safeFallback(text){
  const s=normalizeText(text).toLocaleLowerCase("vi");
  if(isHandoffIntent(s))return "An Châu có thể chuyển yêu cầu cho nhân viên. Trên website hãy chọn ‘Gặp tư vấn viên’; trong Zalo gửi /tuvan để xem cách cung cấp thông tin có đồng ý.";
  if(/học phí|bao nhiêu|giá|ưu đãi|giảm giá|học bổng|cam kết|visa/i.test(s))return "Học phí, ưu đãi và điều kiện có thể thay đổi theo đợt. Em chưa có bảng chính sách đã được duyệt để xác nhận. Anh/chị vui lòng chọn ‘Gặp tư vấn viên’ để nhận thông tin chính thức.";
  if(/lịch|ca học|thứ mấy|khai giảng|giờ học/i.test(s))return "Trang HSK có các ca học nguyện vọng AC1–AC4. Lịch thực tế và ngày khai giảng cần được nhân viên An Châu xác nhận; việc chọn ca chưa giữ chỗ.";
  if(/hsk\s*[123]|khóa|khóa học|trình độ|mới bắt đầu|tiếng trung/i.test(s))return "An Châu giới thiệu HSK 1, HSK 2, HSK 3 và combo 1–3. Người mới có thể tìm hiểu HSK 1; HSK 2/3 cần đánh giá đầu vào. Anh/chị đã học tiếng Trung chưa và muốn đạt mục tiêu gì?";
  if(/hà nội|nghệ an|địa chỉ|cơ sở|ở đâu/i.test(s))return "Landing Page An Châu có thông tin cơ sở Hà Nội và Nghệ An. Anh/chị muốn học tại cơ sở nào? Nhân viên sẽ xác nhận địa điểm học phù hợp.";
  return "Em có thể hỗ trợ anh/chị tìm hiểu HSK 1–3, chọn lộ trình, ca học và chuyển yêu cầu tư vấn. Anh/chị đang ở trình độ nào và muốn học để giao tiếp, thi HSK hay phục vụ kế hoạch du học?";
}
export function parseZaloConsult(text){
  const s=normalizeText(text,450);
  // Explicit consent required; never silently extract numbers from free-form chat.
  const m=s.match(/^\/tuvan\s+([^|]{2,80})\s*\|\s*([^|]{9,20})\s*\|\s*(HSK\s*[123]|combo|chua ro)\s*\|\s*(HN|NA)\s*\|\s*DONGY\s*$/i);
  if(!m)return null;
  const phone=normalizePhone(m[2]),name=normalizeText(m[1],80);
  if(!phone||name.length<2)return null;
  const course=m[3].toLowerCase().replace(/\s+/g,"");
  return {full_name:name,phone,course:course==="chuaro"?"unsure":course==="combo"?"combo":course,office:m[4].toUpperCase()==="HN"?"hn":"na",consent:true};
}
export function parseWebhookEvent(body){
  const e=body?.result&&typeof body.result==="object"?body.result:body;
  if(!e||e.event_name!=="message.text.received")return null;
  const m=e.message||{}, id=m.chat?.id, sender=m.from||{};
  if(String(m.chat?.chat_type||"").toUpperCase()!=="PRIVATE"||sender.is_bot===true)return null;
  if((typeof id!=="string"&&typeof id!=="number")||!String(id)||String(id).length>128)return null;
  const text=normalizeText(m.text,1200);
  if(!text)return null;
  return {chatId:String(id),messageId:String(m.message_id||""),timestamp:Number(m.date)||0,text};
}
