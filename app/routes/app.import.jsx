import { useState, useMemo, useEffect } from "react";
import { useLoaderData, useFetcher } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getCurrentPlan, planSelectionUrl } from "../plans.server";

// ─────────────────────────────────────────────────────────────────────────────
// SERVER: Loader — fetch lightweight product identifiers for client-side matching
// ─────────────────────────────────────────────────────────────────────────────
export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const plan = await getCurrentPlan(admin);

  const allProducts = [];
  let hasNextPage = true;
  let after = null;

  while (hasNextPage) {
    const res = await admin.graphql(
      `#graphql
        query getProductIds($first: Int!, $after: String) {
          products(first: $first, after: $after) {
            pageInfo { hasNextPage endCursor }
            edges { node { id handle title status } }
          }
        }
      `,
      { variables: { first: 250, after } }
    );
    const json = await res.json();
    if (json.errors) throw new Error(json.errors.map((e) => e.message).join(", "));
    const page = json.data.products;
    allProducts.push(...page.edges.map((e) => e.node));
    hasNextPage = page.pageInfo.hasNextPage;
    after = page.pageInfo.endCursor;
  }

  return { existingProducts: allProducts, plan, changePlanUrl: planSelectionUrl(session.shop) };
};

// ─────────────────────────────────────────────────────────────────────────────
// SERVER: Action — update matched products in Shopify
// ─────────────────────────────────────────────────────────────────────────────
export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ updated: 0, errors: [{ message: "Invalid JSON body" }] });
  }

  const plan = await getCurrentPlan(admin);
  const allRows = Array.isArray(body.matchedRows) ? body.matchedRows : [];
  // Plan limit enforced on the server: rows beyond the limit are not updated.
  const matchedRows = plan.limit == null ? allRows : allRows.slice(0, plan.limit);
  const skippedByPlan = allRows.length - matchedRows.length;
  const results = [];
  const errors = [];

  for (const row of matchedRows) {
    const productId = row._shopifyId;
    if (!productId) {
      errors.push({ title: row["Title"] || "?", message: "Missing Shopify product ID — row skipped" });
      continue;
    }

    const input = { id: productId };
    if (row["Title"])        input.title           = row["Title"];
    if (row["Vendor"])       input.vendor          = row["Vendor"];
    if (row["Product Type"]) input.productType     = row["Product Type"];
    if (row["Description"])  input.descriptionHtml = row["Description"];
    if (row["Handle"])       input.handle          = row["Handle"];
    if (row["Status"]) {
      const s = String(row["Status"]).toUpperCase();
      if (["ACTIVE", "DRAFT", "ARCHIVED"].includes(s)) input.status = s;
    }
    if (row["Tags"]) {
      input.tags = String(row["Tags"]).split(",").map((t) => t.trim()).filter(Boolean);
    }

    try {
      const res = await admin.graphql(
        `#graphql
          mutation productUpdate($input: ProductInput!) {
            productUpdate(input: $input) {
              product { id title status }
              userErrors { field message }
            }
          }
        `,
        { variables: { input } }
      );
      const data = await res.json();
      const result = data.data?.productUpdate;

      if (!result) {
        errors.push({ title: row["Title"] || "?", message: "No response from Shopify" });
      } else if (result.userErrors?.length) {
        errors.push({ title: row["Title"] || "?", message: result.userErrors.map((e) => e.message).join(", ") });
      } else {
        results.push(result.product);
      }
    } catch (err) {
      errors.push({ title: row["Title"] || "?", message: err.message });
    }
  }

  return Response.json({ updated: results.length, errors, skippedByPlan });
};

// ─────────────────────────────────────────────────────────────────────────────
// MATCH OPTIONS
// ─────────────────────────────────────────────────────────────────────────────
const MATCH_OPTIONS = [
  { label: "Handle (recommended)", value: "handle", column: "Handle" },
  { label: "Product title",        value: "title",  column: "Title"  },
];

