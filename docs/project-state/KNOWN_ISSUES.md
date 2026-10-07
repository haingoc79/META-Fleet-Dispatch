# KNOWN_ISSUES

- K01 P1: Google Maps backend chưa công nhận Billing enabled cho project `white-sign-510904-j5`; stable Geocoding v3 trả `REQUEST_DENIED`.
- K02 P1: Map-aware production run chưa chạy; geocode state hiện 170 OK / 80 blocked cũ / 132 pending.
- K03 P1: latest 378-order proposal vẫn là heuristic cũ, không dùng làm route plan cuối.
- K04 P1: COD amount derived từ tổng UnitCost, chưa authoritative từ OMS.
- K05 P1: live negative-write test bằng Viewer chưa chạy.
- K06 P2: capacity/shift/SLA vẫn là planning assumptions.
- K07 P2: map radius assumptions cần hiệu chỉnh sau map run.
- K08 P2: duplicate ShippingBoxWidth header chưa làm rõ.
