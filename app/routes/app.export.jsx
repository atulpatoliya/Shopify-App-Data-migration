/* eslint-disable react/prop-types */
import { useState, useCallback, useEffect, useRef } from "react";
import { useLoaderData, useNavigation, useSubmit, useFetcher } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

// ─────────────────────────────────────────────────────────────────────────────
// SERVER: Loader — only counts, so the page opens fast on any catalog size.
// The full product data is fetched page by page when you export (see action).
// ─────────────────────────────────────────────────────────────────────────────
export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  const url = new URL(request.url);
  const query = url.searchParams.get("query") || "";

  const statsResponse = await admin.graphql(
    `#graphql
      query getProductStats($query: String) {
        totalProducts: productsCount(limit: null) { count }
        activeProducts: productsCount(query: "status:active", limit: null) { count }
        draftProducts: productsCount(query: "status:draft", limit: null) { count }
        matchingProducts: productsCount(query: $query, limit: null) { count }
      }
    `,
    { variables: { query: query || null } },
  );

  const statsJson = await statsResponse.json();
  if (statsJson.errors) {
    throw new Error(statsJson.errors.map((e) => e.message).join(", "));
  }
  const d = statsJson.data;

  return {
    appliedQuery: query,
    matchingCount: d.matchingProducts?.count ?? 0,
    productStats: {
      total: d.totalProducts?.count ?? 0,
      active: d.activeProducts?.count ?? 0,
      draft: d.draftProducts?.count ?? 0,
    },
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// SERVER: Action — returns one page of products at a time. The browser keeps
// asking for the next page until done, so no single request is slow and the
// merchant sees progress. (Bulk Operations are not available to this app's token.)
// ─────────────────────────────────────────────────────────────────────────────
const PAGE_SIZE = 50;

const EXPORT_PAGE_QUERY = `#graphql
  query exportPage($first: Int!, $after: String, $query: String) {
    products(first: $first, after: $after, query: $query) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id title vendor productType status tags handle createdAt updatedAt
          totalInventory description
          priceRange: priceRangeV2 {
            minVariantPrice { amount currencyCode }
            maxVariantPrice { amount currencyCode }
          }
          seo { title description }
          media(first: 5) {
            edges { node { ... on MediaImage { image { url } } } }
          }
          collections(first: 5) { edges { node { title } } }
          variants(first: 100) {
            pageInfo { hasNextPage endCursor }
            edges {
              node {
                id title sku price compareAtPrice inventoryQuantity barcode
                inventoryItem { measurement { weight { value unit } } }
              }
            }
          }
        }
      }
    }
  }
`;

const EXTRA_VARIANTS_QUERY = `#graphql
  query extraVariants($id: ID!, $after: String) {
    product(id: $id) {
      variants(first: 250, after: $after) {
        pageInfo { hasNextPage endCursor }
        edges {
          node {
            id title sku price compareAtPrice inventoryQuantity barcode
            inventoryItem { measurement { weight { value unit } } }
          }
        }
      }
    }
  }
`;

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const form = await request.formData();
  const after = String(form.get("cursor") || "") || null;
  const query = String(form.get("query") || "").trim() || null;

  try {
    const res = await admin.graphql(EXPORT_PAGE_QUERY, {
      variables: { first: PAGE_SIZE, after, query },
    });
    const json = await res.json();
    const page = json.data.products;

    const products = [];
    for (const { node } of page.edges) {
      // Rare: products with more than 100 variants.
      let vInfo = node.variants.pageInfo;
      while (vInfo?.hasNextPage) {
        const vRes = await admin.graphql(EXTRA_VARIANTS_QUERY, {
          variables: { id: node.id, after: vInfo.endCursor },
        });
        const extra = (await vRes.json()).data?.product?.variants;
        if (!extra) break;
        node.variants.edges.push(...extra.edges);
        vInfo = extra.pageInfo;
      }
      products.push({
        ...node,
        images: {
          edges: node.media.edges
            .filter((e) => e.node?.image?.url)
            .map((e) => ({ node: { url: e.node.image.url } })),
        },
      });
    }

    return {
      products,
      hasNextPage: page.pageInfo.hasNextPage,
      cursor: page.pageInfo.endCursor,
    };
  } catch (err) {
    const message =
      err?.body?.errors?.graphQLErrors?.map((e) => e.message).join(", ") ||
      err?.message ||
      "Unknown error";
    return { error: `Could not load products: ${message}` };
  }
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
  const { appliedQuery, matchingCount, productStats } = useLoaderData();
  const shopify = useAppBridge();
  const pageFetcher = useFetcher();

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
  const [searchQuery, setSearchQuery] = useState(appliedQuery);
  const [exporting,   setExporting]   = useState(false);
  const [progress,    setProgress]    = useState(0);
  const collectedRef = useRef([]);
  const [errorMsg,    setErrorMsg]    = useState("");
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  const toggleField = useCallback((key) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }, []);

  const runSearch = (value) => {
    setErrorMsg("");
    submit(value ? { query: value } : {}, { method: "get", action: "/app/export" });
  };

  // Export: fetch pages one by one, then build the Excel file in the browser.
  const handleExport = () => {
    setErrorMsg("");
    collectedRef.current = [];
    setProgress(0);
    setExporting(true);
    pageFetcher.submit({ query: appliedQuery }, { method: "POST" });
  };

  useEffect(() => {
    const data = pageFetcher.data;
    if (!exporting || pageFetcher.state !== "idle" || !data) return;

    if (data.error) {
      setExporting(false);
      setErrorMsg(data.error);
      return;
    }

    collectedRef.current.push(...data.products);
    setProgress(collectedRef.current.length);

    if (data.hasNextPage) {
      pageFetcher.submit({ query: appliedQuery, cursor: data.cursor }, { method: "POST" });
      return;
    }

    const all = collectedRef.current;
    setExporting(false);
    if (all.length === 0) {
      setErrorMsg("There are no products to export. Change the filter or add products to your store.");
      return;
    }
    downloadExcel(all, Array.from(selectedRef.current))
      .then(() => shopify.toast.show(`Exported ${all.length} products`))
      .catch((err) => setErrorMsg("The file could not be created: " + err.message));
  }, [pageFetcher.state, pageFetcher.data, exporting, appliedQuery, pageFetcher, shopify]);

  const busy = isNavigating || exporting;
  const fieldCount = selected.size + 1;

  return (
    <s-page heading="Export products">
      <s-link slot="breadcrumb-actions" href="/app">Dashboard</s-link>
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={handleExport}
        {...(busy ? { loading: true } : {})}
        {...(matchingCount === 0 ? { disabled: true } : {})}
      >
        Export {matchingCount.toLocaleString()} products
      </s-button>

      {exporting && (
        <s-banner heading="Preparing your export…" tone="info">
          Loaded {progress.toLocaleString()} of {matchingCount.toLocaleString()} products. The file
          downloads automatically when it&apos;s ready. Keep this page open.
        </s-banner>
      )}

      {errorMsg && (
        <s-banner heading="Export failed" tone="critical" dismissible onDismiss={() => setErrorMsg("")}>
          {errorMsg}
        </s-banner>
      )}

      <s-section padding="base">
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(160px, 1fr))" gap="base">
          <StatCard label="Total products" value={productStats?.total ?? 0} />
          <StatCard label="Active" value={productStats?.active ?? 0} />
          <StatCard label="Draft" value={productStats?.draft ?? 0} />
          <StatCard label="Ready to export" value={matchingCount} highlight />
        </s-grid>
      </s-section>

      <s-section heading="1. Choose products">
        <s-stack gap="base">
          <s-paragraph color="subdued">
            Leave empty to export all products. Shopify search syntax is supported, for example{" "}
            <s-text type="strong">vendor:Nike</s-text>, <s-text type="strong">status:active</s-text> or{" "}
            <s-text type="strong">tag:sale</s-text>.
          </s-paragraph>
          <s-stack direction="inline" gap="small-200" alignItems="end">
            <s-box inlineSize="100%" maxInlineSize="520px">
              <s-search-field
                label="Filter products"
                labelAccessibilityVisibility="exclusive"
                placeholder="Search products or use a filter"
                value={searchQuery}
                onInput={(e) => setSearchQuery(e.currentTarget.value)}
                onKeyDown={(e) => { if (e.key === "Enter") runSearch(searchQuery.trim()); }}
              />
            </s-box>
            <s-button onClick={() => runSearch(searchQuery.trim())} {...(isNavigating ? { loading: true } : {})}>
              Apply
            </s-button>
            {appliedQuery && (
              <s-button variant="tertiary" onClick={() => { setSearchQuery(""); runSearch(""); }}>
                Clear
              </s-button>
            )}
          </s-stack>
          {appliedQuery && (
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-text color="subdued">Filter:</s-text>
              <s-badge tone="info">{appliedQuery}</s-badge>
              <s-text color="subdued">{matchingCount.toLocaleString()} matching products</s-text>
            </s-stack>
          )}
        </s-stack>
      </s-section>

      <s-section heading="2. Choose columns">
        <s-stack gap="base">
          <s-stack direction="inline" justifyContent="space-between" alignItems="center">
            <s-text color="subdued">{fieldCount} columns selected. Title is always included.</s-text>
            <s-stack direction="inline" gap="small-200">
              <s-button variant="tertiary" onClick={() => setSelected(new Set(ALL_OPTIONAL_KEYS))}>Select all</s-button>
              <s-button variant="tertiary" onClick={() => setSelected(new Set())}>Clear all</s-button>
            </s-stack>
          </s-stack>
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))" gap="base">
            {FIELD_GROUPS.map((group) => (
              <s-box key={group.group} padding="base" border="base" borderRadius="base">
                <s-stack gap="small-200">
                  <s-heading>{group.group}</s-heading>
                  {group.fields.map((field) =>
                    field.always ? (
                      <s-checkbox key={field.key} label={field.label} details="Always included" checked disabled />
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
              </s-box>
            ))}
          </s-grid>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="How it works">
        <s-ordered-list>
          <s-list-item>Filter products (optional)</s-list-item>
          <s-list-item>Choose the columns you need</s-list-item>
          <s-list-item>Select Export to download an .xlsx file</s-list-item>
        </s-ordered-list>
      </s-section>

      <s-section slot="aside" heading="File format">
        <s-stack gap="small-200">
          <s-paragraph>
            When variant columns are selected, each variant gets its own row. Otherwise each
            product appears once.
          </s-paragraph>
          <s-paragraph>
            Edit the file and upload it again from <s-link href="/app/import">Import products</s-link>.
          </s-paragraph>
        </s-stack>
      </s-section>
    </s-page>
  );
}

function StatCard({ label, value, highlight }) {
  return (
    <s-box padding="base" border="base" borderRadius="base" background={highlight ? "subdued" : "base"}>
      <s-stack gap="small-300">
        <s-text color="subdued">{label}</s-text>
        <s-heading>{Number(value).toLocaleString()}</s-heading>
      </s-stack>
    </s-box>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
