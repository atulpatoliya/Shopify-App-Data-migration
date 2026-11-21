/* eslint-disable react/prop-types */
import { useState, useMemo, useEffect, useRef } from "react";
import { useLoaderData, useFetcher } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getCurrentPlan, planSelectionUrl } from "../plans.server";
import { addJobCounts, createImportJob, getImportJob, setJobStatus } from "../db.server";
import { checkImageUrls, createProduct, LOCATIONS, updateProduct } from "../lib/import.server";
import { normalizeImportRows } from "../lib/product-format";

// ─────────────────────────────────────────────────────────────────────────────
// SERVER: Loader — product identifiers for matching, locations for inventory
// ─────────────────────────────────────────────────────────────────────────────
export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const plan = await getCurrentPlan(admin);

  const existingProducts = [];
  let after = null;
  for (;;) {
    const res = await admin.graphql(
      `#graphql
        query getProductIds($first: Int!, $after: String) {
          products(first: $first, after: $after) {
            pageInfo { hasNextPage endCursor }
            nodes { id handle title status }
          }
        }
      `,
      { variables: { first: 250, after } },
    );
    const json = await res.json();
    if (json.errors) throw new Error(json.errors.map((e) => e.message).join(", "));
    existingProducts.push(...json.data.products.nodes);
    if (!json.data.products.pageInfo.hasNextPage) break;
    after = json.data.products.pageInfo.endCursor;
  }

  let locations = [];
  try {
    const json = await (await admin.graphql(LOCATIONS)).json();
    locations = (json.data?.locations?.nodes ?? []).filter((l) => l.isActive);
  } catch {
    locations = []; // missing read_locations scope → inventory import is hidden
  }

  return { existingProducts, locations, plan, changePlanUrl: planSelectionUrl(session.shop) };
};

