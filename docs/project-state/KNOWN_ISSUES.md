# KNOWN_ISSUES

- K01 P1: Google backend vẫn áp GeocodeAddress daily quota = 100 cho consumer project `675960534045`, dù Cloud Console UI đang hiển thị 1,500. Cần xác minh project number / propagation trước khi retry.
- K02 P1: Map-aware production run chưa chạy; 170/382 geocode OK, 80 quota blocked, 132 pending.
- K03 P1: latest 378-order proposal vẫn là heuristic cũ, không dùng làm route plan cuối.
- K04 P1: COD amount derived từ tổng UnitCost, chưa authoritative từ OMS.
- K05 P1: live negative-write test bằng Viewer chưa chạy.
- K06 P2: capacity/shift/SLA vẫn là planning assumptions.
- K07 P2: map radius assumptions cần hiệu chỉnh sau map run.
- K08 P2: duplicate ShippingBoxWidth header chưa làm rõ.
