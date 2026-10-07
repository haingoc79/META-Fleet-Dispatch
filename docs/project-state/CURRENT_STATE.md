# CURRENT_STATE

Ngày: 2026-10-07

## Production

- GitHub Source of Truth: `haingoc79/META-Fleet-Dispatch`.
- Runtime: Cloudflare Workers + Static Assets + D1 + Cloudflare Access.
- Domain: `https://giaohang.meta.shopping`.
- D1: `meta-fleet-dispatch-prod`.
- Access: `@meta.vn` được vào; 4 Admin/Dispatcher được phép ghi, các tài khoản còn lại Viewer.
- Workbook production đã nạp.
- UI đang có 401 đơn, 44 nhân sự; tên sản phẩm được hiển thị ở bảng đơn và từng stop.
- COD bắt buộc cho mọi đơn; amount hiện derived từ UnitCost.

## Dispatch hiện tại

- Latest legacy/shadow result: 378 đơn / 75 chuyến / 33 nhân sự có proposal.
- Kết quả trên là `heuristic` cũ, CHƯA dùng đường bộ thật và không được coi là route plan cuối.
- Đã quan sát tuyến ngược/xa trong heuristic cũ; ví dụ có route ghép nhiều quận/huyện không hợp lý.

## Map-aware routing

Đã deploy code:
- tab **Bản đồ & tuyến**;
- Google Maps provider abstraction;
- geocode batch theo ngày;
- spatial clustering theo tọa độ + hướng so với depot;
- outlier review theo planning radius;
- Google Routes Compute Route Matrix theo từng trip;
- TWO_WHEELER cho xe máy, DRIVE cho ô tô; fallback được audit;
- nearest-neighbor + 2-opt stop sequence trên road-time matrix;
- route jobs chạy batch để tránh subrequest burst;
- khoảng cách/phút mỗi chặng hiển thị ở Kết quả phân đơn;
- geocode cache TTL 24h;
- regression test map-routing PASS.

Production map status hiện tại:
- provider: `google_maps_platform`
- eligible orders: 382
- geocoded: 0
- failed: 0
- `GOOGLE_MAPS_API_KEY`: chưa cấu hình
- HCM depot: chưa cấu hình
- Hà Nội depot: chưa cấu hình
- routeReady: false

## Chưa PILOT READY

Map-aware production run chưa thể chạy cho tới khi key và 2 depot được cấu hình, sau đó phải kiểm geocode, map run, route quality và acceptance.
