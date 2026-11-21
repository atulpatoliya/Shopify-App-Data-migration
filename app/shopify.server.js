import { SQLiteSessionStorage } from "@shopify/shopify-app-session-storage-sqlite";
import "@shopify/shopify-app-react-router/adapters/node";
import { existsSync } from "node:fs";

// Load local .env (values already set by the host, e.g. Render, are kept).
if (existsSync(".env")) process.loadEnvFile(".env");
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";

export const appApiKey = process.env.SHOPIFY_API_KEY || "";
const appUrl = process.env.SHOPIFY_APP_URL || "";

// Plans use Shopify Managed Pricing (configured in the Partner Dashboard), so the
// app never calls the Billing API — it only reads the active plan (see plans.server.js).
// Limits apply only to the public App Store app; the custom app stays unlimited.
export const PLAN_LIMITS_ENABLED = process.env.APP_DISTRIBUTION === "app_store";
export const APP_HANDLE = process.env.SHOPIFY_APP_HANDLE || "data-migration";
// Set SUPPORT_EMAIL in your environment (.env / Render) to your real address.
export const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || "support@example.com";

// Sessions stored in local SQLite file — persists across restarts, no re-auth needed
const sqliteStorage = new SQLiteSessionStorage(process.env.SESSION_DB || "sessions.sqlite");

const shopify = shopifyApp({
  apiKey: appApiKey,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.April26,
  scopes: process.env.SCOPES?.split(","),
  appUrl,
  authPathPrefix: "/auth",
  sessionStorage: sqliteStorage,
  // APP_DISTRIBUTION=app_store for the public App Store app; the custom app keeps single_merchant.
  distribution:
    process.env.APP_DISTRIBUTION === "app_store"
      ? AppDistribution.AppStore
      : AppDistribution.SingleMerchant,
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
