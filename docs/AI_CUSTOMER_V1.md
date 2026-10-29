# AN CHÂU AI CUSTOMER PLATFORM V1.0 — HSK MVP

**Phạm vi:** Chỉ repository `phonganh99/hsk-an-chau`. Không sửa `anchau-website-preview` hoặc `an-chau-marketing`.

**Trạng thái hiện tại:** Mã nguồn MVP trên nhánh `feature/ai-customer-platform-v1`, **chưa deploy và chưa migrate production**. Không coi kiểm thử tĩnh là kiểm thử Zalo/n8n/AI thực.

## A. Audit công nghệ

- Landing Page là HTML/CSS/JavaScript tĩnh (không React/Next); CSS và JS trang chính nằm trong `index.html`. Có nhóm nút nổi Call/SMS/Zalo và form đăng ký HSK.
- CRM hiện tại nằm ở `crm/admin/index.html`, quản trị bằng `ADMIN_TOKEN` qua API; dữ liệu thực do Worker `an-chau-hsk-crm-api` quản lý.
- Cloudflare D1 `an-chau-hsk-crm` đã có `contacts`, `opportunities`, `lead_events`, `lead_sources`, `notification_outbox` và bảng cấu hình Zalo.
- Form HSK có Cloudflare Turnstile; đây là hệ thống riêng, tiếp tục sử dụng như cũ.
- Zalo đang dùng **Zalo Bot Platform**, không có bằng chứng dự án sử dụng Zalo Official Account API. Bot ID do getMe trả về không nhất thiết là số cuối deeplink.
- CRM hiện có trạng thái `new/contacted/invited/deposit/enrolled/lost`. **Không thay đổi workflow này** vì các API và dashboard đang phụ thuộc vào nó.
- Trên D1 đã kiểm tra trước khi phát triển: 0 contacts, 0 opportunities, 0 Zalo recipient paired. Không thực hiện lệnh thay đổi dữ liệu production trong phạm vi triển khai nhánh này.

## B. Kiến trúc MVP

```text
HSK Landing Page (Web Chat) ------> AI Worker (an-chau-hsk-ai-api)
                                         | Session / Channel separation
Zalo Bot private webhook ---------->     | Knowledge + AI Agent / FAQ fallback
                                         | Human handoff
                                         v
                             Cloudflare D1 (dùng chung CRM)
                              |- existing contacts/opportunities/lead_events
                              |- new ai_sessions/ai_messages
                              |- new ai_handoffs/ai_webhook_events
                              |- new ai_automation_outbox/ai_zalo_outbox
                                         |
                                 n8n Webhook (async)
                                         |
                                Workflow Sales thông báo
```

**Tách Worker để giảm rủi ro:** Worker CRM `an-chau-hsk-crm-api` đang hoạt động **không được ghi đè**. Worker AI mới chia sẻ D1, chỉ bổ sung bảng bằng migration. Phần chính `workers/hsk-crm-api.js` là entrypoint của Worker AI, không thay thế Worker cũ.

