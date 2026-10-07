# HANDOFF

## Trạng thái

Production app live, Access/D1/import/RBAC PASS.
Tên sản phẩm đã live.
Map-aware code đã deploy và CI PASS nhưng chưa có Google Maps key/depot nên chưa gọi dữ liệu bản đồ thật.

## Việc cần cấu hình ngoài AI

1. Google Cloud:
   - bật billing cho project;
   - enable **Geocoding API**;
   - enable **Routes API**;
   - tạo API key và restrict key chỉ cho 2 API này.
2. Cloudflare Worker `meta-fleet-dispatch`:
   - Settings → Variables and secrets → Add variable;
   - type = Secret;
   - name = `GOOGLE_MAPS_API_KEY`;
   - value = API key;
   - Deploy.
3. `giaohang.meta.shopping` → **Bản đồ & tuyến**:
   - nhập địa chỉ điểm xuất phát HCM;
   - nhập địa chỉ điểm xuất phát Hà Nội;
   - Lưu điểm xuất phát;
   - Chuẩn hóa địa chỉ.
4. Chỉ khi `routeReady=true`: chạy **Tối ưu theo bản đồ**.

## Acceptance sau cấu hình

- geocode count + failures;
- outlier/review orders;
- route matrix errors;
- route km/min;
- route không zig-zag bất hợp lý;
- 2-wheel/drive mode;
- assignment counts/COD/products;
- so sánh với heuristic baseline;
- chỉ sau đó mới cân nhắc commit assignment.
