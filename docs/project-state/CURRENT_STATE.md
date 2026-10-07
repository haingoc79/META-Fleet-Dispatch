# CURRENT_STATE

Ngày: 2026-10-07

## Production

- GitHub Source of Truth: `haingoc79/META-Fleet-Dispatch`.
- Runtime: Cloudflare Workers + D1 + Cloudflare Access.
- Domain: `https://giaohang.meta.shopping`.
- Workbook production: 401 đơn.
- Tên sản phẩm: live.
- RBAC: `@meta.vn` Viewer; 4 Admin/Dispatcher có write.

## Map-aware routing

- Worker đã chuyển sang **stable Google Geocoding API v3** thay cho v4 Preview.
- Routes API giữ nguyên.
- Depot HCM/Hà Nội: geocode OK từ dữ liệu cache trước.
- Geocode state: 170 OK, 80 quota-blocked cũ, 132 pending.
- Provider diagnostic bằng stable v3 hiện trả HTTP 200 nhưng payload:
  - status = `REQUEST_DENIED`
  - error = `You must enable Billing on the Google Cloud Project`
- Project ID: `white-sign-510904-j5`
- Project number: `675960534045`
- Google key hiện dùng thuộc đúng project cũ.
- Active blocker hiện tại: Billing của project chưa được Google Maps backend công nhận là enabled/linked.

## Dispatch

Latest 378-order / 75-trip result vẫn là heuristic cũ, không dùng làm route plan cuối.