- Web sessions: `session_id + secret` (hash SHA-256 trong D1), Turnstile và đồng ý bảo mật; không lưu secret vào localStorage.
- Zalo sessions: `chat_id` do Zalo gửi sau khi xác thực webhook; không tự liên kết với Web.
- Customer AI: chỉ dựa vào tập `workers/ai-knowledge.js`; thông tin HSK không chắc chắn thì chuyển Sale; không có quyền đọc CRM hay chạy lệnh.
- AI model: OpenAI Responses API, `store:false`, chỉ kích hoạt khi có `AI_API_KEY` và `AI_MODEL`. Thiếu cấu hình thì dùng FAQ giới hạn (hiển thị `guided_fallback`), **không giả lập thành một mô hình AI thực**.
- CRM: lead mới dùng `contacts` và `opportunities` hiện có, nhận diện trùng bằng số điện thoại đã chuẩn hóa; không gộp khách chỉ vì tên giống nhau.
- Sale handoff: phải có tên, số điện thoại, khóa, cơ sở và đồng ý. Nếu danh sách `ai_sale_roster` chưa có nhân sự được bật, trạng thái chuyển Sale là `pending`, không tự gán người giả.
- n8n: sự kiện vào outbox có event_id. Worker gửi lại có backoff; API timeout. Workflow ví dụ chỉ nhận sự kiện và xác thực header; bước gửi email chưa bật cho đến khi cấu hình SMTP và cơ chế idempotency downstream.
- Dữ liệu cá nhân: Web và Zalo không đồng bộ danh tính tự động; số điện thoại trong hội thoại tự do được che khi lưu hoặc gửi đến AI. Chỉ Lead có đồng ý mới ghi số điện thoại vào CRM.
- CRM admin: bảng yêu cầu AI bổ sung vào dashboard hiện có, số liệu đọc từ bảng thật, không có KPI minh họa.

## C. Thay đổi file

| File | Vai trò |
| --- | --- |
| `index.html` | Nút chat trong thanh liên hệ nổi, panel tư vấn HSK có consent |
| `assets/ai-chat.css` | Responsive, accessibility, animation nhẹ |
| `assets/ai-chat.js` | Xác minh Turnstile, quản lý phiên, gửi tin, chuyển Sale |
| `crm/admin/index.html` | Màn hình danh sách AI handoff và chỉ số |
| `workers/hsk-crm-api.js` | Entrypoint Worker AI độc lập |
| `workers/ai-customer.js` | Conversation, API, CRM handoff, Zalo adapter, n8n outbox |
| `workers/ai-knowledge.js` | Knowledge base public, FAQ giới hạn, chuẩn hóa dữ liệu |
| `workers/migrations/001_ai_customer.sql` | Bảng mới, index, nguồn Lead web_ai/zalo_ai |
| `n8n/hsk-ai-handoff.template.json` | Workflow mẫu nhận sự kiện có xác thực |
| `.env.example`, `wrangler.toml.example` | Mẫu cấu hình, không chứa credential thật |
| `tests/ai-customer.test.mjs`, `package.json` | Kiểm thử offline (Node.js) |
| `chinh-sach-bao-mat-hsk/index.html` | Thông báo dữ liệu hội thoại và quy trình consent |

## D. Cấu hình và triển khai — CHỈ sau khi được duyệt

1. Tạo **D1 staging** hoặc snapshot riêng, chạy migration `workers/migrations/001_ai_customer.sql` lên staging. Đây là migration **additive**: không xóa bảng, không đổi status CRM. Kiểm tra `lead_sources` có hỗ trợ `kind='marketing'` trước khi chạy.
2. `cp wrangler.toml.example wrangler.toml`, điền **ID D1 staging**, không trỏ production khi chưa được phê duyệt.
3. Cấu hình Cloudflare Worker secrets với `wrangler secret put`: `TURNSTILE_SECRET`, `ADMIN_TOKEN`, `AI_RATE_SALT`, `AI_API_KEY` và khi cần `ZALO_BOT_TOKEN`, `ZALO_WEBHOOK_SECRET`, `N8N_SHARED_SECRET`. Không commit secret. `AI_MODEL` là model ID được phê duyệt.
4. Turnstile phải cho phép hostname web staging hoặc đúng `hsk.anchaugroup.com.vn`. Mã hiện kiểm tra nghiêm ngặt hostname và action `hsk_ai_chat`; muốn dùng domain staging phải cấu hình action và hostname phù hợp ở code staging, không nới điều kiện trên production.
5. Thiết lập `AI_ENABLED=true` **chỉ ở Worker staging** sau khi migration và Turnstile được xác minh. Web Chat sẽ gọi URL Worker AI trong `assets/ai-chat.js`; trước khi nâng lên production phải thay về hostname Worker staging và cấu hình CORS đúng origin staging.
6. Import `n8n/hsk-ai-handoff.template.json`. Trong node Webhook, tạo **Header Auth credential**: header `X-AnChau-Webhook-Key`, value khớp `N8N_SHARED_SECRET`. Sửa `N8N_WEBHOOK_URL` trỏ webhook Production URL khi đã bật workflow, kiểm tra `X-AnChau-Event-Id` để thực hiện idempotency trước mọi hành động gửi thông báo. Node email minh họa được vô hiệu hóa mặc định.
7. Thử Web: Turnstile → tạo phiên → chat HSK → yêu cầu Sale → CRM có contact/lead → handoff `pending` hoặc `assigned` đúng roster → n8n nhận đúng event_id.
8. Chỉ sau đó mới chuyển sang D1 production và bật Web Chat ngoài thực tế, bằng phê duyệt riêng.

