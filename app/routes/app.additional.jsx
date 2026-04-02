import { useState, useRef } from "react";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

// ─────────────────────────────────────────────────────────────────────────────
// SERVER: Loader — fetch lightweight product identifiers for client-side matching
// ─────────────────────────────────────────────────────────────────────────────
export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

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

  return { existingProducts: allProducts };
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

  const { matchedRows = [] } = body;
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

  return Response.json({ updated: results.length, errors });
};

// ─────────────────────────────────────────────────────────────────────────────
// MATCH OPTIONS
// ─────────────────────────────────────────────────────────────────────────────
const MATCH_OPTIONS = [
  { label: "Handle (URL Slug) — recommended", value: "handle", column: "Handle" },
  { label: "Product Title",                   value: "title",  column: "Title"  },
];

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export default function ImportPage() {
  const { existingProducts } = useLoaderData();

  const fileRef = useRef(null);
  const [fileName,     setFileName]     = useState("");
  const [parsedRows,   setParsedRows]   = useState(null);
  const [parseError,   setParseError]   = useState("");
  const [matchField,   setMatchField]   = useState("handle");
  const [matchResult,  setMatchResult]  = useState(null);
  const [importing,    setImporting]    = useState(false);
  const [importResult, setImportResult] = useState(null);

  // Build lookup maps from existingProducts
  const lookupMaps = existingProducts.reduce(
    (acc, p) => {
      if (p.handle) acc.handle.set(p.handle.toLowerCase(), p);
      if (p.title)  acc.title.set(p.title.toLowerCase(),   p);
      return acc;
    },
    { handle: new Map(), title: new Map() }
  );

  // ── Parse uploaded file on client ──
  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setFileName(file.name);
    setParseError("");
    setParsedRows(null);
    setMatchResult(null);
    setImportResult(null);

    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const XLSX = await import("xlsx");
        const wb   = XLSX.read(ev.target.result, { type: "array" });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
        if (rows.length === 0) { setParseError("The file appears to be empty."); return; }
        setParsedRows(rows);
      } catch (err) {
        setParseError("Could not parse file: " + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // ── Client-side matching ──
  const handleCheckMatch = () => {
    if (!parsedRows) return;
    const option = MATCH_OPTIONS.find((o) => o.value === matchField);
    const map    = lookupMaps[matchField];
    const matched   = [];
    const unmatched = [];

    for (const row of parsedRows) {
      const cellValue      = (row[option.column] || "").toString().toLowerCase().trim();
      const shopifyProduct = map.get(cellValue);
      if (shopifyProduct) {
        matched.push({
          ...row,
          _shopifyId:     shopifyProduct.id,
          _shopifyTitle:  shopifyProduct.title,
          _shopifyStatus: shopifyProduct.status,
          _matchValue:    row[option.column],
        });
      } else {
        unmatched.push({ ...row, _matchValue: row[option.column] });
      }
    }

    setMatchResult({ matched, unmatched });
    setImportResult(null);
  };

  // ── POST matched rows to server ──
  const handleImport = async () => {
    if (!matchResult?.matched?.length) return;
    setImporting(true);
    setImportResult(null);
    try {
      const res = await fetch("/app/additional", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchedRows: matchResult.matched }),
      });
      const data = await res.json();
      setImportResult(data);
    } catch (err) {
      setImportResult({ updated: 0, errors: [{ message: err.message }] });
    } finally {
      setImporting(false);
    }
  };

  const matchOption    = MATCH_OPTIONS.find((o) => o.value === matchField);
  const matchedCount   = matchResult?.matched?.length  ?? 0;
  const unmatchedCount = matchResult?.unmatched?.length ?? 0;

  return (
    <s-page heading="Product Import">
      {/* Primary action */}
      <s-button
        slot="primary-action"
        onClick={handleImport}
        {...(importing        ? { loading:  true } : {})}
        {...(matchedCount < 1 ? { disabled: true } : {})}
      >
        {importing
          ? "Updating Shopify…"
          : `Import ${matchedCount} Matched Products`}
      </s-button>

      {/* ── Step 1: Upload + select match field ── */}
      <s-section heading="Step 1 — Upload File & Select Match Field">
        <s-paragraph>
          Upload an <strong>.xlsx</strong> file (exported from this app or formatted
          with the same column headers). Then choose which field will be used to
          identify matching products in your Shopify store.
        </s-paragraph>

        <s-stack direction="block" gap="base">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleFileChange}
            style={{ display: "none" }}
          />
          <s-button onClick={() => fileRef.current?.click()}>
            {fileName ? `📂  ${fileName}` : "Choose Excel / CSV File"}
          </s-button>

          {parseError && (
            <s-banner title="File Error" tone="critical" onDismiss={() => setParseError("")}>
              {parseError}
            </s-banner>
          )}

          {parsedRows && (
            <s-stack direction="block" gap="base">
              <s-paragraph>
                <strong>{parsedRows.length}</strong> rows detected in file.
                Columns found:{" "}
                <code>{Object.keys(parsedRows[0] ?? {}).join("  ·  ")}</code>
              </s-paragraph>

              <s-select
                label="Match records by"
                value={matchField}
                onChange={(e) => {
                  setMatchField(e.target.value);
                  setMatchResult(null);
                  setImportResult(null);
                }}
              >
                {MATCH_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </s-select>

              <s-paragraph>
                Your file must have a column named{" "}
                <strong><code>{matchOption.column}</code></strong> for the
                selected match field.
              </s-paragraph>

              <s-button onClick={handleCheckMatch}>
                Check Match
              </s-button>
            </s-stack>
          )}
        </s-stack>
      </s-section>

      {/* ── Step 2: Match Preview ── */}
      {matchResult && (
        <s-section heading="Step 2 — Match Preview">
          <s-stack direction="block" gap="base">

            <s-stack direction="inline" gap="base">
              <s-badge tone="success">✓  {matchedCount} matched</s-badge>
              {unmatchedCount > 0 && (
                <s-badge tone="critical">✗  {unmatchedCount} unmatched</s-badge>
              )}
            </s-stack>

            {matchedCount === 0 && (
              <s-banner title="No matches found" tone="warning">
                None of the rows matched existing Shopify products by{" "}
                <strong>{matchOption.label}</strong>. Try a different match field
                or check your file&apos;s column names and values.
              </s-banner>
            )}

            {/* Unmatched list */}
            {unmatchedCount > 0 && (
              <s-section heading={`Unmatched Rows (${unmatchedCount}) — will be skipped`}>
                <s-paragraph>
                  These rows have no matching Shopify product by{" "}
                  <strong>{matchOption.column}</strong> and will not be imported.
                </s-paragraph>
                <s-box padding="base" background="subdued" borderRadius="base" borderWidth="base">
                  <s-unordered-list>
                    {matchResult.unmatched.slice(0, 25).map((row, i) => (
                      <s-list-item key={i}>
                        <code>{row._matchValue || "(empty)"}</code>
                      </s-list-item>
                    ))}
                    {unmatchedCount > 25 && (
                      <s-list-item>…and {unmatchedCount - 25} more</s-list-item>
                    )}
                  </s-unordered-list>
                </s-box>
              </s-section>
            )}

            {/* Matched list */}
            {matchedCount > 0 && (
              <s-section heading={`Matched Rows (${matchedCount}) — will be updated in Shopify`}>
                <s-paragraph>
                  These products will be updated. Fields present in your file
                  (Title, Vendor, Product Type, Status, Description, Tags, Handle)
                  will be overwritten.
                </s-paragraph>
                <s-box padding="base" background="subdued" borderRadius="base" borderWidth="base">
                  <s-unordered-list>
                    {matchResult.matched.slice(0, 25).map((row, i) => (
                      <s-list-item key={i}>
                        <strong>{row._shopifyTitle}</strong>
                        {"  "}
                        <s-badge tone="info">{row._shopifyStatus}</s-badge>
                        {"  "}
                        <code>{row._matchValue}</code>
                      </s-list-item>
                    ))}
                    {matchedCount > 25 && (
                      <s-list-item>…and {matchedCount - 25} more</s-list-item>
                    )}
                  </s-unordered-list>
                </s-box>
              </s-section>
            )}
          </s-stack>
        </s-section>
      )}

      {/* ── Step 3: Import Result ── */}
      {importResult && (
        <s-section heading="Step 3 — Import Result">
          <s-banner
            title={`${importResult.updated} product${importResult.updated !== 1 ? "s" : ""} updated successfully`}
            tone={importResult.errors?.length ? "warning" : "success"}
          >
            {importResult.errors?.length
              ? `${importResult.errors.length} row(s) had errors — see list below.`
              : "All matched products have been updated in Shopify!"}
          </s-banner>

          {importResult.errors?.length > 0 && (
            <s-box padding="base" background="subdued" borderRadius="base" borderWidth="base">
              <s-unordered-list>
                {importResult.errors.map((err, i) => (
                  <s-list-item key={i}>
                    <strong>{err.title || "?"}</strong>: {err.message}
                  </s-list-item>
                ))}
              </s-unordered-list>
            </s-box>
          )}
        </s-section>
      )}

      {/* ── Aside ── */}
      <s-section slot="aside" heading="How to Import">
        <s-unordered-list>
          <s-list-item><strong>1.</strong> Export products from the Export page</s-list-item>
          <s-list-item><strong>2.</strong> Edit the Excel file as needed</s-list-item>
          <s-list-item><strong>3.</strong> Upload the edited file here</s-list-item>
          <s-list-item><strong>4.</strong> Select match field (Handle recommended)</s-list-item>
          <s-list-item><strong>5.</strong> Click <strong>Check Match</strong> to preview</s-list-item>
          <s-list-item><strong>6.</strong> Review matched / unmatched rows</s-list-item>
          <s-list-item><strong>7.</strong> Click <strong>Import</strong> to update Shopify</s-list-item>
        </s-unordered-list>
      </s-section>

      <s-section slot="aside" heading="Match Fields">
        <s-unordered-list>
          <s-list-item><strong>Handle</strong> — unique URL slug, safest option</s-list-item>
          <s-list-item><strong>Title</strong> — product name (ensure titles are unique)</s-list-item>
        </s-unordered-list>
      </s-section>

      <s-section slot="aside" heading="Fields That Can Be Updated">
        <s-unordered-list>
          <s-list-item>Title</s-list-item>
          <s-list-item>Vendor</s-list-item>
          <s-list-item>Product Type</s-list-item>
          <s-list-item>Status (Active / Draft / Archived)</s-list-item>
          <s-list-item>Description</s-list-item>
          <s-list-item>Tags</s-list-item>
          <s-list-item>Handle</s-list-item>
        </s-unordered-list>
      </s-section>

      <s-section slot="aside" heading="Store Info">
        <s-paragraph>
          <strong>{existingProducts.length}</strong> existing products loaded
          for matching.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);

