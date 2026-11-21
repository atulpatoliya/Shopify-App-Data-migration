import { APP_HANDLE, PLAN_LIMITS_ENABLED } from "./shopify.server";

// Must match the plan names created under Partners → Distribution → Pricing (Managed pricing).
// `limit` = max products per export and per import. null = unlimited.
export const PLAN_TIERS = [
  { name: "Free", price: 0, limit: 10 },
  { name: "Basic", price: 5, limit: 250 },
  { name: "Pro", price: 10, limit: 2500 },
  { name: "Plus", price: 20, limit: null },
];

const UNLIMITED = { name: "Unlimited", price: 0, limit: null, enforced: false };

/**
 * Returns the merchant's current plan and product limit.
 * With Managed Pricing, a paid plan shows up as an active app subscription
 * whose name is the plan name; no subscription means the Free plan.
 */
export async function getCurrentPlan(admin) {
  if (!PLAN_LIMITS_ENABLED) return UNLIMITED;

  let subscriptionName = null;
  try {
    const res = await admin.graphql(`#graphql
      query currentPlan {
        currentAppInstallation {
          activeSubscriptions { name status }
        }
      }
    `);
    const json = await res.json();
    const active = (json?.data?.currentAppInstallation?.activeSubscriptions ?? []).find(
      (s) => s.status === "ACTIVE",
    );
    subscriptionName = active?.name ?? null;
  } catch (err) {
    console.warn("Plan lookup failed, using Free:", err.message);
  }

  // Shopify's private "shopify-test" plan is used by App Store reviewers: give full access.
  if (subscriptionName && /^shopify[- ]?test$/i.test(subscriptionName)) {
    return { name: "Shopify test", price: 0, limit: null, enforced: true };
  }

  const tier =
    PLAN_TIERS.find((t) => subscriptionName && t.name.toLowerCase() === subscriptionName.toLowerCase()) ??
    PLAN_TIERS[0];
  return { ...tier, enforced: true };
}

/** Shopify-hosted page where merchants choose or change their plan. */
export function planSelectionUrl(shop) {
  const storeHandle = shop.replace(".myshopify.com", "");
  return `https://admin.shopify.com/store/${storeHandle}/charges/${APP_HANDLE}/pricing_plans`;
}