const UPDATABLE_FIELDS = ["Title", "Vendor", "Product Type", "Status", "Description", "Tags", "Handle"];
const PREVIEW_LIMIT = 50;

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export default function ImportPage() {
  const { existingProducts, plan, changePlanUrl } = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();

  const [fileName,    setFileName]    = useState("");
  const [parsedRows,  setParsedRows]  = useState(null);
  const [parseError,  setParseError]  = useState("");
  const [matchField,  setMatchField]  = useState("handle");
  const [matchResult, setMatchResult] = useState(null);
  const [previewTab,  setPreviewTab]  = useState("matched");

  const importing    = fetcher.state !== "idle";
  const importResult = fetcher.data;

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) {
      const { updated = 0, errors = [] } = fetcher.data;
      shopify.toast.show(
        errors.length ? `${updated} updated, ${errors.length} failed` : `${updated} products updated`,
        { isError: errors.length > 0 && updated === 0 },
      );
    }
  }, [fetcher.state, fetcher.data, shopify]);

  const lookupMaps = useMemo(
    () =>
      existingProducts.reduce(
        (acc, p) => {
          if (p.handle) acc.handle.set(p.handle.toLowerCase(), p);
          if (p.title)  acc.title.set(p.title.toLowerCase(), p);
          return acc;
        },
        { handle: new Map(), title: new Map() },
      ),
    [existingProducts],
  );

  const matchOption = MATCH_OPTIONS.find((o) => o.value === matchField);

  const runMatch = (rows, field) => {
    const option = MATCH_OPTIONS.find((o) => o.value === field);
    const map = lookupMaps[field];
    const matched = [];
    const unmatched = [];
    for (const row of rows) {
      const cellValue = (row[option.column] || "").toString().toLowerCase().trim();
      const product = map.get(cellValue);
      if (product) {
        matched.push({
          ...row,
          _shopifyId: product.id,
          _shopifyTitle: product.title,
          _shopifyStatus: product.status,
          _matchValue: row[option.column],
        });
      } else {
        unmatched.push({ ...row, _matchValue: row[option.column] });
      }
    }
    setMatchResult({ matched, unmatched });
    setPreviewTab(matched.length ? "matched" : "unmatched");
  };

  const resetFile = () => {
    setFileName("");
    setParsedRows(null);
    setMatchResult(null);
    setParseError("");
  };

  const handleFile = async (file) => {
    if (!file) return;
    resetFile();
    setFileName(file.name);
    try {
      const buffer = await file.arrayBuffer();
      const XLSX = await import("xlsx");
      const wb = XLSX.read(buffer, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
      if (rows.length === 0) {
        setParseError("The file is empty. Add at least one product row and try again.");
        return;
      }
      setParsedRows(rows);
      runMatch(rows, matchField);
    } catch (err) {
      setParseError("The file could not be read: " + err.message);
    }
  };

  const handleImport = () => {
    if (!matchResult?.matched?.length) return;
    fetcher.submit(
      { matchedRows: matchResult.matched.slice(0, updateCount) },
      { method: "POST", encType: "application/json" },
    );
    document.getElementById("confirm-import-modal")?.hideOverlay?.();
  };

  const columns = parsedRows ? Object.keys(parsedRows[0] ?? {}) : [];
  const missingMatchColumn = parsedRows && !columns.includes(matchOption.column);
  const updatableInFile = UPDATABLE_FIELDS.filter((f) => columns.includes(f));
  const matchedCount = matchResult?.matched?.length ?? 0;
  const updateCount = plan.limit == null ? matchedCount : Math.min(matchedCount, plan.limit);
  const overLimit = plan.limit != null && matchedCount > plan.limit;
  const unmatchedCount = matchResult?.unmatched?.length ?? 0;
  const previewRows = (previewTab === "matched" ? matchResult?.matched : matchResult?.unmatched) ?? [];

  return (
    <s-page heading="Import products">
      <s-link slot="breadcrumb-actions" href="/app">Dashboard</s-link>
      <s-button
        slot="primary-action"
        variant="primary"
        commandFor="confirm-import-modal"
        command="--show"
        {...(importing ? { loading: true } : {})}
        {...(matchedCount < 1 ? { disabled: true } : {})}
      >
        Update {updateCount} products
      </s-button>
      <s-button slot="secondary-actions" href="/app/export">Export a template</s-button>

      {importResult && !importing && (
        <s-banner
          heading={`${importResult.updated} product${importResult.updated !== 1 ? "s" : ""} updated`}
          tone={importResult.errors?.length ? "warning" : "success"}
          dismissible
        >
          {importResult.errors?.length ? (
            <s-stack gap="small-200">
              <s-text>{importResult.errors.length} rows could not be updated:</s-text>
              <s-unordered-list>
                {importResult.errors.slice(0, 20).map((err, i) => (
                  <s-list-item key={i}>
                    <s-text type="strong">{err.title || "Row"}</s-text>: {err.message}
                  </s-list-item>
                ))}
              </s-unordered-list>
            </s-stack>
          ) : (
            "All matched products were updated in Shopify."
          )}
        </s-banner>
      )}

      {overLimit && (
        <s-banner heading={`Your ${plan.name} plan updates up to ${plan.limit.toLocaleString()} products at a time`} tone="warning">
          {matchedCount.toLocaleString()} rows match. The first {plan.limit.toLocaleString()} will be updated.{" "}
          <s-link href={changePlanUrl} target="_top">Upgrade your plan</s-link> to update more at once.
        </s-banner>
      )}

      <s-section heading="1. Upload file">
        <s-stack gap="base">
          {!fileName ? (
            <s-drop-zone
              label="Product file"
              accept=".xlsx,.xls,.csv"
              accessibilityLabel="Upload an Excel or CSV file"
              onInput={(e) => handleFile(e.currentTarget.files?.[0])}
              onChange={(e) => handleFile(e.currentTarget.files?.[0])}
            />
          ) : (
            <s-box padding="base" border="base" borderRadius="base">
              <s-stack direction="inline" justifyContent="space-between" alignItems="center">
                <s-stack direction="inline" gap="small-200" alignItems="center">
                  <s-icon type="file" />
                  <s-text type="strong">{fileName}</s-text>
                  {parsedRows && <s-badge>{parsedRows.length} rows</s-badge>}
                </s-stack>
                <s-button variant="tertiary" onClick={resetFile}>Remove</s-button>
              </s-stack>
            </s-box>
          )}
          <s-text color="subdued">
            Accepts .xlsx, .xls or .csv. Use a file exported from this app for the correct column names.
          </s-text>
          {parseError && (
            <s-banner heading="File error" tone="critical" dismissible onDismiss={() => setParseError("")}>
              {parseError}
            </s-banner>
          )}
        </s-stack>
      </s-section>

      {parsedRows && (
        <s-section heading="2. Match products">
          <s-stack gap="base">
            <s-box maxInlineSize="360px">
              <s-select
                label="Match file rows to store products by"
                value={matchField}
                onChange={(e) => {
                  const value = e.currentTarget.value;
                  setMatchField(value);
                  runMatch(parsedRows, value);
                }}
              >
                {MATCH_OPTIONS.map((o) => (
                  <s-option key={o.value} value={o.value}>{o.label}</s-option>
                ))}
              </s-select>
            </s-box>

            {missingMatchColumn && (
              <s-banner tone="warning" heading={`Column "${matchOption.column}" not found`}>
                Your file needs a column named {matchOption.column} to match by this field.
              </s-banner>
            )}

            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-text color="subdued">Fields that will be updated:</s-text>
              {updatableInFile.length ? (
                updatableInFile.map((f) => <s-badge key={f}>{f}</s-badge>)
              ) : (
                <s-badge tone="warning">None found in file</s-badge>
              )}
            </s-stack>
          </s-stack>
        </s-section>
      )}

      {matchResult && (
        <s-section heading="3. Review changes" padding="none">
          <s-box padding="base">
            <s-stack direction="inline" gap="small-200">
              <s-button
                variant={previewTab === "matched" ? "secondary" : "tertiary"}
                onClick={() => setPreviewTab("matched")}
              >
                Will update ({matchedCount})
              </s-button>
              <s-button
                variant={previewTab === "unmatched" ? "secondary" : "tertiary"}
                onClick={() => setPreviewTab("unmatched")}
              >
                Skipped ({unmatchedCount})
              </s-button>
            </s-stack>
          </s-box>
          {previewRows.length === 0 ? (
            <s-box padding="large-200">
              <s-stack alignItems="center" gap="small-200">
                <s-heading>{previewTab === "matched" ? "No matching products" : "Every row matched"}</s-heading>
                <s-text color="subdued">
                  {previewTab === "matched"
                    ? `No rows matched a store product by ${matchOption.column.toLowerCase()}. Try another match field.`
                    : "All rows in the file match an existing product."}
                </s-text>
              </s-stack>
            </s-box>
          ) : (
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">{matchOption.column} in file</s-table-header>
                <s-table-header>{previewTab === "matched" ? "Store product" : "Reason"}</s-table-header>
                <s-table-header listSlot="secondary">Status</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {previewRows.slice(0, PREVIEW_LIMIT).map((row, i) => (
                  <s-table-row key={i}>
                    <s-table-cell>{String(row._matchValue || "(empty)")}</s-table-cell>
                    <s-table-cell>
                      {previewTab === "matched" ? row._shopifyTitle : "No product found"}
                    </s-table-cell>
                    <s-table-cell>
                      {previewTab === "matched" ? (
                        <s-badge tone={row._shopifyStatus === "ACTIVE" ? "success" : undefined}>
                          {formatStatus(row._shopifyStatus)}
                        </s-badge>
                      ) : (
                        <s-badge tone="warning">Skipped</s-badge>
                      )}
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          )}
          {previewRows.length > PREVIEW_LIMIT && (
            <s-box padding="base">
              <s-text color="subdued">Showing first {PREVIEW_LIMIT} of {previewRows.length} rows.</s-text>
            </s-box>
          )}
        </s-section>
      )}

      <s-section slot="aside" heading="How it works">
        <s-ordered-list>
          <s-list-item>Export products and edit the file</s-list-item>
          <s-list-item>Upload the edited file</s-list-item>
          <s-list-item>Review matched and skipped rows</s-list-item>
          <s-list-item>Select Update to save changes in Shopify</s-list-item>
        </s-ordered-list>
      </s-section>

      <s-section slot="aside" heading="Good to know">
        <s-unordered-list>
          <s-list-item>Only existing products are updated. New products are not created.</s-list-item>
          <s-list-item>Empty cells are ignored, so existing values are kept.</s-list-item>
          <s-list-item>Handle is the safest match field because it is unique.</s-list-item>
          <s-list-item>{existingProducts.length.toLocaleString()} store products available for matching.</s-list-item>
        </s-unordered-list>
      </s-section>

      <s-modal id="confirm-import-modal" heading="Update products in Shopify?">
        <s-paragraph>
          {updateCount} products will be updated with the values from {fileName || "your file"}.
          This can&apos;t be undone automatically. Export a backup first if you&apos;re unsure.
        </s-paragraph>
        <s-button slot="primary-action" variant="primary" onClick={handleImport}>
          Update {updateCount} products
        </s-button>
        <s-button slot="secondary-actions" commandFor="confirm-import-modal" command="--hide">
          Cancel
        </s-button>
      </s-modal>
    </s-page>
  );
}

function formatStatus(status) {
  if (!status) return "Unknown";
  return status.charAt(0) + status.slice(1).toLowerCase();
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
