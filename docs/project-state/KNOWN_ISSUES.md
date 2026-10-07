# KNOWN_ISSUES

- K01 P1: `GOOGLE_MAPS_API_KEY` chưa được cấu hình; map-aware production chưa chạy.
- K02 P1: địa chỉ depot HCM và Hà Nội chưa được cấu hình/xác minh.
- K03 P1: latest 378-order proposal là heuristic cũ, có route zig-zag/điểm rất xa; không dùng làm route plan cuối.
- K04 P1: COD amount đang derived từ tổng UnitCost, chưa authoritative từ OMS.
- K05 P1: live negative-write test bằng một Viewer account chưa chạy.
- K06 P2: capacity/shift/SLA vẫn còn planning assumptions.
- K07 P2: planning radius map hiện là assumption (motorbike 60 km, auto 120 km) và cần hiệu chỉnh theo vùng vận hành thật.
- K08 P2: duplicate ShippingBoxWidth header trong workbook nguồn chưa làm rõ.
- K09 P2: full production acceptance/concurrency/recovery chưa hoàn tất.
