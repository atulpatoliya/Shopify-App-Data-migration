import { useMemo, useState, useEffect } from "react";
import { useLoaderData, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";

const VIP_FUNCTION_HANDLE = "vip-product-discount";
const VIP_AUTO_TITLE = "VIP-AUTO-FUNCTION";
const VIP_DEFAULT_TAG = "vip_customer";

// ── Shopify Function Auto-Discount ──────────────────────────────────────────

const VIP_AUTO_DISCOUNT_QUERY = `#graphql
  query vipAutoDiscount {
    discountNodes(first: 5, query: "title:VIP-AUTO-FUNCTION") {
      nodes {
        id
        discount {
          ... on DiscountAutomaticApp {
            title
            status
            discountClass
          }
        }
        metafield(namespace: "$app:vip-product-discount", key: "function-configuration") {
          value
        }
      }
    }
  }
`;

const CREATE_AUTO_DISCOUNT_MUTATION = `#graphql
  mutation discountAutomaticAppCreate($automaticAppDiscount: DiscountAutomaticAppInput!) {
    discountAutomaticAppCreate(automaticAppDiscount: $automaticAppDiscount) {
      userErrors { field message }
      automaticAppDiscount {
        discountId
      }
    }
  }
`;

const UPDATE_AUTO_DISCOUNT_MUTATION = `#graphql
  mutation discountAutomaticAppUpdate($id: ID!, $automaticAppDiscount: DiscountAutomaticAppInput!) {
    discountAutomaticAppUpdate(id: $id, automaticAppDiscount: $automaticAppDiscount) {
      userErrors { field message }
      automaticAppDiscount {
        discountId
      }
    }
  }
`;

const UPDATE_METAFIELD_MUTATION = `#graphql
  mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      userErrors { field message }
    }
  }
`;

const PRODUCTS_QUERY = `#graphql
  query getProducts($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          title
          variants(first: 1) {
            edges {
              node {
                id
                price
                compareAtPrice
              }
            }
          }
        }
      }
    }
  }
`;

const VIP_CODE_DISCOUNTS_QUERY = `#graphql
  query vipCodeDiscounts($first: Int!) {
    codeDiscountNodes(first: $first, query: "title:VIP-CODE-*") {
      nodes {
        id
        codeDiscount {
          ... on DiscountCodeBasic {
            title
            status
            startsAt
            endsAt
            codes(first: 1) {
              nodes {
                code
              }
            }
          }
        }
      }
    }
  }
`;

const CREATE_CODE_DISCOUNT_MUTATION = `#graphql
  mutation discountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
    discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
      userErrors {
        field
        message
      }
      codeDiscountNode {
        id
      }
    }
  }
`;

const SEGMENTS_QUERY = `#graphql
  query segments($first: Int!, $query: String!) {
    segments(first: $first, query: $query) {
      nodes {
        id
        name
        query
      }
    }
  }
`;

const PRODUCT_BY_ID_QUERY = `#graphql
  query productById($id: ID!) {
    product(id: $id) {
      id
      title
      variants(first: 1) {
        edges {
          node {
            price
            compareAtPrice
          }
        }
      }
    }
  }
`;

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeSegmentGid(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.startsWith("gid://shopify/Segment/")) return raw;
  if (/^\d+$/.test(raw)) return `gid://shopify/Segment/${raw}`;
  return raw;
}

