# CRM HSK An Châu V1.0 - Hạ tầng chuẩn bị

CRM tạm dùng Cloudflare Worker và D1. Mã nguồn trong repository công khai, nhưng dữ liệu học sinh tuyệt đối KHÔNG lưu vào GitHub.

TRẠNG THÁI: mới chuẩn bị code, CHƯA triển khai Worker, CHƯA tạo D1, CHƯA nối Form. Landing Page đang không gửi Lead.

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
- Giai đoạn đầu chỉ quản trị viên; tài khoản Sale riêng và thông báo Telegram bổ sung sau khi triển khai xác thực, không chia sẻ token quản trị.

## Đưa về CRM chính
Xuất contacts, opportunities, lead_events, lead_sources. Đối chiếu contacts.phone và opportunities.id (external ID), upsert thay vì chèn mù. Giữ nguồn, trạng thái, cơ sở, Sale, lịch sử; không yêu cầu học sinh đăng ký lại.

## Kiểm thử trước khi kích hoạt thật
- Gửi mới, gửi trùng, đổi khóa, HSK 2/3, source không hợp lệ, validation điện thoại, Turnstile thiếu/hết hạn.
- Không có ADMIN_TOKEN phải không đọc/sửa/xuất được Lead.
- Hoàn thiện chính sách dữ liệu, rà soát quyền truy cập, backups, quyền sử dụng ảnh và quy trình tiếp nhận.
