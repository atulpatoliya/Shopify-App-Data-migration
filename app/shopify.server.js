import { SQLiteSessionStorage } from "@shopify/shopify-app-session-storage-sqlite";
import "@shopify/shopify-app-react-router/adapters/node";
import { existsSync } from "node:fs";

// Load local .env (values already set by the host, e.g. Render, are kept).
if (existsSync(".env")) process.loadEnvFile(".env");
import {
  ApiVersion,
  AppDistribution,
  BillingInterval,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";

export const appApiKey = process.env.SHOPIFY_API_KEY || "";
const appUrl = process.env.SHOPIFY_APP_URL || "";

// ── Billing ────────────────────────────────────────────────────────────────
// The app is free for now. Plans are defined here so billing can be switched on
// later by setting BILLING_ENABLED=true (no code changes needed).
// Note: Shopify billing only works for App Store / public apps, so also change
// `distribution` below to AppDistribution.AppStore when you go public.
export const BILLING_ENABLED = process.env.BILLING_ENABLED === "true";
export const PRO_PLAN = "Pro";
export const BILLING_IS_TEST = process.env.NODE_ENV !== "production";
export const APP_HANDLE = process.env.SHOPIFY_APP_HANDLE || "data-migration";
// Set SUPPORT_EMAIL in your environment (.env / Render) to your real address.
export const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || "support@example.com";
export const PLANS = {
  [PRO_PLAN]: {
    trialDays: 7,
    lineItems: [
      {
        amount: 9.99,
        currencyCode: "USD",
        interval: BillingInterval.Every30Days,
      },
    ],
  },
};

// Sessions stored in local SQLite file — persists across restarts, no re-auth needed
const sqliteStorage = new SQLiteSessionStorage("sessions.sqlite");

const shopify = shopifyApp({
  apiKey: appApiKey,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.April26,
  scopes: process.env.SCOPES?.split(","),
  appUrl,
  authPathPrefix: "/auth",
  sessionStorage: sqliteStorage,
  distribution: AppDistribution.SingleMerchant,
  billing: PLANS,
  future: {
    expiringOfflineAccessTokens: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.April26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
