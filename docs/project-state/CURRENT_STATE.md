# CURRENT_STATE

Ngày: 2026-10-07

## Trạng thái production

- GitHub Source of Truth: `haingoc79/META-Fleet-Dispatch`.
- Runtime: Cloudflare Workers + Static Assets + D1 + Cloudflare Access.
- Worker: `meta-fleet-dispatch`.
- D1 production: `meta-fleet-dispatch-prod`.
- Custom domain: `https://giaohang.meta.shopping`.
- GitHub CI: PASS.
- Cloudflare build/deploy: PASS.
- Production Worker version: `acb6d069-24e0-4d5e-9199-a02e065462a8`.
- Cloudflare Access: PASS — All traffic, Allow email domain `@meta.vn`.
- Session duration: 24 hours.
- Admin/Dispatcher verified live: `ngochai@meta.vn`.
- Configured Admin/Dispatcher: `ducthang@meta.vn`, `anhtuan@meta.vn`, `ngochai@meta.vn`, `bichthuy@meta.vn`.
- Other `@meta.vn`: Viewer by Worker RBAC; UI read-only. Live viewer negative-write test chưa chạy.
- `/healthz`: PASS.
- D1 hiện trống: 0 orders trước production import.
- Workbook thật: CHƯA NẠP.
- Production shadow dispatch: CHƯA CHẠY.
- Chưa PILOT READY.

## Bước kế tiếp

Nạp workbook ngày 2026-10-07 bằng tài khoản Admin, kiểm import counts/COD/data-quality, sau đó chạy shadow dispatch production và acceptance.
