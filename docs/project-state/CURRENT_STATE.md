# CURRENT_STATE

Ngày: 2026-10-07

## Production

- GitHub Source of Truth: `haingoc79/META-Fleet-Dispatch`.
- Runtime: Cloudflare Workers + Static Assets + D1 + Cloudflare Access.
- Domain: `https://giaohang.meta.shopping`.
- D1: `meta-fleet-dispatch-prod`.
- Workbook production đã nạp: 401 đơn.
- Tên sản phẩm đã live trong bảng đơn và từng stop.
- Access/RBAC: `@meta.vn` viewer; 4 Admin/Dispatcher có write.

## Map-aware routing

- Google key: configured.
- Depot HCM: `20A Cộng Hoà, Phường Bảy Hiền, TP HCM` — geocode OK.
- Depot Hà Nội: `56 Duy Tân, Phường Cầu Giấy` — geocode OK.
- Eligible orders: 382.
- Geocoded OK: 170.
- Quota blocked: 212.
- Other geocode errors: 0.
- Pending: 0.
- `routeReady=false`.

Root cause của 212 failures: Google Geocoding API v4 trả `GEOCODE_API_429` do daily quota `v4 GeocodeAddress requests per day` đã hết.

Production đã có:
- quota blocker phân biệt riêng với lỗi địa chỉ;
- Admin diagnostics;
- nút **Retry đơn bị quota**;
- retry chỉ reset các record 429, giữ nguyên 170 geocode đã thành công.

## Dispatch

Latest 378-order / 75-trip result vẫn là heuristic cũ và không được dùng làm route plan cuối.

## Next

Tăng Google Geocoding daily quota, retry 212 đơn, audit outlier/geocode, sau đó mới chạy Google Routes map-aware shadow.
