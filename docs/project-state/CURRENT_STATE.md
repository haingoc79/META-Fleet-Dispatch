# CURRENT_STATE

Ngày: 2026-10-07

## Trạng thái production

- GitHub Source of Truth: `haingoc79/META-Fleet-Dispatch`.
- Runtime: Cloudflare Workers + Static Assets + D1.
- Worker: `meta-fleet-dispatch`.
- D1 production: `meta-fleet-dispatch-prod`.
- D1 UUID: `0467fc36-a689-40bf-92db-21db69c0f26c`.
- Custom domain: `https://giaohang.meta.shopping`.
- Cloudflare build/deploy: PASS.
- Worker Version ID: `bfe90d26-9b1e-4ef3-be66-e28b0f67ce88`.
- `/healthz`: PASS, persistence=`cloudflare-d1`.
- Unauthenticated `/api/bootstrap`: blocked with `ACCESS_REQUIRED`.
- Cloudflare Access: CHƯA BẬT; dashboard ghi rõ "This Worker is not protected by Access".
- Workbook thật: CHƯA NẠP vào D1.
- Shadow production trên D1: CHƯA CHẠY.
- Chưa PILOT READY.

## Source hiện có

- COD bắt buộc cho mọi đơn.
- Import workbook browser-side vào D1.
- Feasibility engine.
- Shadow dispatch v2.
- UI Kết quả phân đơn theo nhân sự → chuyến → stop → order.
- D1 persistence.
- GitHub CI syntax/build PASS.

## Local block hiện tại

Không được nạp PII thật cho tới khi Cloudflare Access được bật và kiểm chứng.
