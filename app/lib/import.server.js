// Import: update existing products, create new ones, and undo a whole import.
// Before every change the product's current values are saved so the import can be undone.
import { getBackups, saveBackup } from "../db.server";
import { METAFIELD_COLUMN_RE } from "./product-format";

// ── helpers ─────────────────────────────────────────────────────────────────
export const str = (v) => (v == null ? "" : String(v).trim());
export const firstFilled = (rows, col) => rows.map((r) => str(r[col])).find(Boolean) || "";
const toStatus = (v) => {
  const s = str(v).toUpperCase();
  return ["ACTIVE", "DRAFT", "ARCHIVED"].includes(s) ? s : "";
};
const toTags = (v) => str(v).split(",").map((t) => t.trim()).filter(Boolean);
const toMoney = (v) => {
  const s = str(v).replace(/[^0-9.]/g, "");
  return s && Number.isFinite(Number(s)) ? Number(s).toFixed(2) : "";
};
const toInt = (v) => {
  const s = str(v);
  return s !== "" && Number.isFinite(Number(s)) ? Math.trunc(Number(s)) : null;
};
const splitImages = (v) => str(v).split(/[\n,]+/).map((u) => u.trim()).filter((u) => /^https?:\/\//i.test(u));
const isDefaultVariant = (t) => !t || t.toLowerCase() === "default title";
// Images already hosted by Shopify came from an export — don't add them again.
const isShopifyHosted = (url) => /cdn\.shopify\.com|shopifycdn/i.test(url);

// Checks that each image URL actually returns an image, so Shopify doesn't
// end up with "Media processing failed" placeholders. Returns { ok, broken }.
export async function checkImageUrls(urls) {
  const results = await Promise.all(
    urls.map(async (url) => {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 8000);
        let res = await fetch(url, { method: "HEAD", redirect: "follow", signal: ctrl.signal });
        if (res.status === 405 || res.status === 403) {
          res = await fetch(url, { method: "GET", redirect: "follow", signal: ctrl.signal });
        }
        clearTimeout(timer);
        const type = res.headers.get("content-type") || "";
        return res.ok && type.startsWith("image/") ? { url, ok: true } : { url, ok: false };
      } catch {
        return { url, ok: false };
      }
    }),
  );
  return { ok: results.filter((r) => r.ok).map((r) => r.url), broken: results.filter((r) => !r.ok).map((r) => r.url) };
}

async function gql(admin, query, variables) {
  const res = await admin.graphql(query, { variables });
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join(", "));
  return json.data;
}
const userErrors = (errs, prefix = "") => {
  if (errs?.length) throw new Error(prefix + errs.map((e) => e.message).join(", "));
};

// ── GraphQL ─────────────────────────────────────────────────────────────────
const SNAPSHOT = `#graphql
  query snapshot($id: ID!, $locationId: ID!, $withInventory: Boolean!) {
    product(id: $id) {
      id title vendor productType descriptionHtml handle status tags
      metafields(first: 50) { nodes { namespace key type value } }
      variants(first: 250) {
        nodes {
          id title sku price compareAtPrice barcode
          inventoryItem {
            id
            inventoryLevel(locationId: $locationId) @include(if: $withInventory) {
              quantities(names: ["available"]) { name quantity }
            }
          }
        }
      }
    }
  }
`;
const PRODUCT_UPDATE = `#graphql
  mutation productUpdate($product: ProductUpdateInput!, $media: [CreateMediaInput!]) {
    productUpdate(product: $product, media: $media) {
      product { id }
      userErrors { field message }
    }
  }
`;
const VARIANTS_BULK_UPDATE = `#graphql
  mutation variantsUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants { id }
      userErrors { field message }
    }
  }
`;
const INVENTORY_SET = `#graphql
  mutation inventorySet($input: InventorySetQuantitiesInput!) {
    inventorySetQuantities(input: $input) {
      inventoryAdjustmentGroup { id }
      userErrors { field message }
    }
  }
`;
const METAFIELDS_SET = `#graphql
  mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id }
      userErrors { field message }
    }
  }
`;
const PRODUCT_SET = `#graphql
  mutation productSet($input: ProductSetInput!) {
    productSet(input: $input, synchronous: true) {
      product { id }
      userErrors { field message }
    }
  }
`;
const PRODUCT_DELETE = `#graphql
  mutation productDelete($input: ProductDeleteInput!) {
    productDelete(input: $input) {
      deletedProductId
      userErrors { field message }
    }
  }
`;
export const LOCATIONS = `#graphql
  query locations {
    locations(first: 50, includeLegacy: false) { nodes { id name isActive } }
  }
`;

