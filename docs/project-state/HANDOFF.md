# HANDOFF

## Active blocker

Stable Google Geocoding API v3 diagnostic trả:

`REQUEST_DENIED: You must enable Billing on the Google Cloud Project`

Project:
- ID: `white-sign-510904-j5`
- Number: `675960534045`

## User action

Google Cloud → Billing → Linked account cho đúng project:
1. Link project với một active Billing Account.
2. Xác nhận billing account ở trạng thái active.
3. Không tạo key/project mới nữa.

## Sau khi billing linked

1. AI gọi `/api/map/provider-diagnostic`.
2. Chỉ nếu response status = `OK` mới retry 80 quota-blocked.
3. Sau đó tiếp tục 132 pending.
4. Audit geocode/outlier.
5. Chạy map-aware Google Routes shadow.
