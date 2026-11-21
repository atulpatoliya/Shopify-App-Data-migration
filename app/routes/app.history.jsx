/* eslint-disable react/prop-types */
import { useEffect, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getImportJob, listImportJobs, setJobStatus } from "../db.server";
import { undoImport } from "../lib/import.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  return { jobs: await listImportJobs(session.shop) };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const job = await getImportJob(session.shop, Number(form.get("jobId")));
  if (!job) return { error: "Import not found" };
  if (job.status === "undone") return { error: "This import was already undone" };
  if (job.status === "undoing") return { error: "Undo is already running" };

  await setJobStatus(job.id, "undoing");
  const result = await undoImport(admin, job.id);
  await setJobStatus(job.id, result.errors.length && !result.restored && !result.deleted ? "done" : "undone");
  return { ok: true, jobId: job.id, ...result };
};

const STATUS = {
  running: { tone: "info", label: "Running" },
  done: { tone: "success", label: "Completed" },
  undoing: { tone: "warning", label: "Undoing" },
  undone: { tone: undefined, label: "Undone" },
};

const fmt = (iso) => (iso ? new Date(iso).toLocaleString() : "—");

export default function HistoryPage() {
  const { jobs } = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const busyId = fetcher.state !== "idle" ? Number(fetcher.formData?.get("jobId")) : null;

  useEffect(() => {
    const d = fetcher.data;
    if (fetcher.state !== "idle" || !d) return;
    if (d.error) shopify.toast.show(d.error, { isError: true });
    else shopify.toast.show(`Undone: ${d.restored} restored, ${d.deleted} new products deleted`);
  }, [fetcher.state, fetcher.data, shopify]);

  const [pendingId, setPendingId] = useState(null);
  const askUndo = (id) => {
    setPendingId(id);
    document.getElementById("undo-modal")?.showOverlay?.();
  };
  const confirmUndo = () => {
    document.getElementById("undo-modal")?.hideOverlay?.();
    if (pendingId) fetcher.submit({ jobId: String(pendingId) }, { method: "POST" });
  };

  return (
    <s-page heading="Import history">
      <s-link slot="breadcrumb-actions" href="/app">Dashboard</s-link>
      <s-button slot="primary-action" variant="primary" href="/app/import">New import</s-button>

      {fetcher.data?.errors?.length > 0 && (
        <s-banner heading="Some products could not be restored" tone="warning">
          <s-unordered-list>
            {fetcher.data.errors.slice(0, 10).map((e, i) => (
              <s-list-item key={i}>{e.productId}: {e.message}</s-list-item>
            ))}
          </s-unordered-list>
        </s-banner>
      )}

      <s-section padding="none">
        {jobs.length === 0 ? (
          <s-box padding="large-200">
            <s-stack alignItems="center" gap="small-200">
              <s-heading>No imports yet</s-heading>
              <s-text color="subdued">Your imports and their backups will appear here.</s-text>
              <s-button href="/app/import">Import products</s-button>
            </s-stack>
          </s-box>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">File</s-table-header>
              <s-table-header>Date</s-table-header>
              <s-table-header format="numeric">Updated</s-table-header>
              <s-table-header format="numeric">Created</s-table-header>
              <s-table-header format="numeric">Failed</s-table-header>
              <s-table-header listSlot="secondary">Status</s-table-header>
              <s-table-header>Actions</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {jobs.map((j) => {
                const st = STATUS[j.status] ?? STATUS.done;
                const canUndo = j.status === "done" && j.updated + j.created > 0;
                return (
                  <s-table-row key={j.id}>
                    <s-table-cell>
                      <s-stack gap="small-300">
                        <s-text>{j.file_name || `Import #${j.id}`}</s-text>
                        {j.user_name && <s-text color="subdued">{j.user_name}</s-text>}
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell>{fmt(j.created_at)}</s-table-cell>
                    <s-table-cell>{j.updated}</s-table-cell>
                    <s-table-cell>{j.created}</s-table-cell>
                    <s-table-cell>{j.failed}</s-table-cell>
                    <s-table-cell>
                      <s-badge tone={st.tone}>{st.label}</s-badge>
                      {j.undone_at && <s-text color="subdued"> {fmt(j.undone_at)}</s-text>}
                    </s-table-cell>
                    <s-table-cell>
                      {canUndo && (
                        <s-button
                          tone="critical"
                          variant="tertiary"
                          onClick={() => askUndo(j.id)}
                          {...(busyId === j.id ? { loading: true } : {})}
                          {...(busyId && busyId !== j.id ? { disabled: true } : {})}
                        >
                          Undo
                        </s-button>
                      )}
                    </s-table-cell>
                  </s-table-row>
                );
              })}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-modal id="undo-modal" heading="Undo this import?">
        <s-paragraph>
          Updated products get their previous values back, and products this import created are deleted.
        </s-paragraph>
        <s-button slot="primary-action" variant="primary" tone="critical" onClick={confirmUndo}>Undo import</s-button>
        <s-button slot="secondary-actions" commandFor="undo-modal" command="--hide">Cancel</s-button>
      </s-modal>

      <s-section slot="aside" heading="How undo works">
        <s-unordered-list>
          <s-list-item>Before each import, the current values of every product it changes are saved.</s-list-item>
          <s-list-item>Undo restores titles, details, prices, SKUs, barcodes, stock and metafields.</s-list-item>
          <s-list-item>Products the import created are deleted.</s-list-item>
          <s-list-item>Images added to existing products are kept.</s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