// ── field mapping ───────────────────────────────────────────────────────────
function productFields(rows) {
  const f = {};
  const set = (key, value) => { if (value !== "" && value != null) f[key] = value; };
  set("title", firstFilled(rows, "Title"));
  set("vendor", firstFilled(rows, "Vendor"));
  set("productType", firstFilled(rows, "Product Type"));
  set("descriptionHtml", firstFilled(rows, "Description"));
  set("handle", firstFilled(rows, "Handle"));
  set("status", toStatus(firstFilled(rows, "Status")));
  const tags = firstFilled(rows, "Tags");
  if (tags) f.tags = toTags(tags);
  const seoTitle = firstFilled(rows, "SEO Title");
  const seoDesc = firstFilled(rows, "SEO Description");
  if (seoTitle || seoDesc) f.seo = { ...(seoTitle && { title: seoTitle }), ...(seoDesc && { description: seoDesc }) };
  return f;
}

function metafieldsFromRows(rows) {
  const out = [];
  const cols = Object.keys(rows[0] ?? {});
  for (const col of cols) {
    const m = col.match(METAFIELD_COLUMN_RE);
    if (!m) continue;
    const value = firstFilled(rows, col);
    if (value) out.push({ namespace: m[1], key: m[2], type: m[3], value });
  }
  return out;
}

function variantValues(row) {
  const v = {};
  const price = toMoney(row["Variant Price"]);
  const compareAt = toMoney(row["Compare At Price"]);
  const barcode = str(row["Barcode"]);
  if (price) v.price = price;
  if (compareAt) v.compareAtPrice = compareAt;
  if (barcode) v.barcode = barcode;
  return v;
}

function matchVariant(existing, row) {
  const sku = str(row["Variant SKU"]).toLowerCase();
  const title = str(row["Variant Title"]).toLowerCase();
  return (
    (sku && existing.find((v) => (v.sku || "").toLowerCase() === sku)) ||
    (title && existing.find((v) => v.title.toLowerCase() === title)) ||
    (existing.length === 1 && isDefaultVariant(title) ? existing[0] : null)
  );
}

const availableQty = (v) => v.inventoryItem?.inventoryLevel?.quantities?.[0]?.quantity ?? null;