// ─────────────────────────────────────────────────────────────────────────────
// SERVER: Action — start a job, run batches, finish. Every change is backed up
// so the whole import can be undone from Import history.
// ─────────────────────────────────────────────────────────────────────────────
export const action = async ({ request }) => {
  const { admin, session, sessionToken } = await authenticate.admin(request);
  const body = await request.json().catch(() => ({}));

  // Preview: check which image links really open an image (max 50 per call).
  if (body.intent === "check_images") {
    const urls = (Array.isArray(body.urls) ? body.urls : [])
      .filter((u) => typeof u === "string" && /^https?:\/\//i.test(u))
      .slice(0, 50);
    const { broken } = await checkImageUrls(urls);
    return Response.json({ checked: urls, broken });
  }

  if (body.intent === "start") {
    const jobId = await createImportJob({
      shop: session.shop,
      fileName: String(body.fileName || "").slice(0, 200),
      userName: sessionToken?.sub ? `Staff ${sessionToken.sub}` : null,
    });
    return Response.json({ jobId });
  }

  const job = await getImportJob(session.shop, Number(body.jobId));
  if (!job) return Response.json({ error: "Import not found" }, { status: 404 });

  if (body.intent === "finish") {
    await setJobStatus(job.id, "done");
    return Response.json({ ok: true });
  }

  // intent: "batch"
  const plan = await getCurrentPlan(admin);
  const already = Number(body.processed || 0);
  const all = Array.isArray(body.groups) ? body.groups : [];
  const remaining = plan.limit == null ? Infinity : Math.max(0, plan.limit - already);
  const groups = all.slice(0, remaining);
  const opts = {
    jobId: job.id,
    newStatus: ["ACTIVE", "DRAFT", "FILE"].includes(body.newStatus) ? body.newStatus : "DRAFT",
    locationId:
      typeof body.locationId === "string" && body.locationId.startsWith("gid://shopify/Location/") ? body.locationId : null,
    updateInventory: Boolean(body.updateInventory),
    addImages: Boolean(body.addImages),
  };

  const totals = { updated: 0, created: 0, variants: 0, inventory: 0, images: 0, metafields: 0 };
  const brokenImageProducts = [];
  const errors = [];
  for (const group of groups) {
    const label = group.title || group.key || "Product";
    try {
      if (group.existingId) {
        const s = await updateProduct(admin, group, opts);
        totals.updated += 1;
        for (const k of ["variants", "inventory", "images", "metafields"]) totals[k] += s[k];
        if (s.brokenImages) brokenImageProducts.push({ title: label, count: s.brokenImages });
      } else {
        const c = await createProduct(admin, group, opts);
        totals.created += 1;
        if (c.brokenImages) brokenImageProducts.push({ title: label, count: c.brokenImages });
      }
    } catch (err) {
      errors.push({ title: label, message: err.message });
    }
  }
  await addJobCounts(job.id, { updated: totals.updated, created: totals.created, failed: errors.length });
  for (const b of brokenImageProducts) {
    errors.push({ title: b.title, message: `${b.count} image link(s) skipped — the URL doesn't open an image (deleted or private)` });
  }
  return Response.json({ ...totals, errors, skippedByPlan: all.length - groups.length });
};

// ─────────────────────────────────────────────────────────────────────────────
// CLIENT
// ─────────────────────────────────────────────────────────────────────────────
const MATCH_OPTIONS = [
  { label: "Handle (recommended)", value: "handle", column: "Handle" },
  { label: "Product title", value: "title", column: "Title" },
];
const PRODUCT_FIELDS = ["Title", "Vendor", "Product Type", "Status", "Description", "Tags", "Handle", "SEO Title", "SEO Description"];
const VARIANT_FIELDS = ["Variant Price", "Compare At Price", "Variant SKU", "Barcode", "Inventory Qty"];
const PREVIEW_LIMIT = 50;
const BATCH_SIZE = 10;
const s_ = (v) => (v == null ? "" : String(v).trim());
const firstFilled = (rows, col) => rows.map((r) => s_(r[col])).find(Boolean) || "";

function groupRows(rows, field, lookup, allowCreate) {
  const column = MATCH_OPTIONS.find((o) => o.value === field).column;
  const groups = new Map();
  const skipped = [];
  rows.forEach((row, i) => {
    const key = s_(row[column]);
    if (!key) {
      skipped.push({ key: `Row ${i + 2}`, reason: `Empty ${column}` });
      return;
    }
    const k = key.toLowerCase();
    if (!groups.has(k)) groups.set(k, { key, rows: [] });
    groups.get(k).rows.push(row);
  });

  const update = [];
  const create = [];
  for (const g of groups.values()) {
    const existing = lookup.get(g.key.toLowerCase());
    const variantCount = new Set(g.rows.map((r) => s_(r["Variant Title"]).toLowerCase() || "default")).size;
    if (existing) {
      update.push({ ...g, existingId: existing.id, title: existing.title, variantCount });
    } else if (!allowCreate) {
      skipped.push({ key: g.key, reason: "No matching product (creating new products is off)" });
    } else if (!firstFilled(g.rows, "Title")) {
      skipped.push({ key: g.key, reason: "New product needs a Title" });
    } else {
      create.push({ ...g, existingId: null, title: firstFilled(g.rows, "Title"), variantCount });
    }
  }
  return { update, create, skipped };
}

const VARIANT_COLUMNS = [
  "Variant Title", "Variant SKU", "Variant Price", "Compare At Price", "Inventory Qty", "Barcode", "Weight",
];
const HIDDEN_PRODUCT_COLUMNS = new Set([...VARIANT_COLUMNS, "Image URLs", "Option1 Name", "Option2 Name", "Option3 Name"]);
const splitImageUrls = (v) => s_(v).split(/[\n,]+/).map((u) => u.trim()).filter((u) => /^https?:\/\//i.test(u));
const shortUrl = (u) => (u.length > 70 ? `${u.slice(0, 45)}…${u.slice(-20)}` : u);

function groupImages(g) {
  return [...new Set(splitImageUrls(firstFilled(g.rows, "Image URLs")))];
}

function groupInfo(g, imageStatus) {
  const images = groupImages(g);
  const st = images.map((u) => imageStatus[u]);
  const prices = g.rows.map((r) => Number(s_(r["Variant Price"]).replace(/[^0-9.]/g, ""))).filter((n) => n > 0);
  const stocks = g.rows.map((r) => s_(r["Inventory Qty"])).filter((v) => v !== "");
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return {
    images,
    ok: st.filter((x) => x === "ok").length,
    broken: st.filter((x) => x === "broken").length,
    pending: st.filter((x) => !x).length,
    thumb: images.find((u) => imageStatus[u] === "ok") || null,
    price: prices.length ? (min === max ? min.toFixed(2) : `${min.toFixed(2)} – ${max.toFixed(2)}`) : "",
    stock: stocks.length ? stocks.reduce((a, b) => a + (Number(b) || 0), 0) : null,
  };
}

function ProductDetail({ group, imageStatus, columns }) {
  const productCols = columns.filter((c) => !HIDDEN_PRODUCT_COLUMNS.has(c));
  const variantCols = VARIANT_COLUMNS.filter((c) => columns.includes(c));
  const optionNames = [1, 2, 3].map((n) => firstFilled(group.rows, `Option${n} Name`)).filter(Boolean);
  const images = groupImages(group);

  return (
    <s-stack gap="base">
      <s-stack gap="small-200">
        <s-heading>Product details</s-heading>
        <s-box border="base" borderRadius="base" padding="small-200">
          <s-stack gap="small-200">
            {productCols.map((c) => {
              const v = firstFilled(group.rows, c);
              return (
                <s-grid key={c} gridTemplateColumns="180px 1fr" gap="base">
                  <s-text color="subdued">{c}</s-text>
                  <s-text>{v ? (v.length > 400 ? `${v.slice(0, 400)}…` : v) : "—"}</s-text>
                </s-grid>
              );
            })}
            {optionNames.length > 0 && (
              <s-grid gridTemplateColumns="180px 1fr" gap="base">
                <s-text color="subdued">Options</s-text>
                <s-text>{optionNames.join(", ")}</s-text>
              </s-grid>
            )}
          </s-stack>
        </s-box>
      </s-stack>

      {variantCols.length > 0 && (
        <s-stack gap="small-200">
          <s-heading>Variants ({group.rows.length})</s-heading>
          <s-table>
            <s-table-header-row>
              {variantCols.map((c, i) => (
                <s-table-header key={c} {...(i === 0 ? { listSlot: "primary" } : {})}>{c}</s-table-header>
              ))}
            </s-table-header-row>
            <s-table-body>
              {group.rows.map((r, i) => (
                <s-table-row key={i}>
                  {variantCols.map((c) => <s-table-cell key={c}>{s_(r[c]) || "—"}</s-table-cell>)}
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-stack>
      )}

      <s-stack gap="small-200">
        <s-heading>Images ({images.length})</s-heading>
        {images.length === 0 ? (
          <s-text color="subdued">No images in the file for this product.</s-text>
        ) : (
          <s-grid gridTemplateColumns="repeat(auto-fill, minmax(140px, 1fr))" gap="base">
            {images.map((u) => {
              const st = imageStatus[u];
              return (
                <s-box key={u} border="base" borderRadius="base" padding="small-200">
                  <s-stack gap="small-200">
                    {st === "ok" ? (
                      <s-image src={u} alt="" aspectRatio="1/1" objectFit="cover" borderRadius="base" />
                    ) : (
                      <s-box background="subdued" borderRadius="base" padding="large-200">
                        <s-stack alignItems="center">
                          <s-icon type={st === "broken" ? "alert-triangle" : "image"} />
                        </s-stack>
                      </s-box>
                    )}
                    {st === "ok" && <s-badge tone="success">Valid</s-badge>}
                    {st === "broken" && <s-badge tone="critical">Invalid — will be skipped</s-badge>}
                    {!st && <s-badge>Checking…</s-badge>}
                    <s-link href={u} target="_blank">Open link</s-link>
                  </s-stack>
                </s-box>
              );
            })}
          </s-grid>
        )}
      </s-stack>
    </s-stack>
  );
}

export default function ImportPage() {
  const { existingProducts, locations, plan, changePlanUrl } = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();

  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState(null);
  const [fileFormat, setFileFormat] = useState("app");
  const [parseError, setParseError] = useState("");
  const [matchField, setMatchField] = useState("handle");
  const [allowCreate, setAllowCreate] = useState(true);
  const [newStatus, setNewStatus] = useState("DRAFT");
  const [updateInventory, setUpdateInventory] = useState(false);
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [addImages, setAddImages] = useState(false);
  const [tab, setTab] = useState("update");
  const [run, setRun] = useState(null);
  const [result, setResult] = useState(null);
  const runRef = useRef(null);
  const imgFetcher = useFetcher();
  const [imageStatus, setImageStatus] = useState({}); // url -> "ok" | "broken"
  const imgQueueRef = useRef([]);
  const [detail, setDetail] = useState(null);

  // Image links are checked on the server in batches of 50 (browsers can't check other sites).
  function checkNextImages() {
    const batch = imgQueueRef.current.slice(0, 50);
    if (!batch.length) return;
    imgQueueRef.current = imgQueueRef.current.slice(50);
    imgFetcher.submit({ intent: "check_images", urls: batch }, { method: "POST", encType: "application/json" });
  }
  useEffect(() => {
    const d = imgFetcher.data;
    if (imgFetcher.state !== "idle" || !d?.checked) return;
    const broken = new Set(d.broken);
    setImageStatus((prev) => {
      const next = { ...prev };
      for (const u of d.checked) next[u] = broken.has(u) ? "broken" : "ok";
      return next;
    });
    checkNextImages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imgFetcher.state, imgFetcher.data]);

  const lookup = useMemo(() => {
    const m = { handle: new Map(), title: new Map() };
    for (const p of existingProducts) {
      if (p.handle) m.handle.set(p.handle.toLowerCase(), p);
      if (p.title) m.title.set(p.title.toLowerCase(), p);
    }
    return m;
  }, [existingProducts]);

  const preview = useMemo(
    () => (rows ? groupRows(rows, matchField, lookup[matchField], allowCreate) : null),
    [rows, matchField, lookup, allowCreate],
  );

  const matchOption = MATCH_OPTIONS.find((o) => o.value === matchField);
  const columns = rows ? [...new Set(rows.flatMap((r) => Object.keys(r)))] : [];
  const missingMatchColumn = rows && !columns.includes(matchOption.column);
  const productFieldsInFile = PRODUCT_FIELDS.filter((f) => columns.includes(f));
  const variantFieldsInFile = VARIANT_FIELDS.filter((f) => columns.includes(f));
  const metafieldCols = columns.filter((c) => c.startsWith("Metafield: "));
  const hasInventory = columns.includes("Inventory Qty");
  const hasImages = columns.includes("Image URLs");

  const updateCount = preview?.update.length ?? 0;
  const createCount = preview?.create.length ?? 0;
  const skippedCount = preview?.skipped.length ?? 0;
  const totalCount = updateCount + createCount;
  const allowedCount = plan.limit == null ? totalCount : Math.min(totalCount, plan.limit);
  const overLimit = plan.limit != null && totalCount > plan.limit;
  const running = Boolean(run);

  const resetFile = () => {
    setFileName("");
    setRows(null);
    setParseError("");
    setResult(null);
    setImageStatus({});
    imgQueueRef.current = [];
  };

  const handleFile = async (file) => {
    if (!file) return;
    resetFile();
    setFileName(file.name);
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
      if (!raw.length) {
        setParseError("The file is empty. Add at least one product row and try again.");
        return;
      }
      const normalized = normalizeImportRows(raw);
      setRows(normalized.rows);
      setFileFormat(normalized.format);
      const urls = [...new Set(normalized.rows.flatMap((r) => splitImageUrls(r["Image URLs"])))];
      setImageStatus({});
      imgQueueRef.current = urls;
      checkNextImages();
      setTab("update");
    } catch (err) {
      setParseError("The file could not be read: " + err.message);
    }
  };

  const post = (payload) => fetcher.submit(payload, { method: "POST", encType: "application/json" });

  const sendNext = (state) => {
    const batch = state.queue.slice(0, BATCH_SIZE);
    runRef.current = { ...state, stage: "batch", queue: state.queue.slice(BATCH_SIZE), inFlight: batch.length };
    setRun(runRef.current);
    post({
      intent: "batch",
      jobId: state.jobId,
      processed: state.processed,
      newStatus,
      locationId: locationId || null,
      updateInventory: updateInventory && hasInventory,
      addImages,
      groups: batch.map(({ key, rows: r, existingId, title }) => ({ key, rows: r, existingId, title })),
    });
  };

  const startImport = () => {
    document.getElementById("confirm-import-modal")?.hideOverlay?.();
    if (!preview || !allowedCount) return;
    const queue = [...preview.update, ...preview.create].slice(0, allowedCount);
    setResult(null);
    runRef.current = {
      stage: "start",
      queue,
      processed: 0,
      total: queue.length,
      totals: { updated: 0, created: 0, variants: 0, inventory: 0, images: 0, metafields: 0, errors: [] },
    };
    setRun(runRef.current);
    post({ intent: "start", fileName });
  };

  useEffect(() => {
    const state = runRef.current;
    if (!state || fetcher.state !== "idle" || !fetcher.data) return;
    const d = fetcher.data;

    if (state.stage === "start") {
      if (!d.jobId) {
        runRef.current = null;
        setRun(null);
        setResult({ ...state.totals, errors: [{ title: "Import", message: d.error || "Could not start" }] });
        return;
      }
      sendNext({ ...state, jobId: d.jobId });
      return;
    }

    if (state.stage === "batch") {
      const t = state.totals;
      const totals = {
        updated: t.updated + (d.updated || 0),
        created: t.created + (d.created || 0),
        variants: t.variants + (d.variants || 0),
        inventory: t.inventory + (d.inventory || 0),
        images: t.images + (d.images || 0),
        metafields: t.metafields + (d.metafields || 0),
        errors: [...t.errors, ...(d.errors || []), ...(d.error ? [{ title: "Import", message: d.error }] : [])],
      };
      const next = { ...state, processed: state.processed + state.inFlight, totals };
      if (next.queue.length && !d.skippedByPlan && !d.error) {
        sendNext(next);
        return;
      }
      runRef.current = { ...next, stage: "finish" };
      setRun(runRef.current);
      post({ intent: "finish", jobId: state.jobId });
      return;
    }

    // finish
    runRef.current = null;
    setRun(null);
    setResult({ ...state.totals, jobId: state.jobId });
    const t = state.totals;
    shopify.toast.show(
      `${t.updated} updated, ${t.created} created${t.errors.length ? `, ${t.errors.length} failed` : ""}`,
      { isError: t.updated + t.created === 0 && t.errors.length > 0 },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

  const tabRows = tab === "update" ? preview?.update : tab === "create" ? preview?.create : preview?.skipped;

  const importGroups = useMemo(() => (preview ? [...preview.update, ...preview.create] : []), [preview]);
  const imageTotals = useMemo(() => {
    const urls = [...new Set(importGroups.flatMap(groupImages))];
    const ok = urls.filter((u) => imageStatus[u] === "ok").length;
    const broken = urls.filter((u) => imageStatus[u] === "broken").length;
    return { total: urls.length, ok, broken, pending: urls.length - ok - broken };
  }, [importGroups, imageStatus]);
  const brokenList = useMemo(
    () => importGroups.flatMap((g) => groupImages(g).filter((u) => imageStatus[u] === "broken").map((url) => ({ title: g.title, url }))),
    [importGroups, imageStatus],
  );

  const openDetail = (g) => {
    setDetail(g);
    requestAnimationFrame(() => document.getElementById("product-detail-modal")?.showOverlay?.());
  };

  return (
    <s-page heading="Import products">
      <s-link slot="breadcrumb-actions" href="/app">Dashboard</s-link>
      <s-button
        slot="primary-action"
        variant="primary"
        commandFor="confirm-import-modal"
        command="--show"
        {...(running ? { loading: true } : {})}
        {...(allowedCount < 1 ? { disabled: true } : {})}
      >
        Import {allowedCount} products
      </s-button>
      <s-button slot="secondary-actions" href="/app/history">Import history</s-button>
      <s-button slot="secondary-actions" href="/app/export">Export a template</s-button>

      {overLimit && (
        <s-banner heading={`Your ${plan.name} plan imports up to ${plan.limit.toLocaleString()} products at a time`} tone="warning">
          This file has {totalCount.toLocaleString()} products. The first {plan.limit.toLocaleString()} will be
          imported (updates first).{" "}
          <s-link href={changePlanUrl} target="_top">Upgrade your plan</s-link> to import more at once.
        </s-banner>
      )}

      {running && (
        <s-banner heading="Importing…" tone="info">
          {run.processed} of {run.total} products done. Keep this page open.
        </s-banner>
      )}

      {result && !running && (
        <s-banner
          heading={`${result.updated} updated · ${result.created} created`}
          tone={result.errors.length ? "warning" : "success"}
          dismissible
          onDismiss={() => setResult(null)}
        >
          <s-stack gap="small-200">
            <s-text>
              {[
                result.variants && `${result.variants} variants`,
                result.inventory && `${result.inventory} stock levels`,
                result.images && `${result.images} images`,
                result.metafields && `${result.metafields} metafields`,
              ].filter(Boolean).join(" · ") || "Done."}
            </s-text>
            {result.jobId && (
              <s-text>
                A backup was saved. You can undo this import from <s-link href="/app/history">Import history</s-link>.
              </s-text>
            )}
            {result.errors.length > 0 && (
              <s-unordered-list>
                {result.errors.slice(0, 20).map((e, i) => (
                  <s-list-item key={i}>
                    <s-text type="strong">{e.title}</s-text>: {e.message}
                  </s-list-item>
                ))}
              </s-unordered-list>
            )}
          </s-stack>
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
                  {rows && <s-badge>{rows.length} rows</s-badge>}
                  {fileFormat === "shopify" && <s-badge tone="info">Shopify CSV format</s-badge>}
                </s-stack>
                <s-button variant="tertiary" onClick={resetFile} {...(running ? { disabled: true } : {})}>
                  Remove
                </s-button>
              </s-stack>
            </s-box>
          )}
          <s-text color="subdued">
            Accepts this app&apos;s Excel export or Shopify&apos;s product CSV (.xlsx, .xls, .csv). Rows with the same handle
            become one product with variants.
          </s-text>
          {parseError && (
            <s-banner heading="File error" tone="critical" dismissible onDismiss={() => setParseError("")}>
              {parseError}
            </s-banner>
          )}
        </s-stack>
      </s-section>

      {rows && (
        <s-section heading="2. Import settings">
          <s-stack gap="base">
            <s-grid gridTemplateColumns="repeat(auto-fit, minmax(240px, 1fr))" gap="base">
              <s-select label="Match file rows to store products by" value={matchField}
                onChange={(e) => setMatchField(e.currentTarget.value)}>
                {MATCH_OPTIONS.map((o) => <s-option key={o.value} value={o.value}>{o.label}</s-option>)}
              </s-select>
              <s-select label="Status for new products" value={newStatus}
                onChange={(e) => setNewStatus(e.currentTarget.value)} {...(!allowCreate ? { disabled: true } : {})}>
                <s-option value="DRAFT">Draft (review before selling)</s-option>
                <s-option value="ACTIVE">Active</s-option>
                <s-option value="FILE">Use Status column from file</s-option>
              </s-select>
            </s-grid>

            <s-checkbox
              label="Create new products for rows that don't match an existing product"
              details="Turn off to only update existing products."
              checked={allowCreate}
              onChange={(e) => setAllowCreate(e.currentTarget.checked)}
            />

            {hasImages && (
              <s-checkbox
                label="Add images from the Image URLs column to existing products"
                details="New products always get their images. Images already in Shopify are skipped."
                checked={addImages}
                onChange={(e) => setAddImages(e.currentTarget.checked)}
              />
            )}

            {hasInventory && locations.length > 0 && (
              <s-stack gap="small-200">
                <s-checkbox
                  label="Update stock from the Inventory Qty column"
                  details="Sets the available quantity at the chosen location. New products always get their stock there."
                  checked={updateInventory}
                  onChange={(e) => setUpdateInventory(e.currentTarget.checked)}
                />
                <s-box maxInlineSize="360px">
                  <s-select label="Location" value={locationId} onChange={(e) => setLocationId(e.currentTarget.value)}>
                    {locations.map((l) => <s-option key={l.id} value={l.id}>{l.name}</s-option>)}
                  </s-select>
                </s-box>
              </s-stack>
            )}

            {missingMatchColumn && (
              <s-banner tone="warning" heading={`Column "${matchOption.column}" not found`}>
                Your file needs a column named {matchOption.column} to match by this field.
              </s-banner>
            )}

            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-text color="subdued">Product fields:</s-text>
              {productFieldsInFile.length ? productFieldsInFile.map((f) => <s-badge key={f}>{f}</s-badge>) : <s-badge tone="warning">None</s-badge>}
            </s-stack>
            {variantFieldsInFile.length > 0 && (
              <s-stack direction="inline" gap="small-200" alignItems="center">
                <s-text color="subdued">Variant fields:</s-text>
                {variantFieldsInFile.map((f) => <s-badge key={f}>{f}</s-badge>)}
              </s-stack>
            )}
            {metafieldCols.length > 0 && (
              <s-stack direction="inline" gap="small-200" alignItems="center">
                <s-text color="subdued">Metafields:</s-text>
                <s-badge>{metafieldCols.length} columns</s-badge>
              </s-stack>
            )}
          </s-stack>
        </s-section>
      )}

      {preview && (
        <s-section heading="3. Review changes" padding="none">
          <s-box padding="base">
            <s-stack gap="base">
              <s-grid gridTemplateColumns="repeat(auto-fit, minmax(150px, 1fr))" gap="base">
                <Summary label="Will update" value={updateCount} />
                <Summary label="Will create" value={createCount} />
                <Summary label="Skipped" value={skippedCount} />
                <s-box padding="base" border="base" borderRadius="base">
                  <s-stack gap="small-300">
                    <s-text color="subdued">Images</s-text>
                    {imageTotals.total === 0 ? (
                      <s-heading>0</s-heading>
                    ) : (
                      <s-stack direction="inline" gap="small-200" alignItems="center">
                        <s-badge tone="success">{imageTotals.ok} valid</s-badge>
                        {imageTotals.broken > 0 && <s-badge tone="critical">{imageTotals.broken} invalid</s-badge>}
                        {imageTotals.pending > 0 && <s-badge>Checking {imageTotals.pending}…</s-badge>}
                      </s-stack>
                    )}
                  </s-stack>
                </s-box>
              </s-grid>
              <s-stack direction="inline" gap="small-200">
                {[
                  ["update", `Will update (${updateCount})`],
                  ["create", `Will create (${createCount})`],
                  ["skipped", `Skipped (${skippedCount})`],
                  ["images", `Image problems (${brokenList.length})`],
                ].map(([id, label]) => (
                  <s-button key={id} variant={tab === id ? "secondary" : "tertiary"} onClick={() => setTab(id)}>{label}</s-button>
                ))}
              </s-stack>
            </s-stack>
          </s-box>

          {tab === "images" ? (
            brokenList.length === 0 ? (
              <s-box padding="large-200">
                <s-stack alignItems="center" gap="small-200">
                  <s-heading>{imageTotals.pending ? "Checking images…" : "All image links work"}</s-heading>
                  <s-text color="subdued">Invalid image links are skipped during import; the product is still saved.</s-text>
                </s-stack>
              </s-box>
            ) : (
              <s-table>
                <s-table-header-row>
                  <s-table-header listSlot="primary">Product</s-table-header>
                  <s-table-header>Image link</s-table-header>
                  <s-table-header listSlot="secondary">Status</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {brokenList.slice(0, 200).map((b, i) => (
                    <s-table-row key={`${b.url}-${i}`}>
                      <s-table-cell>{b.title}</s-table-cell>
                      <s-table-cell>
                        <s-link href={b.url} target="_blank">{shortUrl(b.url)}</s-link>
                      </s-table-cell>
                      <s-table-cell><s-badge tone="critical">Not an image / not found</s-badge></s-table-cell>
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>
            )
          ) : !tabRows?.length ? (
            <s-box padding="large-200">
              <s-stack alignItems="center" gap="small-200">
                <s-heading>Nothing here</s-heading>
                <s-text color="subdued">
                  {tab === "update"
                    ? `No rows match an existing product by ${matchOption.column.toLowerCase()}.`
                    : tab === "create"
                      ? allowCreate ? "Every product in the file already exists." : "Creating new products is turned off."
                      : "Every row can be imported."}
                </s-text>
              </s-stack>
            </s-box>
          ) : tab === "skipped" ? (
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">{matchOption.column} in file</s-table-header>
                <s-table-header>Reason</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {tabRows.slice(0, PREVIEW_LIMIT).map((g, i) => (
                  <s-table-row key={`${g.key}-${i}`}>
                    <s-table-cell>{g.key}</s-table-cell>
                    <s-table-cell>{g.reason}</s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          ) : (
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Product</s-table-header>
                <s-table-header>{matchOption.column}</s-table-header>
                <s-table-header format="numeric">Variants</s-table-header>
                <s-table-header>Price</s-table-header>
                <s-table-header>Stock</s-table-header>
                <s-table-header>Images</s-table-header>
                <s-table-header listSlot="secondary">Action</s-table-header>
                <s-table-header>Details</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {tabRows.slice(0, PREVIEW_LIMIT).map((g, i) => {
                  const info = groupInfo(g, imageStatus);
                  return (
                    <s-table-row key={`${g.key}-${i}`}>
                      <s-table-cell>
                        <s-stack direction="inline" gap="small-200" alignItems="center">
                          {info.thumb ? <s-thumbnail src={info.thumb} alt={g.title} size="small-200" /> : null}
                          <s-text>{g.title}</s-text>
                        </s-stack>
                      </s-table-cell>
                      <s-table-cell>{g.key}</s-table-cell>
                      <s-table-cell>{g.variantCount}</s-table-cell>
                      <s-table-cell>{info.price || "—"}</s-table-cell>
                      <s-table-cell>{info.stock ?? "—"}</s-table-cell>
                      <s-table-cell>
                        {info.images.length === 0 ? (
                          "—"
                        ) : (
                          <s-stack direction="inline" gap="small-300">
                            {info.ok > 0 && <s-badge tone="success">✓ {info.ok}</s-badge>}
                            {info.broken > 0 && <s-badge tone="critical">✗ {info.broken}</s-badge>}
                            {info.pending > 0 && <s-badge>… {info.pending}</s-badge>}
                          </s-stack>
                        )}
                      </s-table-cell>
                      <s-table-cell>
                        {tab === "update" ? <s-badge tone="info">Update</s-badge> : <s-badge tone="success">New</s-badge>}
                      </s-table-cell>
                      <s-table-cell>
                        <s-button variant="tertiary" onClick={() => openDetail(g)}>View</s-button>
                      </s-table-cell>
                    </s-table-row>
                  );
                })}
              </s-table-body>
            </s-table>
          )}
          {tab !== "images" && tabRows?.length > PREVIEW_LIMIT && (
            <s-box padding="base">
              <s-text color="subdued">Showing first {PREVIEW_LIMIT} of {tabRows.length}.</s-text>
            </s-box>
          )}
        </s-section>
      )}

      <s-modal id="product-detail-modal" heading={detail ? detail.title : "Product"} size="large">
        {detail && <ProductDetail group={detail} imageStatus={imageStatus} columns={columns} />}
        <s-button slot="secondary-actions" commandFor="product-detail-modal" command="--hide">Close</s-button>
      </s-modal>

      <s-section slot="aside" heading="Safe to try">
        <s-paragraph>
          Every import saves a backup first. If something looks wrong, undo the whole import from{" "}
          <s-link href="/app/history">Import history</s-link>.
        </s-paragraph>
      </s-section>

      <s-section slot="aside" heading="Adding new products">
        <s-unordered-list>
          <s-list-item>Add a row with a new Handle and a Title.</s-list-item>
          <s-list-item>One row per variant with the same Handle and a Variant Title like &quot;Red / S&quot;.</s-list-item>
          <s-list-item>Optional: price, compare-at, SKU, barcode, stock, images, metafields.</s-list-item>
          <s-list-item>New products are saved as Draft by default.</s-list-item>
        </s-unordered-list>
      </s-section>

      <s-section slot="aside" heading="Good to know">
        <s-unordered-list>
          <s-list-item>Empty cells are ignored, so existing values are kept.</s-list-item>
          <s-list-item>Variants are matched by SKU, then by Variant Title.</s-list-item>
          <s-list-item>Shopify CSV files from other stores work too.</s-list-item>
          <s-list-item>{existingProducts.length.toLocaleString()} store products available for matching.</s-list-item>
        </s-unordered-list>
      </s-section>

      <s-modal id="confirm-import-modal" heading="Import products to Shopify?">
        <s-stack gap="small-200">
          <s-paragraph>
            {Math.min(updateCount, allowedCount)} existing products will be updated and{" "}
            {Math.max(0, allowedCount - updateCount)} new products will be created from {fileName || "your file"}.
          </s-paragraph>
          {imageTotals.broken > 0 && (
            <s-paragraph>{imageTotals.broken} invalid image links will be skipped. The products are still saved.</s-paragraph>
          )}
          <s-paragraph color="subdued">A backup is saved first, so you can undo this import later.</s-paragraph>
        </s-stack>
        <s-button slot="primary-action" variant="primary" onClick={startImport}>
          Import {allowedCount} products
        </s-button>
        <s-button slot="secondary-actions" commandFor="confirm-import-modal" command="--hide">Cancel</s-button>
      </s-modal>
    </s-page>
  );
}

function Summary({ label, value }) {
  return (
    <s-box padding="base" border="base" borderRadius="base">
      <s-stack gap="small-300">
        <s-text color="subdued">{label}</s-text>
        <s-heading>{value.toLocaleString()}</s-heading>
      </s-stack>
    </s-box>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
