# Shopify App Store listing — Bulk Migration & VIP Pricing

Copy each section into the matching field in Partners → Distribution → Manage submission.
Character limits shown are Shopify's limits as known at writing; the form shows the live limit.

---

## App name
Bulk Migration & VIP Pricing

## App card subtitle (short tagline, ~62 chars)
Bulk edit products in Excel and auto-discount VIP customers

## App introduction (~100 chars)
Bulk-edit products in Excel and give VIP customers automatic prices at checkout.

## App details (~500 chars)
Update hundreds of products in minutes. Export your catalog — titles, variants, SKUs, prices, inventory, tags, images and SEO — to an Excel file, edit it, and upload it back. Every change is previewed before anything is saved, so you stay in control.

Reward loyal shoppers with VIP discounts. Tag customers as VIP and they automatically see their discount in cart and checkout — no codes to share. Choose the discount, preview the discounted amount per product, and switch it on with one click.

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
Title tag (max 60): Bulk Migration & VIP Pricing – Excel Product Editor
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
- Privacy policy: https://public.130-210-71-11.sslip.io/privacy
- Terms of service: https://public.130-210-71-11.sslip.io/terms
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
No login or extra setup is needed. The app is free.

1. Install the app. It opens to the Dashboard with store stats.
2. Export: Export products → choose columns → "Export N products".
   An .xlsx file downloads (products are fetched in batches with progress).
3. Import: open the exported file, change a product Title, save.
   Import products → upload the file → review "Will update" →
   "Update N products" → confirm. The title changes in Products.
4. VIP pricing: VIP pricing → enter a discount (e.g. 20) →
   "Activate auto-pricing". A Shopify Function discount
   "VIP-AUTO-FUNCTION" is created.
   To see it apply: tag a customer with vip_customer, log in as that
   customer on the storefront, add a product to cart — the VIP
   discount appears in cart/checkout.
5. Optional storefront block: Online Store → Customize → add the
   "VIP price" app block to the product page.

Privacy webhooks (customers/data_request, customers/redact,
shop/redact) are handled at /webhooks/compliance.
Contact: info@letvarsolution.com
```

---

## Desktop screenshots (upload in this order)
Folder: app-store-assets/screenshots/ — all 1600x900 PNG

| # | File | Image alt text (max 64 chars) |
|---|------|-------------------------------|
| 1 | 01-dashboard.png | Dashboard with store overview and quick actions |
| 2 | 02-export.png | Choose products and columns to export to Excel |
| 3 | 03-vip-pricing.png | Set an automatic VIP discount and preview each product |
| 4 | 04-import.png | Upload an edited Excel or CSV file to update products |
| 5 | 05-help.png | Help center with FAQs, guides and support contact |

## Feature media
File: feature-1600x900.png
Alt text: Spreadsheet showing product prices and automatic VIP discounted prices

## Assets checklist
- [x] App icon 1200×1200 — app-icon-1200.png
- [x] Navigation icon 16×16 SVG — nav-icon-16.svg
- [x] Screenshots 1600×900 — screenshots/ (5 files)
- [ ] Demo screencast (2–3 min, install → export → import → VIP pricing), upload to YouTube/Vimeo (unlisted is fine)
- [ ] Emergency developer contact (phone + email) in Partners settings