// ── update an existing product ──────────────────────────────────────────────
export async function updateProduct(admin, group, opts) {
  const { jobId, locationId, updateInventory, addImages } = opts;
  const withInventory = Boolean(updateInventory && locationId);
  const snap = (
    await gql(admin, SNAPSHOT, { id: group.existingId, locationId: locationId || "gid://shopify/Location/0", withInventory })
  ).product;
  if (!snap) throw new Error("Product no longer exists");
  const variants = snap.variants.nodes;
  const mfs = metafieldsFromRows(group.rows).map((m) => ({ ...m, ownerId: snap.id }));
  const mfKeys = new Set(mfs.map((m) => `${m.namespace}.${m.key}`));

  const stats = { variants: 0, inventory: 0, images: 0, metafields: 0, brokenImages: 0 };

  // Backup before changing anything (only the metafields this import touches).
  await saveBackup(jobId, snap.id, "update", {
    product: {
      title: snap.title, vendor: snap.vendor, productType: snap.productType,
      descriptionHtml: snap.descriptionHtml, handle: snap.handle, status: snap.status, tags: snap.tags,
    },
    variants: variants.map((v) => ({
      id: v.id, sku: v.sku, price: v.price, compareAtPrice: v.compareAtPrice, barcode: v.barcode,
      inventoryItemId: v.inventoryItem?.id, available: withInventory ? availableQty(v) : null,
    })),
    metafields: snap.metafields.nodes.filter((m) => mfKeys.has(`${m.namespace}.${m.key}`)),
    locationId: withInventory ? locationId : null,
  });

  // Product fields + optional new images.
  const fields = productFields(group.rows);
  let media = [];
  if (addImages) {
    const candidates = splitImages(firstFilled(group.rows, "Image URLs")).filter((u) => !isShopifyHosted(u)).slice(0, 10);
    const { ok, broken } = await checkImageUrls(candidates);
    stats.brokenImages = broken.length;
    media = ok.map((url) => ({ originalSource: url, mediaContentType: "IMAGE" }));
  }
  if (Object.keys(fields).length || media.length) {
    const d = await gql(admin, PRODUCT_UPDATE, { product: { id: snap.id, ...fields }, media: media.length ? media : null });
    userErrors(d.productUpdate?.userErrors);
    stats.images = media.length;
  }

  // Variant price / compare-at / barcode / SKU.
  const variantUpdates = [];
  const inventory = [];
  for (const row of group.rows) {
    const match = matchVariant(variants, row);
    if (!match) continue;
    const input = { id: match.id, ...variantValues(row) };
    const sku = str(row["Variant SKU"]);
    if (sku && sku !== match.sku) input.inventoryItem = { sku };
    if (Object.keys(input).length > 1) variantUpdates.push(input);

    const qty = toInt(row["Inventory Qty"]);
    if (withInventory && qty != null && match.inventoryItem?.id) {
      const current = availableQty(match);
      if (current == null) throw new Error(`Variant "${match.title}" isn't stocked at the selected location`);
      if (current !== qty) {
        inventory.push({ inventoryItemId: match.inventoryItem.id, locationId, quantity: qty, changeFromQuantity: current });
      }
    }
  }
  if (variantUpdates.length) {
    const d = await gql(admin, VARIANTS_BULK_UPDATE, { productId: snap.id, variants: variantUpdates });
    userErrors(d.productVariantsBulkUpdate?.userErrors, "Variants: ");
    stats.variants = variantUpdates.length;
  }
  if (inventory.length) {
    const d = await gql(admin, INVENTORY_SET, {
      input: { name: "available", reason: "correction", quantities: inventory },
    });
    userErrors(d.inventorySetQuantities?.userErrors, "Inventory: ");
    stats.inventory = inventory.length;
  }

  // Metafields.
  if (mfs.length) {
    const d = await gql(admin, METAFIELDS_SET, { metafields: mfs });
    userErrors(d.metafieldsSet?.userErrors, "Metafields: ");
    stats.metafields = mfs.length;
  }
  return stats;
}

