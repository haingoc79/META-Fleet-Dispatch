# HANDOFF

## Current blocker

Google Geocoding v4 daily quota đã hết sau 170/382 order geocodes.
212 order còn lại đều `GEOCODE_API_429`; không có lỗi địa chỉ khác được ghi nhận.

## User action

Google Cloud project `white-sign-510904-j5`:
1. Google Maps Platform → Quotas.
2. Chọn Geocoding API.
3. Tăng `v4 GeocodeAddress requests per day` đủ cho daily volume + retry headroom.
4. Nên dùng daily cap/cost alert thay vì quota quá thấp.

## Sau khi quota tăng

1. `giaohang.meta.shopping` → Bản đồ & tuyến.
2. Bấm **Retry đơn bị quota**.
3. Không chạy lại 170 đơn đã thành công.
4. Khi `Quota blocked=0`, audit geocode/outlier.
5. Chỉ khi `routeReady=true` mới chạy **Tối ưu theo bản đồ**.
