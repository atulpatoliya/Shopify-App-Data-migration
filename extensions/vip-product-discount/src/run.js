// @ts-check
import { DiscountApplicationStrategy } from "../generated/api";

/**
 * @typedef {import("../generated/api").RunInput} RunInput
 * @typedef {import("../generated/api").FunctionRunResult} FunctionRunResult
 */

/**
 * @type {FunctionRunResult}
 */
const EMPTY_DISCOUNT = {
  discountApplicationStrategy: DiscountApplicationStrategy.First,
  discounts: [],
};

/**
 * @param {RunInput} input
 * @returns {FunctionRunResult}
 */
export function run(input) {
  const buyerIdentity = input?.cart?.buyerIdentity;
  const isAuthenticated = buyerIdentity?.isAuthenticated ?? false;
  const hasCustomer = Boolean(buyerIdentity?.customer);

  // Custom per-customer pricing is driven by customer metafield JSON:
  // { "prices": { "gid://shopify/ProductVariant/123": 99.99 } }
  const customerPricingRaw = buyerIdentity?.customer?.metafield?.value;
  let customerPriceMap = null;
  if (customerPricingRaw) {
    try {
      const parsed = JSON.parse(customerPricingRaw);
      if (parsed && typeof parsed === "object") {
        customerPriceMap = parsed?.prices && typeof parsed.prices === "object" ? parsed.prices : parsed;
      }
    } catch (_e) {
      // ignore malformed customer pricing JSON
    }
  }

  if ((isAuthenticated || hasCustomer) && customerPriceMap && typeof customerPriceMap === "object") {
    const customPriceDiscounts = [];

    for (const line of input?.cart?.lines ?? []) {
      if (line?.merchandise?.__typename !== "ProductVariant") continue;

      const variantId = line?.merchandise?.id;
      if (!variantId) continue;

      const configuredPrice = Number(customerPriceMap?.[variantId]);
      if (!Number.isFinite(configuredPrice) || configuredPrice <= 0) continue;

      const currentPrice = Number(line?.cost?.amountPerQuantity?.amount ?? 0);
      if (!Number.isFinite(currentPrice) || currentPrice <= 0) continue;

      // Never increase line price; only apply when configured price is lower.
      const discountAmount = currentPrice - configuredPrice;
      if (discountAmount <= 0) continue;

      customPriceDiscounts.push({
        targets: [{ cartLine: { id: line.id } }],
        value: {
          fixedAmount: {
            amount: discountAmount.toFixed(2),
            appliesToEachItem: true,
          },
        },
        message: "Customer price applied",
      });
    }

    if (customPriceDiscounts.length > 0) {
      return {
        discountApplicationStrategy: DiscountApplicationStrategy.All,
        discounts: customPriceDiscounts,
      };
    }
  }

  // Parse configuration from metafield
  let percentage = 0;
  try {
    const config = JSON.parse(input?.discountNode?.metafield?.value ?? "{}");
    percentage = Number(config?.percentage ?? 0);
  } catch (_e) {
    // ignore malformed JSON
  }

  if (percentage <= 0 || percentage >= 100) {
    return EMPTY_DISCOUNT;
  }

  // Fallback: VIP percentage pricing
  const hasVipTag = buyerIdentity?.customer?.hasAnyTag ?? false;

  if (!hasVipTag) {
    return EMPTY_DISCOUNT;
  }

  const discounts = [];

  for (const line of input?.cart?.lines ?? []) {
    if (line?.merchandise?.__typename !== "ProductVariant") continue;

    const currentPrice = Number(line?.cost?.amountPerQuantity?.amount ?? 0);
    const compareAtPrice = Number(line?.cost?.compareAtAmountPerQuantity?.amount ?? 0);

    if (currentPrice <= 0) continue;

    const hasCompareAt = compareAtPrice > 0;
    const basePrice = hasCompareAt ? compareAtPrice : currentPrice;
    const targetPrice = basePrice * (1 - percentage / 100);

    // If compare-at exists and existing discount already >= requested %, skip
    if (hasCompareAt) {
      const existingDiscountPct = ((compareAtPrice - currentPrice) / compareAtPrice) * 100;
      if (existingDiscountPct >= percentage) continue;
    }

    const discountAmount = currentPrice - targetPrice;
    if (discountAmount <= 0) continue;

    discounts.push({
      targets: [{ cartLine: { id: line.id } }],
      value: {
        fixedAmount: {
          amount: discountAmount.toFixed(2),
          appliesToEachItem: true,
        },
      },
      message: `VIP ${percentage}% off`,
    });
  }

  if (discounts.length === 0) {
    return EMPTY_DISCOUNT;
  }

  return {
    discountApplicationStrategy: DiscountApplicationStrategy.All,
    discounts,
  };
}