// ── create a new product ────────────────────────────────────────────────────
export function buildProductSetInput(group, { newStatus, locationId }) {
  const { rows } = group;
  const fields = productFields(rows);
  if (!fields.title) throw new Error("A Title is required to create a product");
  fields.status = newStatus === "FILE" ? fields.status || "DRAFT" : newStatus === "ACTIVE" ? "ACTIVE" : "DRAFT";

  const seen = new Set();
  const variantRows = rows.filter((r) => {
    const key = str(r["Variant Title"]).toLowerCase() || "default title";
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const single = variantRows.length === 1 && isDefaultVariant(str(variantRows[0]["Variant Title"]));
  const parts = variantRows.map((r) =>
    single ? ["Default Title"] : str(r["Variant Title"]).split(" / ").map((p) => p.trim() || "-"),
  );
  const optionCount = Math.min(3, Math.max(...parts.map((p) => p.length)));
  const optionNames = single
    ? ["Title"]
    : Array.from({ length: optionCount }, (_, i) => firstFilled(rows, `Option${i + 1} Name`) || `Option ${i + 1}`);

  const productOptions = optionNames.map((name, i) => ({
    name,
    values: [...new Set(parts.map((p) => p[i] ?? "-"))].map((v) => ({ name: v })),
  }));

  const variants = variantRows.map((row, idx) => {
    const v = {
      optionValues: optionNames.map((name, i) => ({ optionName: name, name: parts[idx][i] ?? "-" })),
      price: toMoney(row["Variant Price"]) || toMoney(row["Min Price"]) || "0.00",
      ...variantValues(row),
    };
    const sku = str(row["Variant SKU"]);
    if (sku) v.sku = sku;
    const qty = toInt(row["Inventory Qty"]);
    if (locationId && qty != null) v.inventoryQuantities = [{ locationId, name: "available", quantity: qty }];
    return v;
  });

  const input = { ...fields, productOptions, variants };
  const images = splitImages(firstFilled(rows, "Image URLs"));
  if (images.length) input.files = images.slice(0, 10).map((url) => ({ originalSource: url, contentType: "IMAGE" }));
  const mfs = metafieldsFromRows(rows);
  if (mfs.length) input.metafields = mfs;
  return input;
}

export async function createProduct(admin, group, opts) {
  const input = buildProductSetInput(group, opts);
  let brokenImages = 0;
  if (input.files?.length) {
    const { ok, broken } = await checkImageUrls(input.files.map((f) => f.originalSource));
    brokenImages = broken.length;
    input.files = input.files.filter((f) => ok.includes(f.originalSource));
    if (!input.files.length) delete input.files;
  }
  const d = await gql(admin, PRODUCT_SET, { input });
  userErrors(d.productSet?.userErrors);
  const id = d.productSet?.product?.id;
  if (id) await saveBackup(opts.jobId, id, "create", null);
  return { id, brokenImages };
}

// ── undo ────────────────────────────────────────────────────────────────────
export async function undoImport(admin, jobId) {
  const backups = await getBackups(jobId);
  let restored = 0;
  let deleted = 0;
  const errors = [];

  // Newest first, so a product changed twice ends at its original values.
  for (const b of [...backups].reverse()) {
    try {
      if (b.action === "create") {
        const d = await gql(admin, PRODUCT_DELETE, { input: { id: b.product_id } });
        const errs = d.productDelete?.userErrors ?? [];
        if (errs.length && !/not exist|not found/i.test(errs[0].message)) userErrors(errs);
        deleted += 1;
        continue;
      }
      const { product, variants, metafields, locationId } = b.before;
      const d1 = await gql(admin, PRODUCT_UPDATE, { product: { id: b.product_id, ...product }, media: null });
      userErrors(d1.productUpdate?.userErrors);

      const vInputs = variants.map((v) => ({
        id: v.id, price: v.price, compareAtPrice: v.compareAtPrice, barcode: v.barcode ?? "",
        inventoryItem: { sku: v.sku ?? "" },
      }));
      if (vInputs.length) {
        const d2 = await gql(admin, VARIANTS_BULK_UPDATE, { productId: b.product_id, variants: vInputs });
        userErrors(d2.productVariantsBulkUpdate?.userErrors, "Variants: ");
      }

      if (locationId) {
        const q = variants
          .filter((v) => v.inventoryItemId && v.available != null)
          .map((v) => ({ inventoryItemId: v.inventoryItemId, locationId, quantity: v.available, changeFromQuantity: null }));
        if (q.length) {
          const d3 = await gql(admin, INVENTORY_SET, { input: { name: "available", reason: "correction", quantities: q } });
          userErrors(d3.inventorySetQuantities?.userErrors, "Inventory: ");
        }
      }

      if (metafields?.length) {
        const d4 = await gql(admin, METAFIELDS_SET, {
          metafields: metafields.map((m) => ({ ownerId: b.product_id, namespace: m.namespace, key: m.key, type: m.type, value: m.value })),
        });
        userErrors(d4.metafieldsSet?.userErrors, "Metafields: ");
      }
      restored += 1;
    } catch (err) {
      errors.push({ productId: b.product_id, message: err.message });
    }
  }
  return { restored, deleted, errors };
}
