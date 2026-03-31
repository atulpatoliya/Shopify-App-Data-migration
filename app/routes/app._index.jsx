import { useState, useCallback } from "react";
import { useLoaderData, useNavigation, useSubmit } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

// ─────────────────────────────────────────────────────────────────────────────
// SERVER: Loader — fetch products via Admin GraphQL
// ─────────────────────────────────────────────────────────────────────────────
export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  const url    = new URL(request.url);
  const query  = url.searchParams.get("query") || null;

  const statsResponse = await admin.graphql(
    `#graphql
      query getProductStats {
        totalProducts: productsCount {
          count
        }
        activeProducts: productsCount(query: "status:active") {
          count
        }
        draftProducts: productsCount(query: "status:draft") {
          count
        }
      }
    `
  );

  const statsJson = await statsResponse.json();
  if (statsJson.errors) {
    throw new Error(statsJson.errors.map((e) => e.message).join(", "));
  }

  const allProducts = [];
  let hasNextPage = true;
  let after = null;
  let finalPageInfo = { hasNextPage: false, endCursor: null };

  while (hasNextPage) {
    const response = await admin.graphql(
      `#graphql
      query getProducts($first: Int!, $after: String, $query: String) {
        products(first: $first, after: $after, query: $query) {
          pageInfo { hasNextPage endCursor }
          edges {
            node {
              id
              title
              vendor
              productType
              status
              tags
              handle
              createdAt
              updatedAt
              totalInventory
              description
              priceRange {
                minVariantPrice { amount currencyCode }
                maxVariantPrice { amount currencyCode }
              }
              images(first: 5) {
                edges { node { url altText } }
              }
              variants(first: 250) {
                pageInfo { hasNextPage endCursor }
                edges {
                  node {
                    id
                    title
                    sku
                    price
                    compareAtPrice
                    inventoryQuantity
                    barcode
                    inventoryItem {
                      measurement { weight { value unit } }
                    }
                  }
                }
              }
              collections(first: 5) {
                edges { node { title } }
              }
              seo { title description }
            }
          }
        }
      }
    `,
      { variables: { first: 250, after, query } }
    );

    const json = await response.json();

    if (json.errors) {
      throw new Error(json.errors.map((e) => e.message).join(", "));
    }

    const pageProducts = json.data.products.edges.map((e) => e.node);

    // For the rare case of products with more than 250 variants, fetch extra pages
    for (const product of pageProducts) {
      if (product.variants?.pageInfo?.hasNextPage) {
        let variantAfter = product.variants.pageInfo.endCursor;
        let hasMoreVariants = true;
        while (hasMoreVariants) {
          await new Promise((r) => setTimeout(r, 300));
          const varRes = await admin.graphql(
            `#graphql
              query getExtraVariants($id: ID!, $first: Int!, $after: String) {
                product(id: $id) {
                  variants(first: $first, after: $after) {
                    pageInfo { hasNextPage endCursor }
                    edges {
                      node {
                        id title sku price compareAtPrice
                        inventoryQuantity barcode
                        inventoryItem { measurement { weight { value unit } } }
                      }
                    }
                  }
                }
              }
            `,
            { variables: { id: product.id, first: 250, after: variantAfter } }
          );
          const varJson = await varRes.json();
          const extra = varJson.data?.product?.variants;
          if (!extra) break;
          product.variants.edges.push(...extra.edges);
          hasMoreVariants = extra.pageInfo.hasNextPage;
          variantAfter = extra.pageInfo.endCursor;
        }
      }
    }

    allProducts.push(...pageProducts);

    finalPageInfo = json.data.products.pageInfo;
    hasNextPage = Boolean(finalPageInfo.hasNextPage);
    after = finalPageInfo.endCursor;
  }

  return {
    products: allProducts,
    pageInfo: finalPageInfo,
    appliedQuery: query || "",
    productStats: {
      total: statsJson.data.totalProducts?.count ?? 0,
      active: statsJson.data.activeProducts?.count ?? 0,
      draft: statsJson.data.draftProducts?.count ?? 0,
    },
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// FIELD GROUPS
// ─────────────────────────────────────────────────────────────────────────────
const FIELD_GROUPS = [
  {
    group: "Basic Info",
    fields: [
      { key: "title",       label: "Product Title",   always: true },
      { key: "vendor",      label: "Vendor" },
      { key: "productType", label: "Product Type" },
      { key: "status",      label: "Status" },
      { key: "handle",      label: "Handle / URL Slug" },
      { key: "description", label: "Description" },
      { key: "createdAt",   label: "Created At" },
      { key: "updatedAt",   label: "Updated At" },
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
      { key: "variants_title",          label: "Variant Title" },
      { key: "variants_sku",            label: "Variant SKUs" },
      { key: "variants_price",          label: "Variant Prices" },
      { key: "variants_compareAtPrice", label: "Compare At Prices" },
      { key: "variants_inventory",      label: "Variant Inventory" },
      { key: "variants_barcode",        label: "Barcode" },
      { key: "variants_weight",         label: "Weight" },
    ],
  },
  {
    group: "Organisation",
    fields: [
      { key: "tags",           label: "Tags" },
      { key: "collections",    label: "Collections" },
      { key: "totalInventory", label: "Total Inventory" },
    ],
  },
  {
    group: "Media",
    fields: [{ key: "images", label: "Image URLs" }],
  },
  {
    group: "SEO",
    fields: [
      { key: "seo_title",       label: "SEO Title" },
      { key: "seo_description", label: "SEO Description" },
    ],
  },
];

const ALL_OPTIONAL_KEYS = FIELD_GROUPS.flatMap((g) =>
  g.fields.filter((f) => !f.always).map((f) => f.key)
);

const VARIANT_FIELD_KEYS = [
  "variants_title",
  "variants_sku",
  "variants_price",
  "variants_compareAtPrice",
  "variants_inventory",
  "variants_barcode",
  "variants_weight",
];

// ─────────────────────────────────────────────────────────────────────────────
// FLATTEN: one product → one or more Excel rows (one per variant)
// ─────────────────────────────────────────────────────────────────────────────
function flattenProduct(product, selectedFields) {
  const has = (k) => selectedFields.includes(k) || k === "title";
  const hasVariantColumns = VARIANT_FIELD_KEYS.some((k) => selectedFields.includes(k));
  const base = {};

  if (has("title"))          base["Title"]           = product.title ?? "";
  if (has("vendor"))         base["Vendor"]           = product.vendor ?? "";
  if (has("productType"))    base["Product Type"]     = product.productType ?? "";
  if (has("status"))         base["Status"]           = product.status ?? "";
  if (has("handle"))         base["Handle"]           = product.handle ?? "";
  if (has("description"))    base["Description"]      = product.description ?? "";
  if (has("createdAt"))      base["Created At"]       = product.createdAt ? new Date(product.createdAt).toLocaleString() : "";
  if (has("updatedAt"))      base["Updated At"]       = product.updatedAt ? new Date(product.updatedAt).toLocaleString() : "";
  if (has("priceMin"))       base["Min Price"]        = product.priceRange?.minVariantPrice?.amount ?? "";
  if (has("priceMax"))       base["Max Price"]        = product.priceRange?.maxVariantPrice?.amount ?? "";
  if (has("tags"))           base["Tags"]             = Array.isArray(product.tags) ? product.tags.join(", ") : (product.tags ?? "");
  if (has("collections"))    base["Collections"]      = (product.collections?.edges ?? []).map((e) => e.node.title).join(", ");
  if (has("totalInventory")) base["Total Inventory"]  = product.totalInventory ?? "";
  if (has("images"))         base["Image URLs"]       = (product.images?.edges ?? []).map((e) => e.node.url).join("\n");
  if (has("seo_title"))      base["SEO Title"]        = product.seo?.title ?? "";
  if (has("seo_description"))base["SEO Description"]  = product.seo?.description ?? "";

  // If variant columns are not selected, export exactly one row per product.
  if (!hasVariantColumns) return [base];

  const variants = (product.variants?.edges ?? []).map((e) => e.node);
  if (variants.length === 0) return [base];

  return variants.map((v) => {
    const row = { ...base };
    if (has("variants_title"))          row["Variant Title"]    = v.title ?? "";
    if (has("variants_sku"))            row["Variant SKU"]      = v.sku ?? "";
    if (has("variants_price"))          row["Variant Price"]    = v.price ?? "";
    if (has("variants_compareAtPrice")) row["Compare At Price"] = v.compareAtPrice ?? "";
    if (has("variants_inventory"))      row["Inventory Qty"]    = v.inventoryQuantity ?? "";
    if (has("variants_barcode"))        row["Barcode"]          = v.barcode ?? "";
    if (has("variants_weight")) {
      const w = v.inventoryItem?.measurement?.weight;
      row["Weight"] = w ? `${w.value} ${w.unit}` : "";
    }
    return row;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// CLIENT: Build & download xlsx (dynamic import = client-only, no SSR crash)
// ─────────────────────────────────────────────────────────────────────────────
async function downloadExcel(products, selectedFields) {
  const rows = products.flatMap((p) => flattenProduct(p, selectedFields));
  const XLSX = await import("xlsx");
  const columns = [
    "Title",
    ...FIELD_GROUPS.flatMap((group) =>
      group.fields
        .filter((field) => selectedFields.includes(field.key))
        .map((field) => {
          switch (field.key) {
            case "vendor": return "Vendor";
            case "productType": return "Product Type";
            case "status": return "Status";
            case "handle": return "Handle";
            case "description": return "Description";
            case "createdAt": return "Created At";
            case "updatedAt": return "Updated At";
            case "priceMin": return "Min Price";
            case "priceMax": return "Max Price";
            case "variants_title": return "Variant Title";
            case "variants_sku": return "Variant SKU";
            case "variants_price": return "Variant Price";
            case "variants_compareAtPrice": return "Compare At Price";
            case "variants_inventory": return "Inventory Qty";
            case "variants_barcode": return "Barcode";
            case "variants_weight": return "Weight";
            case "tags": return "Tags";
            case "collections": return "Collections";
            case "totalInventory": return "Total Inventory";
            case "images": return "Image URLs";
            case "seo_title": return "SEO Title";
            case "seo_description": return "SEO Description";
            default: return field.label;
          }
        })
    ),
  ];

  const normalizedRows = rows.map((row) => {
    const ordered = {};
    columns.forEach((column) => {
      ordered[column] = row[column] ?? "";
    });
    return ordered;
  });

  const ws = XLSX.utils.json_to_sheet(normalizedRows, { header: columns });

  const columnWidthByHeader = {
    Title: 28,
    Description: 40,
    "Image URLs": 45,
    Collections: 28,
    Tags: 28,
    "SEO Description": 36,
    "Variant Title": 24,
  };
  ws["!cols"] = columns.map((column) => ({ wch: columnWidthByHeader[column] ?? 18 }));
  ws["!autofilter"] = { ref: ws["!ref"] };
  const wb   = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Products");
  XLSX.writeFile(wb, `shopify-products-${Date.now()}.xlsx`);
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export default function ExportPage() {
  // ✅ Products already fetched by the server-side loader — no extra fetch needed
  const { products, appliedQuery, productStats } = useLoaderData();

  const navigation   = useNavigation();
  const submit       = useSubmit();
  const isNavigating = navigation.state !== "idle";

  const [selected, setSelected] = useState(
    new Set([
      "vendor", "productType", "status", "tags", "images",
      "priceMin", "priceMax",
      "variants_title", "variants_sku", "variants_price", "variants_inventory", "collections",
    ])
  );
  const [searchQuery,    setSearchQuery]    = useState(appliedQuery);
  const [exporting,      setExporting]      = useState(false);
  const [exportedCount,  setExportedCount]  = useState(null);
  const [errorMsg,       setErrorMsg]       = useState("");

  const toggleField = useCallback((key) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }, []);

  // Apply search filter → re-runs the loader via GET navigation
  const handleApplyFilter = () => {
    setExportedCount(null);
    setErrorMsg("");
    submit(
      searchQuery.trim() ? { query: searchQuery.trim() } : {},
      { method: "get", action: "/app" }
    );
  };

  // Export → use products already in memory from the loader
  const handleExport = async () => {
    setErrorMsg("");
    setExportedCount(null);

    if (!products || products.length === 0) {
      setErrorMsg("No products loaded. Apply a filter or check your store has products.");
      return;
    }

    setExporting(true);
    try {
      await downloadExcel(products, Array.from(selected));
      setExportedCount(products.length);
    } catch (err) {
      setErrorMsg("Download failed: " + err.message);
    } finally {
      setExporting(false);
    }
  };

  const busy = isNavigating || exporting;

  return (
    <s-page heading="Product Export">
      {/* Primary action */}
      <s-button
        slot="primary-action"
        onClick={handleExport}
        {...(busy ? { loading: true } : {})}
        {...(products.length === 0 ? { disabled: true } : {})}
      >
        {exporting ? "Generating Excel…" : `Export ${products.length} Products to Excel`}
      </s-button>

      {/* ── Filter ── */}
      <s-section heading="Filter Products (Optional)">
        <s-paragraph>
          Optionally filter which products to export. Leave blank to export
          all products. Supports Shopify search syntax:{" "}
          <code>vendor:Nike</code>, <code>status:active</code>,{" "}
          <code>tag:sale</code>.
        </s-paragraph>
        <s-stack direction="block" gap="base">
          <s-text-field
            label="Search / Filter"
            placeholder="e.g.  vendor:Nike   or   status:active   or   tag:sale"
            value={searchQuery}
            onInput={(e) => setSearchQuery(e.target.value)}
          />
          <s-stack direction="inline" gap="base">
            <s-button
              onClick={handleApplyFilter}
              {...(isNavigating ? { loading: true } : {})}
            >
              {isNavigating ? "Loading…" : "Apply Filter"}
            </s-button>
            {appliedQuery && (
              <s-button
                variant="tertiary"
                onClick={() => {
                  setSearchQuery("");
                  submit({}, { method: "get", action: "/app" });
                }}
              >
                Clear Filter
              </s-button>
            )}
          </s-stack>
        </s-stack>
        {appliedQuery && (
          <s-paragraph>
            Showing <strong>{products.length}</strong> products matching:{" "}
            <code>{appliedQuery}</code>
          </s-paragraph>
        )}
      </s-section>

      {/* ── Field selector ── */}
      <s-section heading={`Select Export Fields (${selected.size + 1} selected)`}>
        <s-paragraph>
          Choose which fields to include in the Excel file.{" "}
          <strong>Title</strong> is always exported.
        </s-paragraph>
        <s-stack direction="inline" gap="base">
          <s-button
            variant="tertiary"
            onClick={() => setSelected(new Set(ALL_OPTIONAL_KEYS))}
          >
            Select All
          </s-button>
          <s-button
            variant="tertiary"
            onClick={() => setSelected(new Set())}
          >
            Clear All
          </s-button>
        </s-stack>

        {FIELD_GROUPS.map((group) => (
          <s-section key={group.group} heading={group.group}>
            <s-stack direction="block" gap="tight">
              {group.fields.map((field) =>
                field.always ? (
                  <s-checkbox
                    key={field.key}
                    label={`${field.label} (always included)`}
                    checked
                    disabled
                  />
                ) : (
                  <s-checkbox
                    key={field.key}
                    label={field.label}
                    checked={selected.has(field.key)}
                    onChange={() => toggleField(field.key)}
                  />
                )
              )}
            </s-stack>
          </s-section>
        ))}
      </s-section>

      {/* ── Error ── */}
      {errorMsg && (
        <s-section heading="Error">
          <s-banner
            title="Export failed"
            tone="critical"
            onDismiss={() => setErrorMsg("")}
          >
            {errorMsg}
          </s-banner>
        </s-section>
      )}

      {/* ── Success ── */}
      {exportedCount !== null && (
        <s-section heading={`✅ Export Complete`}>
          <s-banner title="File downloaded successfully" tone="success">
            Exported <strong>{exportedCount}</strong> products with{" "}
            <strong>{selected.size + 1}</strong> field columns to Excel.
          </s-banner>
        </s-section>
      )}

      {/* ── Aside ── */}
      <s-section slot="aside" heading="How to Export">
        <s-unordered-list>
          <s-list-item>
            Optionally type a filter and click <strong>Apply Filter</strong>
          </s-list-item>
          <s-list-item>Tick the fields you want in the file</s-list-item>
          <s-list-item>
            Click <strong>Export … to Excel</strong>
          </s-list-item>
          <s-list-item>The .xlsx file downloads automatically</s-list-item>
        </s-unordered-list>
      </s-section>

      <s-section slot="aside" heading="Products loaded">
        <s-paragraph>
          <strong>{products.length}</strong> products fully loaded and ready to export
          {appliedQuery ? ` (filtered by "${appliedQuery}")` : " (all products)"}.
          <br />
          <strong>Total products:</strong> {productStats?.total ?? 0}
          <br />
          <strong>Active:</strong> {productStats?.active ?? 0}
          {" | "}
          <strong>Draft:</strong> {productStats?.draft ?? 0}
        </s-paragraph>
      </s-section>

      <s-section slot="aside" heading="Excel Format">
        <s-paragraph>
          If you select variant columns, each variant gets its own row.
          If you do not select variant columns, each product appears once.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