function computeTargetAndFixedDiscount(price, compareAtPrice, percent) {
  const currentPrice = toNumber(price);
  const compareAt = toNumber(compareAtPrice);

  const hasCompareAt = compareAt > 0;
  const basePrice = hasCompareAt ? compareAt : currentPrice;
  const targetPrice = basePrice * (1 - percent / 100);

  if (hasCompareAt) {
    const existingDiscountPercent = ((compareAt - currentPrice) / compareAt) * 100;
    if (existingDiscountPercent >= percent) {
      return {
        shouldApply: false,
        reason: `Existing discount (${existingDiscountPercent.toFixed(2)}%) >= ${percent}%`,
        targetPrice,
        fixedAmount: 0,
      };
    }
  }

  const fixedAmount = currentPrice - targetPrice;
  if (fixedAmount <= 0) {
    return {
      shouldApply: false,
      reason: "Already at/below target",
      targetPrice,
      fixedAmount: 0,
    };
  }

  return {
    shouldApply: true,
    reason: "",
    targetPrice,
    fixedAmount,
  };
}

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  let hasNextPage = true;
  let after = null;
  const allProducts = [];

  try {
    while (hasNextPage) {
      const response = await admin.graphql(PRODUCTS_QUERY, {
        variables: { first: 100, after },
      });

      const json = await response.json();
      if (json?.errors) {
        console.error("GraphQL Error:", json.errors);
        throw new Error(json.errors[0]?.message || "GraphQL error");
      }

      const products = json?.data?.products;
      const pageProducts = (products?.edges || []).map((edge) => edge.node);
      allProducts.push(...pageProducts);

      hasNextPage = Boolean(products?.pageInfo?.hasNextPage);
      after = products?.pageInfo?.endCursor || null;
    }
  } catch (err) {
    console.error("Loader Error:", err.message);
    return { products: [], error: err.message };
  }

  const normalizedProducts = allProducts
    .map((product) => {
      const firstVariant = product?.variants?.edges?.[0]?.node;
      if (!firstVariant?.id) return null;

      return {
        id: product.id,
        name: product.title,
        variantId: firstVariant.id,
        price: toNumber(firstVariant.price),
        compareAtPrice: firstVariant.compareAtPrice ? toNumber(firstVariant.compareAtPrice) : null,
      };
    })
    .filter(Boolean);

  const vipActiveByProduct = {};
  try {
    const discountResponse = await admin.graphql(VIP_CODE_DISCOUNTS_QUERY, {
      variables: { first: 100 },
    });
    const discountJson = await discountResponse.json();
    const discountNodes = discountJson?.data?.codeDiscountNodes?.nodes || [];

    for (const node of discountNodes) {
      const basic = node?.codeDiscount;
      const title = basic?.title;
      if (!title || !title.startsWith("VIP-CODE-")) continue;

      const parts = title.split("-");
      const productSuffix = parts[parts.length - 1];
      if (!productSuffix) continue;

      const matchedProduct = normalizedProducts.find((p) => p.id.endsWith(`/${productSuffix}`));
      if (!matchedProduct) continue;

      const discountCode = basic?.codes?.nodes?.[0]?.code || title;
      vipActiveByProduct[matchedProduct.id] = {
        code: discountCode,
        status: basic?.status || "ACTIVE",
        startsAt: basic?.startsAt || null,
        endsAt: basic?.endsAt || null,
      };
    }
  } catch (err) {
    console.warn("VIP discount status load skipped:", err.message);
  }

  const vipAutoDiscountInfo = {
    exists: false,
    id: null,
    status: null,
    percentage: null,
    functionHandle: VIP_FUNCTION_HANDLE,
  };
  try {
    const autoResp = await admin.graphql(VIP_AUTO_DISCOUNT_QUERY);
    const autoJson = await autoResp.json();
    const autoNodes = autoJson?.data?.discountNodes?.nodes || [];
    const autoNode = autoNodes.find((n) => n?.discount?.title === VIP_AUTO_TITLE);
    if (autoNode) {
      vipAutoDiscountInfo.exists = true;
      vipAutoDiscountInfo.id = autoNode.id;
      vipAutoDiscountInfo.status = autoNode?.discount?.status || "UNKNOWN";
      try {
        const cfg = JSON.parse(autoNode?.metafield?.value || "{}");
        vipAutoDiscountInfo.percentage = cfg?.percentage ?? null;
      } catch (_e) { /* ignore */ }
    }
  } catch (err) {
    console.warn("VIP auto-discount status load skipped:", err.message);
  }

  return { products: normalizedProducts, vipActiveByProduct, vipAutoDiscountInfo };
};

