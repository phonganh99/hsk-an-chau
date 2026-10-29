# Landing Page HSK An Châu — Tích hợp CRM & Zalo Bot

Trang tuyển sinh HSK 1–3 của An Châu Education.

- Website dự kiến chính thức: https://hsk.anchaugroup.com.vn
- Mã nguồn: `index.html`, hình ảnh trong `assets/`.
- CRM quản trị: `crm/admin/index.html`.
- Backend Cloudflare Worker: `an-chau-hsk-crm-api`.
- Lưu Lead trong Cloudflare D1: `an-chau-hsk-crm`.
- Xác minh chống spam: Cloudflare Turnstile cho `hsk.anchaugroup.com.vn`.
- Quyền riêng tư và đồng ý tiếp nhận tư vấn: `chinh-sach-bao-mat-hsk/index.html`.
- Thông báo Lead HSK mới: Zalo Bot API; tin nhắn chỉ chứa mã lead, cơ sở, khóa học, nguồn (không gửi tên hoặc số điện thoại của học viên).

## Luồng hoạt động

`Form website → Turnstile → POST /api/leads → D1 CRM → Zalo outbox → Bot sendMessage → Hội thoại được ghép`

Nếu Bot chưa được ghép, Lead vẫn được lưu trong CRM, còn thông báo Zalo chờ đến khi kết nối thành công và được gửi lại qua tác vụ tự động.

## Ghép Bot lần đầu (cần thao tác của quản trị viên)

1. Vào `/crm/admin/` trên tên miền HSK; nhập địa chỉ Worker và `ADMIN_TOKEN` hợp lệ.
2. Xem `Tài khoản API` và `Bot ID` từ `getMe`. **Không so sánh Bot ID với số cuối deeplink Zalo**; hai mã không nhất thiết giống nhau.
3. Bấm `Tạo mã ghép bot` → `Sao chép lệnh /bind`.
4. Mở đúng Bot do An Châu xác nhận: https://zalo.me/3239880852839322399 rồi nhắn riêng nguyên văn mã trong thời hạn 15 phút.
5. Bấm `Kiểm tra kết nối` (hệ thống cũng tự kiểm tra lúc đang ghép) → `Gửi tin nhắn thử` để xác nhận nhận tin thật.

`ZALO_BOT_TOKEN`, `ZALO_WEBHOOK_SECRET`, `TURNSTILE_SECRET`, `ADMIN_TOKEN` phải lưu dưới dạng **Cloudflare Worker secrets**; không đưa vào HTML, commit, log hoặc tài liệu công khai.

## Lưu ý kiểm thử trước khi mở tuyển sinh

Mã nguồn frontend đã gửi đăng ký thực tới Worker, không còn thông báo thành công giả. Tuy nhiên phải kiểm thử end-to-end trên tên miền thực: Turnstile hợp lệ → Lead xuất hiện trong CRM → Bot đã ghép → nhận thông báo thực. Không coi việc push GitHub đồng nghĩa với việc vận hành Zalo thành công.

GitHub Pages có thể cấu hình tại Settings → Pages → Deploy from branch → main → /(root).
