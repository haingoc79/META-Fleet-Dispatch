# META Fleet Dispatch

Hệ thống điều phối giao hàng và đội xe nội bộ META.vn.

## Production target

- GitHub: `haingoc79/META-Fleet-Dispatch`
- Cloudflare Workers + Static Assets
- Cloudflare D1
- Cloudflare Access
- Custom domain: `giaohang.meta.shopping`

Không commit file Excel vận hành, địa chỉ khách hàng hoặc database runtime vào repository. Workbook được upload sau khi ứng dụng đã được Cloudflare Access bảo vệ.

## Trạng thái hiện tại

Source Cloudflare-native đã có:
- import workbook browser-side;
- COD bắt buộc cho mọi đơn;
- bảng đơn hàng;
- tab **Kết quả phân đơn** theo nhân sự → chuyến → stop → order;
- shadow dispatch v2 + feasibility assumptions;
- D1 persistence schema được tạo tự động khi Worker có binding `DB`.

## Thiết lập production

1. Tạo D1 database tên `meta-fleet-dispatch-prod`, Location tự động gần nhất.
2. Lấy UUID của database và thay `__D1_DATABASE_ID__` trong `wrangler.template.jsonc`.
3. Lưu thành `wrangler.jsonc`.
4. Cloudflare Workers & Pages → Create application → Import repository → chọn repo này.
5. Build command: `npm run build`.
6. Deploy command: `npx wrangler deploy`.
7. Bật Cloudflare Access cho toàn Worker/custom domain trước khi upload dữ liệu thật.
8. Mở `https://giaohang.meta.shopping/healthz`.
9. Nạp workbook hôm nay trong tab **Nạp dữ liệu** rồi chạy **Gợi ý phân bổ**.

## COD

100% đơn có `cod_required=true`. Hiện `cod_amount_due_vnd` được suy từ tổng `UnitCost` của các dòng sản phẩm thuộc đơn và phải được coi là nguồn tạm thời cho đến khi OMS cung cấp trường COD authoritative.

## Data quality

Nguồn Excel hiện có duplicate header kích thước; hệ thống giữ cách đọc theo vị trí cột và không tự khẳng định cột thứ ba là Height.
