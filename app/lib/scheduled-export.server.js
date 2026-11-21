/* global globalThis */
// Scheduled exports: builds the product file on the server and emails it.
// A timer checks every 15 minutes which shops are due (in the shop's own time zone).
import * as XLSX from "xlsx";
import { unauthenticated } from "../shopify.server";
import { getCurrentPlan } from "../plans.server";
import { listEnabledSchedules, markScheduleRun } from "../db.server";
import { fetchAllProducts } from "./export-fetch.server";
import { buildAppSheet, buildShopifyCsvRows, DEFAULT_FIELDS, SHOPIFY_CSV_COLUMNS } from "./product-format";
import { sendMail } from "./mailer.server";

const CHECK_EVERY_MS = 15 * 60 * 1000;

async function shopInfo(admin) {
  const json = await (await admin.graphql(`#graphql
    query shopInfo { shop { name email ianaTimezone } }
  `)).json();
  return json.data?.shop ?? {};
}

export async function buildExportFile(admin, { format, query, limit }) {
  const products = await fetchAllProducts(admin, { query: query || null, limit });
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === "shopify_csv") {
    const ws = XLSX.utils.json_to_sheet(buildShopifyCsvRows(products), { header: SHOPIFY_CSV_COLUMNS });
    return {
      count: products.length,
      filename: `products-shopify-${stamp}.csv`,
      content: Buffer.from(XLSX.utils.sheet_to_csv(ws), "utf8"),
      contentType: "text/csv",
    };
  }
  const { columns, rows } = buildAppSheet(products, DEFAULT_FIELDS);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows, { header: columns }), "Products");
  return {
    count: products.length,
    filename: `products-${stamp}.xlsx`,
    content: XLSX.write(wb, { type: "buffer", bookType: "xlsx" }),
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
}

/** Runs one export now and emails it. Used by the timer and the "Send now" button. */
export async function runScheduledExport(admin, schedule) {
  const plan = await getCurrentPlan(admin);
  const shop = await shopInfo(admin);
  const file = await buildExportFile(admin, { format: schedule.format, query: schedule.query, limit: plan.limit });
  const limited = plan.limit != null && file.count >= plan.limit;
  await sendMail({
    to: schedule.email,
    subject: `Product export for ${shop.name || schedule.shop} — ${file.count} products`,
    text:
      `Your scheduled product export is attached (${file.count} products).\n` +
      (limited ? `\nYour ${plan.name} plan includes up to ${plan.limit} products per export. Upgrade in the app to export more.\n` : "") +
      `\nChange or turn off this schedule in the app: Scheduled exports.\n`,
    attachments: [{ filename: file.filename, content: file.content, contentType: file.contentType }],
  });
  return file.count;
}

function localParts(tz) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz || "UTC", weekday: "short", hour: "numeric", hour12: false, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { weekday, hour: Number(get("hour")) % 24, date: `${get("year")}-${get("month")}-${get("day")}` };
}

function localDate(iso, tz) {
  if (!iso) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "UTC" }).format(new Date(iso));
}

async function tick() {
  let schedules = [];
  try {
    schedules = await listEnabledSchedules();
  } catch (err) {
    console.error("[schedule] load failed", err.message);
    return;
  }
  for (const s of schedules) {
    try {
      const { admin } = await unauthenticated.admin(s.shop);
      const tz = (await shopInfo(admin)).ianaTimezone;
      const now = localParts(tz);
      const dayOk = s.frequency === "daily" || now.weekday === Number(s.weekday);
      if (!dayOk || now.hour < Number(s.hour) || localDate(s.last_run_at, tz) === now.date) continue;
      const count = await runScheduledExport(admin, s);
      await markScheduleRun(s.shop, `Sent ${count} products`);
      console.log(`[schedule] sent export for ${s.shop} (${count} products)`);
    } catch (err) {
      console.error(`[schedule] ${s.shop} failed:`, err.message);
      await markScheduleRun(s.shop, `Failed: ${err.message}`.slice(0, 200)).catch(() => {});
    }
  }
}

// Start once per server process.
if (!globalThis.__exportSchedulerStarted && process.env.NODE_ENV === "production") {
  globalThis.__exportSchedulerStarted = true;
  setTimeout(tick, 60 * 1000);
  setInterval(tick, CHECK_EVERY_MS);
}
