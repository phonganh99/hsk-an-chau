# CRM HSK An Châu V1.0 - Hạ tầng chuẩn bị

CRM tạm dùng Cloudflare Worker và D1. Mã nguồn trong repository công khai, nhưng dữ liệu học sinh tuyệt đối KHÔNG lưu vào GitHub.

TRẠNG THÁI: D1 và Worker CRM HSK đã triển khai. Form Landing Page hiện CHƯA kết nối để nhận Lead thật. Zalo Bot đã tích hợp trong mã, đang chờ cấu hình Bot Token, Webhook Secret và ghép hội thoại riêng.

## Hạ tầng

Landing Page https://hsk.anchaugroup.com.vn (GitHub Pages) -> Worker POST /api/leads -> cơ sở dữ liệu D1 riêng. Giao diện quản trị tại /crm/admin/; API quản trị bắt buộc Bearer ADMIN_TOKEN. Token chỉ giữ trong bộ nhớ trang, không lưu localStorage.

## Cài đặt (Cloudflare / Node.js / Wrangler)

1. Tạo Cloudflare Turnstile cho hostname hsk.anchaugroup.com.vn; ghi lại public sitekey và private secret.
2. Trong thư mục crm chạy npm install; npx wrangler login.
3. Chạy npx wrangler d1 create an-chau-hsk-crm --location apac.
4. Thay database_id trong crm/wrangler.toml bằng UUID Cloudflare cấp.
5. Chạy npx wrangler d1 execute an-chau-hsk-crm --remote --file=./schema.sql.
6. Chạy npx wrangler secret put ADMIN_TOKEN (mật khẩu tạo ngẫu nhiên ít nhất 32 ký tự).
7. Chạy npx wrangler secret put TURNSTILE_SECRET (secret widget Turnstile).
8. Chạy npx wrangler deploy. Ghi lại workers.dev URL thực tế, không phỏng đoán tên miền.
9. Mở /health; chỉ tiến hành kiểm thử tiếp nếu DB và Turnstile đều sẵn sàng.
10. Khi có privacy notice thật, kiểm thử đầy đủ backend rồi mới tích hợp và kích hoạt Form công khai.

## API dự kiến
- POST /api/leads: full_name,phone,office,course,preferred_slot,previous_level,source_code,privacy_notice_version,turnstile_token; origin chỉ hsk.anchaugroup.com.vn; Turnstile xác thực server.
- GET /api/admin/leads?office=hn&status=new&limit=100&offset=0: quản trị yêu cầu Bearer ADMIN_TOKEN.
- GET /api/admin/stats: thống kê theo trạng thái.
- PATCH /api/admin/leads/:id: cập nhật trạng thái và Sale phụ trách, có nhật ký.
- GET /api/admin/export: CSV phục vụ chuyển CRM chính.
- GET /health: trạng thái backend không chứa dữ liệu cá nhân.

## Bảo toàn nguồn và chống trùng
- Chuẩn hóa số điện thoại; duy nhất một contact cho một số.
- Một cơ hội HSK / một contact trong V1. Có thể có các cơ hội khác khi vào CRM chung.
- Không sửa first_source_code khi nộp lại Form; cập nhật last_source_code và ghi lead_events.
- Partner không có quyền xem hồ sơ học sinh; dữ liệu thuộc An Châu.
- Giai đoạn đầu chỉ quản trị viên; tài khoản Sale riêng cần có đăng nhập và phân quyền trước khi cấp quyền nhập Lead, không chia sẻ ADMIN_TOKEN.

## Đưa về CRM chính
Xuất contacts, opportunities, lead_events, lead_sources. Đối chiếu contacts.phone và opportunities.id (external ID), upsert thay vì chèn mù. Giữ nguồn, trạng thái, cơ sở, Sale, lịch sử; không yêu cầu học sinh đăng ký lại.

## Kiểm thử trước khi kích hoạt thật
- Gửi mới, gửi trùng, đổi khóa, HSK 2/3, source không hợp lệ, validation điện thoại, Turnstile thiếu/hết hạn.
- Không có ADMIN_TOKEN phải không đọc/sửa/xuất được Lead.
- Hoàn thiện chính sách dữ liệu, rà soát quyền truy cập, backups, quyền sử dụng ảnh và quy trình tiếp nhận.

## V1.2 — Thêm Lead thủ công và thông báo Zalo Bot (28/10/2026)

