// Shared (browser + server) product sheet format: export columns, flattening,
// Shopify CSV export, and Shopify CSV → app format normalisation for import.

export const FIELD_GROUPS = [
  {
    group: "Basic Info",
    fields: [
      { key: "title", label: "Product Title", always: true },
      { key: "vendor", label: "Vendor" },
      { key: "productType", label: "Product Type" },
      { key: "status", label: "Status" },
      { key: "handle", label: "Handle / URL Slug" },
      { key: "description", label: "Description" },
      { key: "createdAt", label: "Created At" },
      { key: "updatedAt", label: "Updated At" },
    ],
  },
  {
    group: "Pricing",
    fields: [
      { key: "priceMin", label: "Min Price" },
      { key: "priceMax", label: "Max Price" },
    ],
  },
  {
    group: "Variants",
    fields: [
      { key: "variants_title", label: "Variant Title & options" },
      { key: "variants_sku", label: "Variant SKUs" },
      { key: "variants_price", label: "Variant Prices" },
      { key: "variants_compareAtPrice", label: "Compare At Prices" },
      { key: "variants_inventory", label: "Variant Inventory" },
      { key: "variants_barcode", label: "Barcode" },
      { key: "variants_weight", label: "Weight" },
    ],
  },
  {
    group: "Organisation",
    fields: [
      { key: "tags", label: "Tags" },
      { key: "collections", label: "Collections" },
      { key: "totalInventory", label: "Total Inventory" },
    ],
  },
  { group: "Media", fields: [{ key: "images", label: "Image URLs" }] },
  {
    group: "SEO & metafields",
    fields: [
      { key: "seo_title", label: "SEO Title" },
      { key: "seo_description", label: "SEO Description" },
      { key: "metafields", label: "Product metafields" },
    ],
  },
];

export const ALL_OPTIONAL_KEYS = FIELD_GROUPS.flatMap((g) => g.fields.filter((f) => !f.always).map((f) => f.key));
export const DEFAULT_FIELDS = [
  "vendor", "productType", "status", "handle", "tags", "images", "priceMin", "priceMax",
  "variants_title", "variants_sku", "variants_price", "variants_inventory", "collections",
];

const VARIANT_KEYS = ALL_OPTIONAL_KEYS.filter((k) => k.startsWith("variants_"));

// Fixed column order; metafield columns are appended dynamically.
const COLUMN_ORDER = [
  ["title", "Title"], ["handle", "Handle"], ["vendor", "Vendor"], ["productType", "Product Type"],
  ["status", "Status"], ["description", "Description"], ["createdAt", "Created At"], ["updatedAt", "Updated At"],
  ["priceMin", "Min Price"], ["priceMax", "Max Price"],
  ["variants_title", "Option1 Name"], ["variants_title", "Option2 Name"], ["variants_title", "Option3 Name"],
  ["variants_title", "Variant Title"], ["variants_sku", "Variant SKU"], ["variants_price", "Variant Price"],
  ["variants_compareAtPrice", "Compare At Price"], ["variants_inventory", "Inventory Qty"],
  ["variants_barcode", "Barcode"], ["variants_weight", "Weight"],
  ["tags", "Tags"], ["collections", "Collections"], ["totalInventory", "Total Inventory"],
  ["images", "Image URLs"], ["seo_title", "SEO Title"], ["seo_description", "SEO Description"],
];

export const metafieldColumn = (m) => `Metafield: ${m.namespace}.${m.key} [${m.type}]`;
export const METAFIELD_COLUMN_RE = /^Metafield: ([^.]+)\.(.+) \[(.+)\]$/;

const nodes = (conn) => conn?.nodes ?? (conn?.edges ?? []).map((e) => e.node);