export const action = async ({ request }) => {
  try {
    const { admin } = await authenticate.admin(request);
    const formData = await request.formData();
    const _action = formData.get("_action");

    // ── Configure VIP Function auto-discount ───────────────────────────────
    if (_action === "configure_function") {
      const percentage = toNumber(formData.get("function_percent"));
      const existingDiscountId = String(formData.get("existing_discount_id") || "").trim();
      const functionConfigValue = JSON.stringify({ percentage });
      const automaticAppDiscountInput = {
        title: VIP_AUTO_TITLE,
        functionHandle: VIP_FUNCTION_HANDLE,
        startsAt: new Date().toISOString(),
        combinesWith: {
          productDiscounts: false,
          orderDiscounts: false,
          shippingDiscounts: false,
        },
        context: {
          all: "ALL",
        },
        discountClasses: ["PRODUCT"],
        metafields: [
          {
            namespace: "$app:vip-product-discount",
            key: "function-configuration",
            type: "json",
            value: functionConfigValue,
          },
        ],
      };

      if (percentage <= 0 || percentage > 100) {
        return { _action, ok: false, errors: [{ message: "Percent must be 1–100" }] };
      }

      let discountNodeId = existingDiscountId || null;

      if (!discountNodeId) {
        // Create the automatic App discount linked to the function handle.
        const createResp = await admin.graphql(CREATE_AUTO_DISCOUNT_MUTATION, {
          variables: {
            automaticAppDiscount: automaticAppDiscountInput,
          },
        });
        const createJson = await createResp.json();
        const createErrors = createJson?.data?.discountAutomaticAppCreate?.userErrors || [];
        if (createErrors.length > 0) {
          return { _action, ok: false, errors: createErrors };
        }
        discountNodeId = createJson?.data?.discountAutomaticAppCreate?.automaticAppDiscount?.discountId;
      } else {
        // Update the existing automatic app discount so legacy misconfigurations
        // (such as missing discount classes) are corrected in place.
        const updateResp = await admin.graphql(UPDATE_AUTO_DISCOUNT_MUTATION, {
          variables: {
            id: discountNodeId,
            automaticAppDiscount: automaticAppDiscountInput,
          },
        });
        const updateJson = await updateResp.json();
        const updateErrors = updateJson?.data?.discountAutomaticAppUpdate?.userErrors || [];
        if (updateErrors.length > 0) {
          return { _action, ok: false, errors: updateErrors };
        }
      }

      if (!discountNodeId) {
        return { _action, ok: false, errors: [{ message: "Could not find or create VIP auto-pricing discount." }] };
      }

      return { _action, ok: true, message: `VIP auto-pricing configured with ${percentage}%` };
    }

    // ── Create code discounts per product (existing flow) ─────────────────

    const selectedProductIds = JSON.parse(formData.get("selected_products") || "[]");
    const percentage = toNumber(formData.get("discount_percent"));
    const vipTag = String(formData.get("vip_tag") || VIP_DEFAULT_TAG).trim();
    const vipSegmentIdInput = normalizeSegmentGid(formData.get("vip_segment_id"));
    const startsAt = formData.get("starts_at");
    const endsAt = formData.get("ends_at");

    console.log("ACTION START: Discount request received", { selectedProductIds: selectedProductIds.length, percentage });

    if (!Array.isArray(selectedProductIds) || selectedProductIds.length === 0) {
      return { ok: false, errors: [{ message: "Select at least 1 product" }] };
    }

    if (percentage <= 0 || percentage > 100) {
      return { ok: false, errors: [{ message: "Percent must be 0-100" }] };
    }

    if (!vipTag) {
      return { ok: false, errors: [{ message: "VIP tag is required" }] };
    }

    // Segment ID is optional — if provided, restricts the discount code to that segment only.
    // If not provided, the code is unrestricted (all: true) and should be shared only with VIP customers via theme.
    let vipSegmentId = vipSegmentIdInput || null;

    if (!vipSegmentId) {
      // Try auto-lookup as a convenience. Failure is non-fatal.
      const desiredSegmentName = `VIP_TAG_${vipTag}`;
      const searchQueries = [`name:${desiredSegmentName}`, vipTag];
      for (const searchQuery of searchQueries) {
        try {
          const segmentsResponse = await admin.graphql(SEGMENTS_QUERY, {
            variables: { first: 250, query: searchQuery },
          });
          const segmentsJson = await segmentsResponse.json();
          const existingSegment = (segmentsJson?.data?.segments?.nodes || []).find((seg) => {
            const q = String(seg?.query || "").toLowerCase();
            const n = String(seg?.name || "").toLowerCase();
            const t = vipTag.toLowerCase();
            return n === desiredSegmentName.toLowerCase() || q.includes(t) || n.includes(t);
          });
          if (existingSegment?.id) {
            vipSegmentId = existingSegment.id;
            break;
          }
        } catch (err) {
          console.warn("Segment lookup skipped:", err.message);
        }
      }
    }

    // Note: vipSegmentId may still be null here — that is OK.
    // customerSelection will use { all: true } in that case.

    const applied = [];
    const errors = [];
    let delay = 0;

    for (const productId of selectedProductIds) {
      try {
        // Stagger requests to avoid overloading
        if (delay > 0) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
        delay = 200;

        const productResponse = await admin.graphql(PRODUCT_BY_ID_QUERY, {
          variables: { id: productId },
        });
        const productJson = await productResponse.json();
        const productNode = productJson?.data?.product;
        const firstVariant = productNode?.variants?.edges?.[0]?.node;

        if (!firstVariant) {
          errors.push({ message: `Product not found for ${productId}` });
          continue;
        }

        const currentPrice = toNumber(firstVariant.price);
        const compareAtPrice = firstVariant.compareAtPrice ? toNumber(firstVariant.compareAtPrice) : null;
        const pricePlan = computeTargetAndFixedDiscount(currentPrice, compareAtPrice, percentage);

        if (!pricePlan.shouldApply) {
          errors.push({ message: `${productNode?.title || productId}: ${pricePlan.reason}` });
          continue;
        }

        const effectivePercentage = currentPrice > 0 ? pricePlan.fixedAmount / currentPrice : 0;
        if (effectivePercentage <= 0 || effectivePercentage >= 1) {
          errors.push({ message: `${productNode?.title || productId}: invalid computed discount` });
          continue;
        }

        const randomSuffix = Math.floor(Math.random() * 1000000);
        const productNumericId = productId.split("/").pop();
        const code = `VIP-CODE-${Math.round(percentage)}-${productNumericId}-${randomSuffix}`;
        const title = `VIP-CODE-${Math.round(percentage)}-${Date.now()}-${productNumericId}`;
        const startIso = startsAt ? new Date(startsAt).toISOString() : new Date().toISOString();
        const endIso = endsAt ? new Date(endsAt).toISOString() : null;

        const customerSelection = vipSegmentId
          ? { customerSegments: { add: [vipSegmentId] } }
          : { all: true };

        const basicCodeDiscount = {
          title,
          code,
          startsAt: startIso,
          customerSelection,
          combinesWith: {
            productDiscounts: true,
            orderDiscounts: true,
            shippingDiscounts: true,
          },
          customerGets: {
            value: {
              percentage: Number(effectivePercentage.toFixed(6)),
            },
            items: {
              products: {
                productsToAdd: [productId],
              },
            },
          },
        };

        if (endIso) {
          basicCodeDiscount.endsAt = endIso;
        }

        console.log("Creating VIP code discount:", code);

        const response = await admin.graphql(CREATE_CODE_DISCOUNT_MUTATION, {
          variables: {
            basicCodeDiscount,
          },
        });

        const json = await response.json();
        console.log("Mutation response for", code, ":", json);

        const userErrors = json?.data?.discountCodeBasicCreate?.userErrors || [];

        if (userErrors.length > 0) {
          const firstError = userErrors[0];
          const fieldPath = Array.isArray(firstError.field) ? firstError.field.join(".") : "unknown";
          errors.push({ code, message: `${firstError.message} (field: ${fieldPath})` });
          continue;
        }

        applied.push({
          code,
          productName: productNode?.title || productId,
          percentage,
          effectivePercentage: Number((effectivePercentage * 100).toFixed(4)),
          targetPrice: Number(pricePlan.targetPrice.toFixed(2)),
          segmentRestricted: Boolean(vipSegmentId),
        });
      } catch (err) {
        console.error("Mutation error for product", productId, ":", err.message);
        errors.push({ message: `Error creating discount: ${err.message}` });
      }
    }

    console.log("ACTION COMPLETE:", { applied: applied.length, errors: errors.length });
    return {
      ok: errors.length === 0,
      applied: applied,
      errors: errors,
    };
  } catch (err) {
    console.error("ACTION FATAL ERROR:", err);
    return { ok: false, errors: [{ message: err.message }] };
  }
};