### Zalo Bot — lưu ý bắt buộc

- API chính thức: `https://bot.zapps.me/docs/`.
- Webhook signed request: `X-Bot-Api-Secret-Token` (như tài liệu Zalo); gửi phản hồi bằng `sendMessage`, nội dung tối đa 2.000 ký tự.
- `getUpdates` **không thể** chạy song song với webhook, phù hợp chủ yếu development.
- **Chưa đổi webhook production**. Hiện cùng Bot đang dùng để ghép hội thoại **nhận cảnh báo nội bộ**. Nếu chuyển webhook sang Worker AI trước khi ghép xong, quy trình ghép cũ có thể không nhận `/bind` nữa.
- Phương án tối ưu: cân nhắc Bot riêng cho khách và Bot riêng cho thông báo nội bộ. Nếu chỉ dùng một Bot, phải hoàn tất ghép staff trước và test. Webhook mới có kiểm tra tách riêng chat nội bộ qua `zalo_notification_target` (không đưa vào AI).
- Khi được phê duyệt chuyển webhook: dùng URL `https://an-chau-hsk-ai-api.phonganh99.workers.dev/api/zalo/webhook`, cấu hình `setWebhook` với token/secret phù hợp, kiểm tra `getWebhookInfo`, test một tin thực từ tài khoản ngoài; chỉ khi webhook thành công mới bật `AI_ZALO_ENABLED=true`.
- Sau đó thử `/tuvan Họ tên | 0912345678 | HSK1 | HN | DONGY`. Đây là luồng đồng ý rõ ràng để CRM có thể ghi số liên hệ. Khách có thể chọn khóa/cơ sở khác theo mẫu trong tin hướng dẫn.

## E. Kiểm thử và tiêu chí nghiệm thu

- Kiểm tra JavaScript/HTML và định dạng workflow n8n, các hàm phone normalization, webhook private/group, consent và redaction.
- Chạy offline bằng `npm test` (cần Node 20+). Các negative test từ chối Origin giả mạo, webhook Zalo thiếu secret, và Worker AI chưa bật.
- **Chưa chạy** end-to-end trên staging D1, webhook live, AI provider thật hay n8n thật; chưa có credentials/hạ tầng đã được cấp cho Worker mới.
- Cần kiểm tra thêm: webhook trùng `message_id`, retry n8n, rollback khi Zalo lỗi, idempotency Sale notification, nghẽn mạng, Turnstile trên điện thoại, quyền riêng tư, báo cáo CRM, xem xét tuân thủ dữ liệu cá nhân.
- Không dùng dữ liệu thật để thử nghiệm khi chưa có kế hoạch kiểm thử được duyệt.

## F. Backlog sau MVP

Quy tắc ca trực/năng lực Sale đầy đủ; staff login theo role thay vì một khóa quản trị; cấu hình knowledge base có quy trình duyệt; xử lý AI fallback nâng cao; dashboard phễu tuyển sinh; chuyển kênh có xác minh; Internal Marketing Agent (môi trường và quyền tách riêng).
