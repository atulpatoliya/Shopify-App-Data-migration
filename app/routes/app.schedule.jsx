/* eslint-disable react/prop-types */
import { useEffect, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getSchedule, markScheduleRun, saveSchedule } from "../db.server";
import { mailConfigured } from "../lib/mailer.server";
import { runScheduledExport } from "../lib/scheduled-export.server";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const saved = await getSchedule(session.shop);
  const shop = (await (await admin.graphql(`#graphql
    query shopTz { shop { email ianaTimezone } }
  `)).json()).data?.shop ?? {};
  return {
    mailReady: mailConfigured(),
    timezone: shop.ianaTimezone || "UTC",
    schedule: {
      enabled: Boolean(saved?.enabled),
      frequency: saved?.frequency ?? "weekly",
      weekday: saved?.weekday ?? 1,
      hour: saved?.hour ?? 8,
      email: saved?.email ?? shop.email ?? "",
      format: saved?.format ?? "xlsx",
      query: saved?.query ?? "",
      lastRunAt: saved?.last_run_at ?? null,
      lastStatus: saved?.last_status ?? null,
    },
  };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const f = await request.formData();
  const s = {
    enabled: f.get("enabled") === "true",
    frequency: f.get("frequency") === "daily" ? "daily" : "weekly",
    weekday: Math.min(6, Math.max(0, Number(f.get("weekday")) || 0)),
    hour: Math.min(23, Math.max(0, Number(f.get("hour")) || 0)),
    email: String(f.get("email") || "").trim(),
    format: f.get("format") === "shopify_csv" ? "shopify_csv" : "xlsx",
    query: String(f.get("query") || "").trim().slice(0, 300),
  };
  if (!EMAIL_RE.test(s.email)) return { error: "Enter a valid email address" };
  await saveSchedule(session.shop, s);

  if (f.get("intent") === "send_now") {
    try {
      const count = await runScheduledExport(admin, { ...s, shop: session.shop });
      await markScheduleRun(session.shop, `Sent ${count} products (manual)`);
      return { ok: true, message: `Export with ${count} products sent to ${s.email}` };
    } catch (err) {
      return { error: `Could not send: ${err.message}` };
    }
  }
  return { ok: true, message: s.enabled ? "Schedule saved" : "Schedule turned off" };
};

export default function SchedulePage() {
  const { schedule, mailReady, timezone } = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const [form, setForm] = useState(schedule);
  // Read the value before the state update; the event's currentTarget is null later.
  const set = (k) => (e) => {
    const value = e.currentTarget.value;
    setForm((p) => ({ ...p, [k]: value }));
  };
  const busy = fetcher.state !== "idle";
  const intent = fetcher.formData?.get("intent");

  useEffect(() => {
    const d = fetcher.data;
    if (fetcher.state !== "idle" || !d) return;
    shopify.toast.show(d.error || d.message, { isError: Boolean(d.error) });
  }, [fetcher.state, fetcher.data, shopify]);

  const submit = (extra = {}) =>
    fetcher.submit({ ...form, enabled: String(form.enabled), ...extra }, { method: "POST" });

  return (
    <s-page heading="Scheduled exports">
      <s-link slot="breadcrumb-actions" href="/app">Dashboard</s-link>
      <s-button slot="primary-action" variant="primary" onClick={() => submit({ intent: "save" })}
        {...(busy && intent === "save" ? { loading: true } : {})}>
        Save
      </s-button>
      <s-button slot="secondary-actions" onClick={() => submit({ intent: "send_now" })}
        {...(busy && intent === "send_now" ? { loading: true } : {})}
        {...(!mailReady ? { disabled: true } : {})}>
        Send now
      </s-button>

      {!mailReady && (
        <s-banner tone="warning" heading="Email isn't set up on the server">
          Scheduled exports need email (SMTP) settings on the server. Contact support to enable them.
        </s-banner>
      )}

      <s-section heading="Schedule">
        <s-stack gap="base">
          <s-checkbox
            label="Email me a product export automatically"
            checked={form.enabled}
            onChange={(e) => {
              const checked = e.currentTarget.checked;
              setForm((p) => ({ ...p, enabled: checked }));
            }}
          />
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap="base">
            <s-select label="How often" value={form.frequency} onChange={set("frequency")}>
              <s-option value="weekly">Weekly</s-option>
              <s-option value="daily">Daily</s-option>
            </s-select>
            {form.frequency === "weekly" && (
              <s-select label="Day" value={String(form.weekday)} onChange={set("weekday")}>
                {DAYS.map((d, i) => <s-option key={d} value={String(i)}>{d}</s-option>)}
              </s-select>
            )}
            <s-select label={`Time (${timezone})`} value={String(form.hour)} onChange={set("hour")}>
              {Array.from({ length: 24 }, (_, h) => (
                <s-option key={h} value={String(h)}>{`${String(h).padStart(2, "0")}:00`}</s-option>
              ))}
            </s-select>
          </s-grid>
          <s-email-field label="Send to" value={form.email} onInput={set("email")} />
        </s-stack>
      </s-section>

      <s-section heading="File">
        <s-stack gap="base">
          <s-select label="Format" value={form.format} onChange={set("format")}>
            <s-option value="xlsx">Excel (.xlsx)</s-option>
            <s-option value="shopify_csv">Shopify CSV (.csv)</s-option>
          </s-select>
          <s-text-field
            label="Only these products (optional)"
            details="Shopify search syntax, for example status:active or vendor:Nike. Leave empty for all products."
            value={form.query}
            onInput={set("query")}
          />
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Last export">
        <s-stack gap="small-200">
          <s-text>{schedule.lastRunAt ? new Date(schedule.lastRunAt).toLocaleString() : "Not sent yet"}</s-text>
          {schedule.lastStatus && (
            <s-badge tone={schedule.lastStatus.startsWith("Failed") ? "critical" : "success"}>{schedule.lastStatus}</s-badge>
          )}
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Good to know">
        <s-unordered-list>
          <s-list-item>Use it as an automatic weekly backup of your catalog.</s-list-item>
          <s-list-item>The number of products follows your plan&apos;s export limit.</s-list-item>
          <s-list-item>Send now saves your settings and emails a file right away.</s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