function flattenProduct(p, has) {
  const base = {};
  const set = (key, col, value) => { if (has(key)) base[col] = value ?? ""; };
  set("title", "Title", p.title);
  set("handle", "Handle", p.handle);
  set("vendor", "Vendor", p.vendor);
  set("productType", "Product Type", p.productType);
  set("status", "Status", p.status);
  set("description", "Description", p.descriptionHtml ?? p.description);
  set("createdAt", "Created At", p.createdAt ? new Date(p.createdAt).toISOString() : "");
  set("updatedAt", "Updated At", p.updatedAt ? new Date(p.updatedAt).toISOString() : "");
  set("priceMin", "Min Price", p.priceRange?.minVariantPrice?.amount);
  set("priceMax", "Max Price", p.priceRange?.maxVariantPrice?.amount);
  set("tags", "Tags", Array.isArray(p.tags) ? p.tags.join(", ") : p.tags);
  set("collections", "Collections", nodes(p.collections).map((c) => c.title).join(", "));
  set("totalInventory", "Total Inventory", p.totalInventory);
  set("images", "Image URLs", nodes(p.images).map((i) => i.url).join("\n"));
  set("seo_title", "SEO Title", p.seo?.title);
  set("seo_description", "SEO Description", p.seo?.description);
  if (has("variants_title")) {
    (p.options ?? []).slice(0, 3).forEach((o, i) => {
      if (o.name !== "Title") base[`Option${i + 1} Name`] = o.name;
    });
  }
  if (has("metafields")) {
    for (const m of nodes(p.metafields)) base[metafieldColumn(m)] = m.value;
  }

  const variants = nodes(p.variants);
  if (!VARIANT_KEYS.some(has) || !variants.length) return [base];

  return variants.map((v) => {
    const row = { ...base };
    if (has("variants_title")) row["Variant Title"] = v.title ?? "";
    if (has("variants_sku")) row["Variant SKU"] = v.sku ?? "";
    if (has("variants_price")) row["Variant Price"] = v.price ?? "";
    if (has("variants_compareAtPrice")) row["Compare At Price"] = v.compareAtPrice ?? "";
    if (has("variants_inventory")) row["Inventory Qty"] = v.inventoryQuantity ?? "";
    if (has("variants_barcode")) row["Barcode"] = v.barcode ?? "";
    if (has("variants_weight")) {
      const w = v.inventoryItem?.measurement?.weight;
      row["Weight"] = w ? `${w.value} ${w.unit}` : "";
    }
    return row;
  });
}

/** App format: returns { columns, rows } ready for a sheet. */
export function buildAppSheet(products, selectedFields) {
  const sel = new Set(selectedFields);
  const has = (k) => k === "title" || sel.has(k);
  const rows = products.flatMap((p) => flattenProduct(p, has));
  const present = new Set(rows.flatMap((r) => Object.keys(r)));
  const columns = COLUMN_ORDER.filter(([k, col]) => has(k) && (present.has(col) || !col.startsWith("Option"))).map(([, c]) => c);
  const mfCols = [...present].filter((c) => METAFIELD_COLUMN_RE.test(c)).sort();
  const all = [...new Set([...columns, ...mfCols])];
  return { columns: all, rows: rows.map((r) => Object.fromEntries(all.map((c) => [c, r[c] ?? ""]))) };
}

// ── Shopify's own product CSV format ─────────────────────────────────────────
export const SHOPIFY_CSV_COLUMNS = [
  "Handle", "Title", "Body (HTML)", "Vendor", "Type", "Tags", "Published",
  "Option1 Name", "Option1 Value", "Option2 Name", "Option2 Value", "Option3 Name", "Option3 Value",
  "Variant SKU", "Variant Inventory Qty", "Variant Price", "Variant Compare At Price", "Variant Barcode",
  "Image Src", "Image Position", "SEO Title", "SEO Description", "Status",
];

