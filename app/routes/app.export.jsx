/* eslint-disable react/prop-types */
import { useState, useCallback, useEffect, useRef } from "react";
import { useLoaderData, useNavigation, useSubmit, useFetcher } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getCurrentPlan, planSelectionUrl } from "../plans.server";
import { EXPORT_PAGE_SIZE, fetchExportPage } from "../lib/export-fetch.server";
import {
  ALL_OPTIONAL_KEYS,
  buildAppSheet,
  buildShopifyCsvRows,
  DEFAULT_FIELDS,
  FIELD_GROUPS,
  SHOPIFY_CSV_COLUMNS,
} from "../lib/product-format";

// ─────────────────────────────────────────────────────────────────────────────
// SERVER: Loader — only counts, so the page opens fast on any catalog size.
// The full product data is fetched page by page when you export (see action).
// ─────────────────────────────────────────────────────────────────────────────
export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const plan = await getCurrentPlan(admin);

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
    plan,
    changePlanUrl: planSelectionUrl(session.shop),
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
// SERVER: Action — returns one page of products at a time; the browser keeps
// asking for the next page, so no single request is slow.
// ─────────────────────────────────────────────────────────────────────────────
export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const form = await request.formData();
  const after = String(form.get("cursor") || "") || null;
  const query = String(form.get("query") || "").trim() || null;
  const collected = Number(form.get("collected") || 0);

  // Plan limit is enforced here on the server, not only in the browser.
  const plan = await getCurrentPlan(admin);
  const remaining = plan.limit == null ? Infinity : plan.limit - collected;
  if (remaining <= 0) return { products: [], hasNextPage: false, limited: true };

  try {
    const page = await fetchExportPage(admin, { first: Math.min(EXPORT_PAGE_SIZE, remaining), after, query });
    const reachedLimit = plan.limit != null && collected + page.products.length >= plan.limit;
    return {
      products: page.products,
      hasNextPage: page.hasNextPage && !reachedLimit,
      limited: reachedLimit && page.hasNextPage,
      cursor: page.cursor,
    };
  } catch (err) {
    return { error: `Could not load products: ${err?.message || "Unknown error"}` };
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// CLIENT: build the file in the browser (dynamic import keeps xlsx out of SSR)
// ─────────────────────────────────────────────────────────────────────────────
const COLUMN_WIDTHS = { Title: 28, Description: 40, "Body (HTML)": 40, "Image URLs": 45, "Image Src": 45, Collections: 28, Tags: 28, "SEO Description": 36, "Variant Title": 24 };

async function downloadFile(products, selectedFields, format) {
  const XLSX = await import("xlsx");
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === "shopify_csv") {
    const rows = buildShopifyCsvRows(products);
    const ws = XLSX.utils.json_to_sheet(rows, { header: SHOPIFY_CSV_COLUMNS });
    const csv = XLSX.utils.sheet_to_csv(ws);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `products-shopify-${stamp}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    return;
  }
  const { columns, rows } = buildAppSheet(products, selectedFields);
  const ws = XLSX.utils.json_to_sheet(rows, { header: columns });
  ws["!cols"] = columns.map((c) => ({ wch: COLUMN_WIDTHS[c] ?? 18 }));
  ws["!autofilter"] = { ref: ws["!ref"] };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Products");
  XLSX.writeFile(wb, `products-${stamp}.xlsx`);
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export default function ExportPage() {
  const { appliedQuery, matchingCount, productStats, plan, changePlanUrl } = useLoaderData();
  // Number of products this export will include under the merchant's plan.
  const exportCount = plan.limit == null ? matchingCount : Math.min(matchingCount, plan.limit);
  const overLimit = plan.limit != null && matchingCount > plan.limit;
  const shopify = useAppBridge();
  const pageFetcher = useFetcher();

  const navigation   = useNavigation();
  const submit       = useSubmit();
  const isNavigating = navigation.state !== "idle";

  const [selected, setSelected] = useState(new Set(DEFAULT_FIELDS));
  const [format, setFormat] = useState("xlsx");
  const formatRef = useRef(format);
  formatRef.current = format;
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
    pageFetcher.submit({ query: appliedQuery, collected: 0 }, { method: "POST" });
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
      pageFetcher.submit(
        { query: appliedQuery, cursor: data.cursor, collected: collectedRef.current.length },
        { method: "POST" },
      );
      return;
    }

    const all = collectedRef.current;
    setExporting(false);
    if (all.length === 0) {
      setErrorMsg("There are no products to export. Change the filter or add products to your store.");
      return;
    }
    downloadFile(all, Array.from(selectedRef.current), formatRef.current)
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
        Export {exportCount.toLocaleString()} products
      </s-button>

      {overLimit && (
        <s-banner heading={`Your ${plan.name} plan exports up to ${plan.limit.toLocaleString()} products`} tone="warning">
          {matchingCount.toLocaleString()} products match. The first {plan.limit.toLocaleString()} will be
          exported.{" "}
          <s-link href={changePlanUrl} target="_top">Upgrade your plan</s-link> to export more.
        </s-banner>
      )}

      {exporting && (
        <s-banner heading="Preparing your export…" tone="info">
          Loaded {progress.toLocaleString()} of {exportCount.toLocaleString()} products. The file
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

      <s-section heading="2. Choose format">
        <s-stack gap="base">
          <s-choice-list
            label="File format"
            labelAccessibilityVisibility="exclusive"
            values={[format]}
            onChange={(e) => setFormat(e.currentTarget.values?.[0] ?? "xlsx")}
          >
            <s-choice value="xlsx" {...(format === "xlsx" ? { selected: true } : {})}>
              Excel (.xlsx) — choose your columns, edit and import back
            </s-choice>
            <s-choice value="shopify_csv" {...(format === "shopify_csv" ? { selected: true } : {})}>
              Shopify CSV (.csv) — Shopify&apos;s standard product format, to move products to another store
            </s-choice>
          </s-choice-list>
        </s-stack>
      </s-section>

      {format === "xlsx" && (
      <s-section heading="3. Choose columns">
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
      )}

      <s-section slot="aside" heading="How it works">
        <s-ordered-list>
          <s-list-item>Filter products (optional)</s-list-item>
          <s-list-item>Choose the columns you need</s-list-item>
          <s-list-item>Choose Excel or Shopify CSV</s-list-item>
          <s-list-item>Select Export to download the file</s-list-item>
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
