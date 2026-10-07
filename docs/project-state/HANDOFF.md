# HANDOFF

## Active blocker

Google API key đang bị `429 RESOURCE_EXHAUSTED`.

Provider diagnostic:
- consumer: `projects/675960534045`;
- quota: `V4GeocodeAddressPerDayPerProject`;
- Google backend quota_limit_value: `100`.

Cloud Console screenshot của user hiển thị:
- `v4 GeocodeAddress requests per day` = 1,500;
- current usage = 170.

## Không retry thêm cho tới khi xác minh

1. Kiểm Project info trong Google Cloud: Project number có phải `675960534045` hay không.
2. Nếu đúng: chờ quota override propagate rồi kiểm provider diagnostic lại.
3. Nếu khác: API key trong Cloudflare thuộc project khác; cần tạo/copy key đúng project hoặc tăng quota ở consumer project `675960534045`.
4. Sau khi provider diagnostic không còn 429: retry quota records, rồi tiếp tục pending geocode.