/** Shopify CSV: first row of a product carries product fields; extra rows carry variants/images. */
export function buildShopifyCsvRows(products) {
  const out = [];
  for (const p of products) {
    const variants = nodes(p.variants);
    const images = nodes(p.images).map((i) => i.url);
    const options = (p.options ?? []).slice(0, 3);
    const count = Math.max(variants.length, images.length, 1);
    for (let i = 0; i < count; i++) {
      const v = variants[i];
      const row = Object.fromEntries(SHOPIFY_CSV_COLUMNS.map((c) => [c, ""]));
      row["Handle"] = p.handle;
      if (i === 0) {
        Object.assign(row, {
          Title: p.title, "Body (HTML)": p.descriptionHtml ?? p.description ?? "", Vendor: p.vendor ?? "",
          Type: p.productType ?? "", Tags: (p.tags ?? []).join(", "),
          Published: p.status === "ACTIVE" ? "TRUE" : "FALSE",
          "SEO Title": p.seo?.title ?? "", "SEO Description": p.seo?.description ?? "",
          Status: (p.status ?? "").toLowerCase(),
        });
        options.forEach((o, n) => { row[`Option${n + 1} Name`] = o.name; });
      }
      if (v) {
        const parts = (v.selectedOptions ?? []).map((o) => o.value);
        parts.slice(0, 3).forEach((val, n) => { row[`Option${n + 1} Value`] = val; });
        Object.assign(row, {
          "Variant SKU": v.sku ?? "", "Variant Inventory Qty": v.inventoryQuantity ?? "",
          "Variant Price": v.price ?? "", "Variant Compare At Price": v.compareAtPrice ?? "",
          "Variant Barcode": v.barcode ?? "",
        });
      }
      if (images[i]) Object.assign(row, { "Image Src": images[i], "Image Position": i + 1 });
      out.push(row);
    }
  }
  return out;
}

const isShopifyCsv = (cols) => cols.includes("Handle") && (cols.includes("Body (HTML)") || cols.includes("Option1 Value"));

/**
 * Converts Shopify product CSV rows into this app's column names so the import
 * logic handles both. Returns { rows, format }.
 */
export function normalizeImportRows(rows) {
  const cols = Object.keys(rows[0] ?? {});
  if (!isShopifyCsv(cols)) return { rows, format: "app" };

  const imagesByHandle = new Map();
  for (const r of rows) {
    const h = String(r["Handle"] ?? "").trim().toLowerCase();
    const src = String(r["Image Src"] ?? "").trim();
    if (h && src) imagesByHandle.set(h, [...(imagesByHandle.get(h) ?? []), src]);
  }

  const out = [];
  for (const r of rows) {
    const values = [1, 2, 3].map((n) => String(r[`Option${n} Value`] ?? "").trim()).filter(Boolean);
    const hasVariant = values.length || r["Variant SKU"] || r["Variant Price"];
    const isFirst = Boolean(String(r["Title"] ?? "").trim());
    if (!hasVariant && !isFirst) continue; // image-only row
    const h = String(r["Handle"] ?? "").trim();
    const row = {
      Handle: h,
      Title: r["Title"] ?? "",
      Description: r["Body (HTML)"] ?? "",
      Vendor: r["Vendor"] ?? "",
      "Product Type": r["Type"] ?? "",
      Tags: r["Tags"] ?? "",
      Status: r["Status"] ? String(r["Status"]).toUpperCase() : "",
      "SEO Title": r["SEO Title"] ?? "",
      "SEO Description": r["SEO Description"] ?? "",
      "Variant Title": values.join(" / "),
      "Variant SKU": r["Variant SKU"] ?? "",
      "Variant Price": r["Variant Price"] ?? "",
      "Compare At Price": r["Variant Compare At Price"] ?? "",
      Barcode: r["Variant Barcode"] ?? "",
      "Inventory Qty": r["Variant Inventory Qty"] ?? "",
    };
    [1, 2, 3].forEach((n) => { if (r[`Option${n} Name`]) row[`Option${n} Name`] = r[`Option${n} Name`]; });
    if (isFirst) row["Image URLs"] = (imagesByHandle.get(h.toLowerCase()) ?? []).join("\n");
    out.push(row);
  }
  return { rows: out, format: "shopify" };
}
