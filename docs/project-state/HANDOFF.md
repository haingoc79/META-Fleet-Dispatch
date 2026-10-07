# HANDOFF

Production Worker đã deploy thành công tại `giaohang.meta.shopping`.

## Đã xác minh

- Build command `npm run build`: PASS.
- Deploy command `npx wrangler deploy`: PASS.
- D1 binding `env.DB -> meta-fleet-dispatch-prod`: PASS.
- Custom domain trigger: PASS.
- `/healthz`: PASS.
- Unauthenticated API data request: blocked with `ACCESS_REQUIRED`.

## Bước kế tiếp

1. Worker → tab Access → **Protect this Worker behind Access**.
2. Tạo Allow policy chỉ cho người dùng/nhóm nội bộ được phép.
3. Kiểm domain yêu cầu đăng nhập Cloudflare Access.
4. Sau khi Access PASS: nạp workbook thật qua tab Nạp dữ liệu.
5. Chạy Gợi ý phân bổ.
6. Kiểm Kết quả phân đơn theo nhân sự/chuyến/stop/COD.
7. Chạy acceptance production và rehearsal fallback.

Không commit workbook hoặc dữ liệu khách hàng vào GitHub.