### Lead thủ công
Biểu mẫu tại `https://hsk.anchaugroup.com.vn/crm/admin/` có các nguồn: Zalo Sale, gọi điện trực tiếp, khách đến văn phòng, khác. Một số điện thoại tương ứng một contact/Lead HSK, lặp lại sẽ không gửi thông báo mới. Chức năng hiện yêu cầu ADMIN_TOKEN, **không chia sẻ** token quản trị cho các Sale; cần đăng nhập cá nhân và phân quyền riêng trong phiên bản tiếp theo.

### Zalo Bot (không dùng Telegram)
Bot riêng **Bot An Châu HSK** sử dụng `https://bot-api.zaloplatforms.com/bot<BOT_TOKEN>/sendMessage` với `chat_id` lấy từ webhook sau khi ghép mã dùng một lần.

Worker: `an-chau-hsk-crm-api`
Webhook URL nhập trong Zalo Bot Creator:

```
https://an-chau-hsk-crm-api.phonganh99.workers.dev/api/zalo/webhook
```

Tại Cloudflare Worker → Settings → Variables and Secrets, thêm **hai Secret**:
- `ZALO_BOT_TOKEN`: token riêng do Zalo Bot Manager gửi qua tin nhắn khi tạo Bot. Tuyệt đối không đưa vào GitHub hoặc chat.
- `ZALO_WEBHOOK_SECRET`: chuỗi bí mật dài ít nhất 32 ký tự, có thể tạo bằng `openssl rand -hex 24`; nhập cùng một giá trị vào ô **Secret Token** của Zalo Bot. Không nhầm giá trị này với Bot Token.

Tại Zalo Bot Creator → Thiết lập chung: nhập Webhook URL và Secret Token, sau đó nhấn **Lưu thay đổi**. Bot chỉ nhận sự kiện từ Zalo khi header `X-Bot-Api-Secret-Token` trùng Secret Cloudflare.

### Ghép bot nhận thông báo
1. Đăng nhập CRM tại `/crm/admin/` với ADMIN_TOKEN.
2. Phần "Thông báo Lead mới qua Zalo Bot" → **Tạo mã ghép bot**. Một mã chỉ có hiệu lực 15 phút.
3. Nhắn riêng cho **Bot An Châu HSK** trên Zalo đúng lệnh `/bind HSK-...` do CRM hiển thị.
4. CRM → **Kiểm tra kết nối** xác nhận "Cuộc trò chuyện: đã ghép", sau đó bấm **Gửi tin nhắn thử**.
5. Khi có Lead hoàn toàn mới (từ Form hoặc nhập thủ công), Worker ghi `notification_outbox` kênh `zalo` rồi gửi ngay nếu bot đã ghép. Lead trùng không phát thông báo. Nếu chưa cấu hình, hàng đợi giữ trạng thái chờ, có nút **Gửi lại thông báo Zalo**.

Thông báo chỉ gồm **mã Lead (8 ký tự), cơ sở, khóa học, nguồn và liên kết CRM**. Không chuyển họ tên, điện thoại, thông tin khách sang hội thoại bot. Chỉ ghép cuộc trò chuyện PRIVATE (Zalo nhóm hiện đang Beta, chưa dùng).

### API
- `POST /api/zalo/webhook` — sự kiện đến từ Zalo, xác minh header và mã /bind.
- `GET /api/admin/zalo/status` — trạng thái Secret, ghép hội thoại, hàng đợi (yêu cầu ADMIN_TOKEN).
- `POST /api/admin/zalo/pair` — sinh mã dùng một lần (yêu cầu ADMIN_TOKEN).
- `POST /api/admin/zalo/test` — gửi thông báo thử.
- `POST /api/admin/notifications/flush` — gửi lại các thông báo đang chờ.

**Chú ý:** Không có quyền đọc tin nhắn Zalo cá nhân của Sale; Sale cần nhập Lead thủ công nếu khách liên hệ riêng với họ. Form công khai Landing Page chưa kích hoạt nhận Lead cho đến khi hoàn tất kiểm thử và chính sách dữ liệu.

## V1.3 — Chẩn đoán Zalo Bot và ghép dự phòng (28/10/2026)

Màn hình CRM hiển thị tên tài khoản thực của Zalo Bot Token thông qua API `getMe`. Đối chiếu tài khoản này với bot mà nhân viên đang nhắn; Webhook URL đúng **không đồng nghĩa** Zalo đã gửi sự kiện.

