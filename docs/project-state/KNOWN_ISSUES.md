# KNOWN_ISSUES

- K01 P1: Google Geocoding v4 daily quota đã hết; 212/382 eligible orders đang `Quota blocked`.
- K02 P1: Map-aware production run chưa chạy; latest 378-order proposal vẫn là heuristic cũ.
- K03 P1: COD amount đang derived từ tổng UnitCost, chưa authoritative từ OMS.
- K04 P1: live negative-write test bằng một Viewer account chưa chạy.
- K05 P2: capacity/shift/SLA vẫn còn planning assumptions.
- K06 P2: planning radius map hiện là assumption (motorbike 60 km, auto 120 km), cần hiệu chỉnh sau map run.
- K07 P2: duplicate ShippingBoxWidth header trong workbook nguồn chưa làm rõ.
- K08 P2: full production acceptance/concurrency/recovery chưa hoàn tất.
