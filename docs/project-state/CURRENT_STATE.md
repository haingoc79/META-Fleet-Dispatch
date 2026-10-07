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

- Google key: configured.
- Depot HCM/Hà Nội: geocode OK.
- Eligible orders: 382.
- Geocoded OK: 170.
- Quota blocked: 80.
- Pending: 132.
- Other address errors: 0.
- `routeReady=false`.

Full provider diagnostic từ Google:
- consumer project number: `675960534045`;
- quota metric: `geocoding-backend.googleapis.com/v4/geocode_address_requests`;
- quota limit: `V4GeocodeAddressPerDayPerProject`;
- quota limit value Google backend đang áp: `100`;
- response: `429 RESOURCE_EXHAUSTED`.

Google Cloud UI do user chụp đang hiển thị quota 1,500/day và usage 170. Chưa retry thêm cho tới khi xác minh project number và backend quota đã propagate.

Latest route proposal 378 đơn/75 chuyến vẫn là heuristic cũ, không dùng làm route plan cuối.