Nếu Webhook vẫn không nhận tin dù đúng URL:
1. Trong CRM chọn **1. Bắt đầu ghép dự phòng**. Lệnh chỉ quản trị mới gọi được.
2. Worker gọi `deleteWebhook` tạm thời, tạo mã `/bind HSK-...` có hiệu lực tối đa 3 phút.
3. Gửi mã đó **qua hội thoại riêng với đúng bot** trong lúc ghép dự phòng đang hoạt động.
4. Chọn **2. Xác nhận đã gửi mã**: Worker dùng `getUpdates` (Zalo polling) để tìm đúng mã và đối chiếu hash trong D1.
5. Nếu ghép thành công, CRM lưu `chat_id`, tự khôi phục Webhook bằng `setWebhook` và thử gửi một tin xác nhận.
6. Nếu không thấy tin, bấm Xác nhận thêm lần nữa trong hạn 3 phút. Bấm **Hủy / Khôi phục Webhook** để dừng sớm.

Worker được gắn Cron `* * * * *` trên Cloudflare. Cron tự động thử khôi phục Webhook sau khi thời gian ghép dự phòng hết hạn. Không sử dụng chế độ dự phòng nếu Cron bị gỡ. Chế độ này chỉ để xác định chat nhận thông báo; sau đó **hoạt động bình thường vẫn qua Webhook**. Nội dung tin, danh tính người gửi, Bot Token và Secret không được log.

**Lưu ý vận hành:** Trong 3 phút ghép dự phòng, Zalo Webhook bị tạm ngưng; `getUpdates` không hoạt động đồng thời với Webhook theo tài liệu Zalo. Lead vẫn được ghi vào D1 và thông báo nằm trong outbox. Không triển khai thay đổi DNS hoặc cấp ADMIN_TOKEN cho Sale.

## V1.4 — Zalo polling bridge for outbound-only Lead alerts (29/10/2026)

**Reason:** Zalo `testWebhook` returned `webhook.http.403` for `workers.dev`, while independent GitHub HTTP requests reached Worker and Worker traces showed no Zalo callback. This feature provides a temporary inbound pairing mechanism without changing PA DNS or lowering Webhook authentication.

**Deployment:** D1 table `zalo_polling_control` controls mode `pairing` → `paired`. Worker Cron `* * * * *` calls `getUpdates` once each minute, after calling Zalo `deleteWebhook` and confirming the saved URL is empty. API response `error_code:408` is an empty poll. Only an authenticated admin may create a 24-character random `/bind HSK-...` command (96-bit entropy). The code is stored as SHA-256, once per recipient, and must be sent to the bot's **private** chat; no unexpected incoming message can self-pair. A separate one-time 48-hour code can be provisioned by an administrator when handing over.

After the first valid `/bind`, Worker persists the private `chat_id`, attempts a confirmation via `sendMessage` and changes mode to `paired`. Scheduled inbound polling stops, while Cron keeps retrying pending outbox notifications. Direct Lead notifications use outbound `sendMessage`, independent of Webhook. **Does not receive or read Sale's personal Zalo chat history.** It does not forward student names or phone numbers.

**UI:** Admin `Kiểm tra kết nối` shows `polling_mode`, `last_poll_at`, `last_status`, `last_update_count`. In polling mode, the unavailable Webhook testing/syncing and obsolete 3-minute pairing controls are disabled/hidden.

**Checklist before production sign-off:**
- Worker checks and GitHub Actions pass.
- D1 mode is `pairing`, `webhook_removed=1`, last status `idle` (means the Zalo Bot API can be polled).
- The operator sends the new `/bind` command **once** to the private bot chat.
- Confirm `mode=paired`, `zalo_notification_target` row exists and Zalo confirms the message was delivered.
- Send a test message from CRM; run deduplication + Lead-notification smoke tests; do not enable public lead collection before it passes.

**Operational limitations:** This is a fallback for *pairing*; it is not a generic production inbound-message Webhook replacement. Cron is every minute only until paired. Once paired, notification delivery is via outbound Zalo API. Do not call `setWebhook` while mode is `pairing` or `paired` (API blocks it). To reactivate inbound Webhook later, explicitly migrate with an operator and confirm a working custom domain first. Secrets must never be placed into repository, issue, or chat.

**Current integration status:** Technical polling is deployed, but real Zalo private pairing and Lead-notification delivery must still be proven end-to-end. Do not mark Zalo production-ready before those two checks.
