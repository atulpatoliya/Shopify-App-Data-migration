# Shopify App Store listing — Bulk Migration & VIP Discounts

Copy each section into the matching field in Partners → Distribution → Manage submission.
Character limits shown are Shopify's limits as known at writing; the form shows the live limit.

---

## App name
Bulk Migration & VIP Discounts

## App card subtitle (short tagline, ~62 chars)
Bulk edit products in Excel and auto-discount VIP customers

## App introduction (~100 chars)
Bulk-edit products in Excel and give VIP customers automatic prices at checkout.

## App details (~500 chars)
Export your catalog — titles, variants, SKUs, prices, stock, images, SEO and metafields — to Excel or Shopify CSV, edit it, and upload it back. New rows become new products and existing ones are updated. Every change is previewed first and backed up, so any import can be undone.

Reward loyal shoppers with VIP discounts. Tag customers as VIP and they automatically get their discount in cart and checkout, with no codes to share. Choose the percentage and switch it on with one click.

## Feature list (one per line, ~80 chars each)
- Export products, variants, prices, inventory, images and SEO to Excel
- Bulk update products by uploading an edited Excel or CSV file
- Preview matched and skipped rows before any change is saved
- Automatic VIP discounts for tagged customers in cart and checkout
- Show VIP prices on product pages with a theme app block

## Search terms (up to 5)
- bulk edit products
- excel import export
- product migration
- vip discount
- customer tag discount

## Web search content
Title tag (max 60): Bulk Migration & VIP Discounts – Excel Product Editor
Meta description (max 160): Export products to Excel, bulk edit and upload changes with a safe preview. Give tagged VIP customers automatic discounts in cart and checkout.

## Install requirements
- Sales channel: My app requires → Shopify Online Store (theme app extension for VIP price block)
- Geographic requirements: none

## Categories (suggested)
Primary: Store management → Product management (bulk editor / import & export)
Secondary: Selling products → Pricing / Discounts

## Pricing (Partners → Pricing → Manage → Add public plan)
Plan names must match exactly — the app reads the plan name to set the limit.

| Plan name | Handle | Price | Trial | Plan features (shown on listing) |
|-----------|--------|-------|-------|----------------------------------|
| Free  | free  | $0          | —      | Export/import up to 10 products · VIP discounts |
| Basic | basic | $5 / month  | 7 days | Export/import up to 250 products · VIP discounts |
| Pro   | pro   | $10 / month | 7 days | Export/import up to 2,500 products · VIP discounts |
| Plus  | plus  | $20 / month | 7 days | Unlimited products · VIP discounts |

Redirect URL for every plan: /app

## Key benefits (if the form asks for 3 benefits with images)
1. Save hours on catalog updates — Edit everything in a familiar spreadsheet and upload once.
2. No surprises — See exactly which products will change before you confirm.
3. Reward your best customers — VIP prices apply automatically, no discount codes needed.

## URLs
- Privacy policy: https://migration.letvarsolution.com/privacy
- Terms of service: https://migration.letvarsolution.com/terms
- Support email: info@letvarsolution.com
  (Replace the sslip.io URLs if you move to your own domain.)

## FAQ (if the form has an FAQ section)
**Does import create new products?**
No. Import only updates products that already exist, matched by handle or title.

**Which fields can be imported?**
Title, vendor, product type, status, description, tags and handle. Empty cells are ignored.

**How do customers get VIP discounts?**
Tag a customer with the VIP tag (default `vip_customer`). When they log in, their price applies automatically in cart and checkout.

**Do VIP discounts combine with other discounts?**
No. Automatic VIP discounts don't combine with other product, order or shipping discounts.

**What happens when I uninstall?**
The app's data for your store is deleted. Your products and prices in Shopify are not changed.

---

## Testing instructions for the Shopify reviewer
Paste into "Testing instructions" in the submission form.

```
No login or extra setup is needed. Install the app and it opens in the Shopify admin.

PLANS
Free (10 products), Basic $5 (250), Pro $10 (2,500), Plus $20 (unlimited).
All features are in every plan; only the number of products per export/import changes.
The shopify-test plan has no limit. Plans > "Change plan" opens Shopify's managed pricing page.

1. DASHBOARD
Store product counts, current plan, VIP status and a setup guide.

2. EXPORT
Export products > choose Excel (.xlsx) or Shopify CSV > choose columns > "Export N products".
Products load in batches with progress, then the file downloads.

3. IMPORT (update + create)
Open the exported file, change a product Title, and add a new row with a new Handle and Title. Save.
Import products > upload the file. The preview shows:
- Will update / Will create / Skipped, with price, stock and image status per product
- "View" shows every column from the file, variants and image thumbnails
- Image links are checked; invalid ones are listed under "Image problems" and skipped
Select "Import N products" > confirm. The title changes and the new product is created as Draft.
Optional settings: stock from the "Inventory Qty" column at a chosen location, and adding images to existing products.
Shopify product CSV files from other stores are detected automatically.

4. UNDO
Import history > "Undo" on the import. Updated products get their previous values back and created products are deleted.

5. SCHEDULED EXPORTS
Scheduled exports > tick "Email me a product export automatically" > enter an email > "Send now".
An email with the product file arrives within a minute.

6. VIP DISCOUNTS (Shopify Function)
VIP pricing > enter a discount (e.g. 20) > "Activate auto-pricing".
An automatic app discount "VIP-AUTO-FUNCTION" is created. To see it apply:
 a) Customers > tag a customer with: vip_customer
 b) Log in as that customer on the storefront
 c) Add a product to cart - the VIP discount appears in cart and checkout.
Customers without the tag pay the normal price.

7. VIP PRICE BLOCK (theme app extension)
VIP pricing > "Add VIP block" opens the theme editor on a product page with the block added
(also: Online Store > Themes > Customize > product page > Add block > Apps > "VIP Price Display").
In the editor it shows a sample; on the store only logged-in tagged customers see it.

PRIVACY
Compliance webhooks (customers/data_request, customers/redact, shop/redact) are handled at /webhooks/compliance.
Uninstalling stops scheduled exports and deletes session data; import history and backups are deleted on shop/redact.

Support: info@letvarsolution.com
```

---

## Desktop screenshots (upload in this order)
Folder: app-store-assets/screenshots/ — all 1600x900 PNG. Regenerate with: python make_screenshots.py

| # | File | Image alt text (max 64 chars) |
|---|------|-------------------------------|
| 1 | 01-dashboard.png | Dashboard with store overview, plan and quick actions |
| 2 | 02-export.png | Export to Excel or Shopify CSV with the columns you choose |
| 3 | 04-import-history.png | Import history with one-click undo for every import |
| 4 | 06-vip-pricing.png | Automatic VIP discount for tagged customers |
| 5 | 05-scheduled-exports.png | Email a product export daily or weekly |
| 6 | 07-plans.png | Plans by number of products, all features included |

Not used yet: 03-import.png (empty upload screen — retake with a file loaded to show the preview),
08-help.png (taken before the FAQ update — retake).

## Feature media
File: feature-1600x900.png
Alt text: Spreadsheet showing product prices and automatic VIP discounted prices

## Assets checklist
- [x] App icon 1200×1200 — app-icon-1200.png
- [x] Navigation icon 16×16 SVG — nav-icon-16.svg
- [x] Screenshots 1600×900 — screenshots/ (5 files)
- [ ] Demo screencast (2–3 min, install → export → import → VIP pricing), upload to YouTube/Vimeo (unlisted is fine)
- [ ] Emergency developer contact (phone + email) in Partners settings
