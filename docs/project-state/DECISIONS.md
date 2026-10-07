# DECISIONS

- D08: Production dùng GitHub + Cloudflare; không Lovable, không VPS.
- D09: Runtime production hiện dùng Cloudflare D1.
- D10: 100% đơn có COD; amount hiện derived từ tổng UnitCost cho đến khi OMS có trường authoritative.
- D11: PII không commit lên GitHub; dữ liệu thật chỉ nạp sau Cloudflare Access.
- D12: Route production chuyển từ district heuristic sang Google Maps Platform: Geocoding API + Routes API Compute Route Matrix.
- D13: Assignment map-aware dùng 2 tầng: spatial clustering theo tọa độ/hướng để tránh ghép điểm ngược nhau, sau đó tối ưu stop sequence bằng road-time matrix.
- D14: Google API key chỉ lưu dưới dạng Cloudflare Secret `GOOGLE_MAPS_API_KEY`, không commit GitHub.
- D15: Geocode/cache dùng TTL ngắn cho ngày vận hành; map result chưa được coi là truth nếu provider/config chưa verified.
- D16: Heuristic cũ được giữ làm baseline/fallback và phải gắn nhãn rõ, không được hiển thị như route-optimized result.