export default function DiscountPage() {
  const {
    products = [],
    vipActiveByProduct = {},
    vipAutoDiscountInfo = {},
    error: loaderError,
  } = useLoaderData() || {};
  const fetcher = useFetcher();
  const fnFetcher = useFetcher();

  const [discountPercent, setDiscountPercent] = useState("25");
  const [vipTag, setVipTag] = useState(VIP_DEFAULT_TAG);
  const [vipSegmentId, setVipSegmentId] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [selected, setSelected] = useState({});
  const [fnPercent, setFnPercent] = useState("");

  // Restore saved settings from localStorage on mount (client-only)
  useEffect(() => {
    try {
      const saved = localStorage.getItem("vip_discount_settings");
      if (saved) {
        const s = JSON.parse(saved);
        if (s.discountPercent !== undefined) setDiscountPercent(s.discountPercent);
        if (s.vipTag !== undefined) setVipTag(s.vipTag);
        if (s.vipSegmentId !== undefined) setVipSegmentId(s.vipSegmentId);
        if (s.startsAt !== undefined) setStartsAt(s.startsAt);
        if (s.endsAt !== undefined) setEndsAt(s.endsAt);
        if (s.fnPercent !== undefined) setFnPercent(s.fnPercent);
      }
    } catch (_e) { /* ignore */ }
  }, []);

  // Persist settings to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem(
        "vip_discount_settings",
        JSON.stringify({ discountPercent, vipTag, vipSegmentId, startsAt, endsAt, fnPercent }),
      );
    } catch (_e) { /* ignore */ }
  }, [discountPercent, vipTag, vipSegmentId, startsAt, endsAt, fnPercent]);

  const selectedIds = useMemo(
    () => Object.keys(selected).filter((id) => selected[id]),
    [selected],
  );

  const activeProducts = useMemo(
    () => products.filter((p) => Boolean(vipActiveByProduct[p.id])),
    [products, vipActiveByProduct],
  );

  const availableProducts = useMemo(
    () => products.filter((p) => !vipActiveByProduct[p.id]),
    [products, vipActiveByProduct],
  );

  const percent = toNumber(discountPercent);
  const result = fetcher.data;

  const toggleProduct = (productId) => {
    setSelected((prev) => ({ ...prev, [productId]: !prev[productId] }));
  };

  const toggleAll = (checked) => {
    const next = {};
    for (const p of availableProducts) {
      next[p.id] = checked;
    }
    setSelected(next);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    
    const fd = new FormData();
    fd.set("selected_products", JSON.stringify(selectedIds));
    fd.set("discount_percent", discountPercent);
    fd.set("vip_tag", vipTag);
    if (vipSegmentId) fd.set("vip_segment_id", vipSegmentId);
    if (startsAt) fd.set("starts_at", startsAt);
    if (endsAt) fd.set("ends_at", endsAt);

    fetcher.submit(fd, { method: "POST" });
  };

  const handleFnSubmit = (e) => {
    e.preventDefault();
    const fd = new FormData();
    fd.set("_action", "configure_function");
    fd.set("function_percent", fnPercent || discountPercent);
    if (vipAutoDiscountInfo.id) fd.set("existing_discount_id", vipAutoDiscountInfo.id);
    fnFetcher.submit(fd, { method: "POST" });
  };

  return (
    <div style={{ maxWidth: 1200, margin: "2rem auto", padding: "0 1rem" }}>
      <h2>VIP Discount Manager</h2>
      <p>Use auto pricing for logged-in VIP customers. Legacy code discounts remain below only for manual fallback.</p>

      {loaderError && (
        <div style={{ marginBottom: 16, padding: 12, backgroundColor: "#ffebee", borderRadius: 4, color: "#b71c1c" }}>
          <strong>Load error:</strong> {loaderError}
        </div>
      )}

      {activeProducts.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <h3 style={{ marginBottom: 8 }}>Active Discount Products ({activeProducts.length})</h3>
          <table border="1" cellPadding="10" cellSpacing="0" style={{ width: "100%" }}>
            <thead>
              <tr style={{ backgroundColor: "#f0f8f5" }}>
                <th>Product</th>
                <th>Price</th>
                <th>Compare-at</th>
                <th>Active Code</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {activeProducts.map((p) => {
                const activeInfo = vipActiveByProduct[p.id];
                return (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td>${p.price.toFixed(2)}</td>
                    <td>${p.compareAtPrice ? p.compareAtPrice.toFixed(2) : "-"}</td>
                    <td>{activeInfo?.code || "-"}</td>
                    <td style={{ color: "#0b6e4f" }}>✓ Active</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── VIP Auto-Discount Function Panel ── */}
      <div
        style={{
          marginBottom: 24,
          padding: 16,
          borderRadius: 4,
          border: "2px solid",
          borderColor: vipAutoDiscountInfo.exists ? "#0b6e4f" : "#666",
          backgroundColor: vipAutoDiscountInfo.exists ? "#e8f5e9" : "#f9f9f9",
        }}
      >
        <h3 style={{ marginTop: 0 }}>
          {vipAutoDiscountInfo.exists
            ? `✓ VIP Auto-Pricing Active — ${vipAutoDiscountInfo.percentage ?? "?"}% (${vipAutoDiscountInfo.status})`
            : "⭐ VIP Auto-Pricing Function (Recommended)"}
        </h3>
        <p style={{ marginTop: 0, marginBottom: 12, color: "#444" }}>
          Automatically applies VIP pricing to ALL products in cart for logged-in customers with{" "}
          <strong>{vipTag || VIP_DEFAULT_TAG}</strong> tag. No discount codes needed. Blocks other discounts from stacking.
        </p>
        <form onSubmit={handleFnSubmit} style={{ display: "flex", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
          <div>
            <label htmlFor="fn-pct" style={{ display: "block", marginBottom: 4 }}>
              VIP Discount %
            </label>
            <input
              id="fn-pct"
              type="number"
              min="1"
              max="99"
              step="0.01"
              placeholder={discountPercent || "25"}
              value={fnPercent}
              onChange={(e) => setFnPercent(e.target.value)}
              style={{ width: 100, padding: 6 }}
            />
          </div>
          <button
            type="submit"
            disabled={fnFetcher.state === "submitting"}
            style={{
              padding: "8px 18px",
              backgroundColor: "#0066cc",
              color: "white",
              border: "none",
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            {fnFetcher.state === "submitting"
              ? "Saving..."
              : vipAutoDiscountInfo.exists
                ? "Update VIP Auto-Pricing"
                : "Activate VIP Auto-Pricing"}
          </button>
        </form>
        {fnFetcher.data && (
          <div
            style={{
              marginTop: 10,
              color: fnFetcher.data.ok ? "#0b6e4f" : "#b71c1c",
            }}
          >
            {fnFetcher.data.ok
              ? `✓ ${fnFetcher.data.message}`
              : (fnFetcher.data.errors ?? []).map((e) => e.message).join(", ")}
          </div>
        )}
      </div>

      <div style={{ marginBottom: 24, padding: 12, borderRadius: 4, backgroundColor: "#fff8e1", color: "#7a5d00" }}>
        Cart અને checkout માં ભાવ દેખાડવા માટે ઉપરનું auto-pricing activate કરવું જરૂરી છે. નીચેનો per-product code flow cart માં પોતાના આપ લાગતો નથી.
      </div>

      <form onSubmit={handleSubmit}>
        <fieldset style={{ border: "1px solid #ccc", padding: 16, marginBottom: 20, borderRadius: 4, opacity: 0.85 }}>
          <legend>Legacy Manual Code Settings</legend>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 16 }}>
            <div>
              <label htmlFor="pct">Discount %</label>
              <input
                id="pct"
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={discountPercent}
                onChange={(e) => setDiscountPercent(e.target.value)}
                style={{ width: "100%", padding: 6 }}
              />
            </div>
            <div>
              <label htmlFor="vip-tag">VIP Customer Tag</label>
              <input
                id="vip-tag"
                type="text"
                value={vipTag}
                onChange={(e) => setVipTag(e.target.value)}
                style={{ width: "100%", padding: 6 }}
              />
            </div>
            <div>
              <label htmlFor="vip-segment-id">VIP Segment ID (optional)</label>
              <input
                id="vip-segment-id"
                type="text"
                placeholder="gid://shopify/Segment/..."
                value={vipSegmentId}
                onChange={(e) => setVipSegmentId(e.target.value)}
                style={{ width: "100%", padding: 6 }}
              />
            </div>
            <div>
              <label htmlFor="start">Start Date</label>
              <input
                id="start"
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                style={{ width: "100%", padding: 6 }}
              />
            </div>
            <div>
              <label htmlFor="end">End Date</label>
              <input
                id="end"
                type="datetime-local"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
                style={{ width: "100%", padding: 6 }}
              />
            </div>
          </div>
        </fieldset>

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
          <button
            type="submit"
            disabled={fetcher.state === "submitting" || selectedIds.length === 0}
            style={{
              padding: "10px 24px",
              fontSize: 15,
              fontWeight: "bold",
              backgroundColor: selectedIds.length === 0 ? "#ccc" : "#0066cc",
              color: "white",
              border: "none",
              borderRadius: 4,
              cursor: selectedIds.length === 0 ? "not-allowed" : "pointer",
            }}
          >
            {fetcher.state === "submitting"
              ? "Creating..."
              : selectedIds.length > 0
                ? `Create Legacy Code (${selectedIds.length} product${selectedIds.length > 1 ? "s" : ""})`
                : "Create Legacy Code"}
          </button>
          <button type="button" onClick={() => toggleAll(true)} style={{ padding: "6px 12px" }}>
            Select All
          </button>
          <button type="button" onClick={() => toggleAll(false)} style={{ padding: "6px 12px" }}>
            Clear All
          </button>
        </div>

        <table border="1" cellPadding="12" cellSpacing="0" style={{ width: "100%", marginBottom: 16 }}>
          <thead>
            <tr style={{ backgroundColor: "#f5f5f5" }}>
              <th style={{ width: 40 }}>✓</th>
              <th>Product</th>
              <th>Price</th>
              <th>Compare-at</th>
              <th>Target @ {percent}%</th>
              <th>Discount $</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {availableProducts.map((p) => {
              const calc = computeTargetAndFixedDiscount(p.price, p.compareAtPrice, percent);
              return (
                <tr key={p.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={Boolean(selected[p.id])}
                      onChange={() => toggleProduct(p.id)}
                    />
                  </td>
                  <td>{p.name}</td>
                  <td>${p.price.toFixed(2)}</td>
                  <td>${p.compareAtPrice ? p.compareAtPrice.toFixed(2) : "-"}</td>
                  <td>${calc.targetPrice.toFixed(2)}</td>
                  <td>${calc.fixedAmount.toFixed(2)}</td>
                  <td>
                    <span style={{ color: calc.shouldApply ? "green" : "red" }}>
                      {calc.shouldApply ? "✓" : "✗"} {calc.reason || "OK"}
                    </span>
                  </td>
                </tr>
              );
            })}
            {availableProducts.length === 0 && (
              <tr>
                <td colSpan={7} style={{ textAlign: "center", color: "#666" }}>
                  No pending products. All loaded products already have active discounts.
                </td>
              </tr>
            )}
          </tbody>
        </table>


      </form>

      {result && (
        <div style={{ marginTop: 32, padding: 20, backgroundColor: result.ok ? "#e8f5e9" : "#ffebee", borderRadius: 4 }}>
          <h3>Result</h3>
          <p style={{ marginTop: 0 }}>
            Legacy code result. Auto cart pricing works only from the top VIP Auto-Pricing panel for logged-in customers with tag <strong>{vipTag}</strong>.
          </p>

          {result.applied?.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <h4>Created ({result.applied.length}):</h4>
              <ul>
                {result.applied.map((item, idx) => (
                  <li key={idx}>
                    <code>{item.code}</code>
                    {" — "}
                    {item.productName}
                    {" | "}
                    {item.percentage}% requested → {item.effectivePercentage}% applied
                    {" | "}
                    Target: ${item.targetPrice}
                    {item.segmentRestricted ? " | VIP segment restricted" : " | All customers (add Segment ID to restrict)"}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.errors?.length > 0 && (
            <div>
              <h4>Errors ({result.errors.length}):</h4>
              <ul>
                {result.errors.map((err, idx) => (
                  <li key={idx} style={{ color: "red" }}>
                    {err.code ? `${err.code}: ` : ""}{err.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
