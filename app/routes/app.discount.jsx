/* eslint-disable react/prop-types */
import { useMemo, useState, useEffect } from "react";
import { useLoaderData, useFetcher } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
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

  let currencyCode = "USD";
  try {
    const shopResp = await admin.graphql(`#graphql
      query shopCurrency { shop { currencyCode } }
    `);
    const shopJson = await shopResp.json();
    currencyCode = shopJson?.data?.shop?.currencyCode || currencyCode;
  } catch (err) {
    console.warn("Shop currency load skipped:", err.message);
  }

  return { products: normalizedProducts, vipActiveByProduct, vipAutoDiscountInfo, currencyCode };
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


        const response = await admin.graphql(CREATE_CODE_DISCOUNT_MUTATION, {
          variables: {
            basicCodeDiscount,
          },
        });

        const json = await response.json();

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
    currencyCode = "USD",
    error: loaderError,
  } = useLoaderData() || {};
  const fetcher = useFetcher();
  const fnFetcher = useFetcher();
  const shopify = useAppBridge();

  const [discountPercent, setDiscountPercent] = useState("25");
  const [vipTag, setVipTag] = useState(VIP_DEFAULT_TAG);
  const [vipSegmentId, setVipSegmentId] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [selected, setSelected] = useState({});
  const [fnPercent, setFnPercent] = useState("");
  const [search, setSearch] = useState("");

  const money = useMemo(() => {
    try {
      const f = new Intl.NumberFormat(undefined, { style: "currency", currency: currencyCode });
      return (n) => f.format(n);
    } catch {
      return (n) => `${Number(n).toFixed(2)} ${currencyCode}`;
    }
  }, [currencyCode]);

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

  useEffect(() => {
    try {
      localStorage.setItem(
        "vip_discount_settings",
        JSON.stringify({ discountPercent, vipTag, vipSegmentId, startsAt, endsAt, fnPercent }),
      );
    } catch (_e) { /* ignore */ }
  }, [discountPercent, vipTag, vipSegmentId, startsAt, endsAt, fnPercent]);

  // Toasts for results
  useEffect(() => {
    if (fnFetcher.state === "idle" && fnFetcher.data) {
      shopify.toast.show(
        fnFetcher.data.ok ? fnFetcher.data.message : (fnFetcher.data.errors ?? []).map((e) => e.message).join(", "),
        { isError: !fnFetcher.data.ok },
      );
    }
  }, [fnFetcher.state, fnFetcher.data, shopify]);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) {
      const created = fetcher.data.applied?.length ?? 0;
      shopify.toast.show(`${created} discount code${created === 1 ? "" : "s"} created`, {
        isError: created === 0,
      });
      if (created > 0) setSelected({});
    }
  }, [fetcher.state, fetcher.data, shopify]);

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

  const visibleProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? availableProducts.filter((p) => p.name.toLowerCase().includes(q)) : availableProducts;
  }, [availableProducts, search]);

  const percent = toNumber(discountPercent);
  const result = fetcher.data;
  const allVisibleSelected = visibleProducts.length > 0 && visibleProducts.every((p) => selected[p.id]);

  const toggleProduct = (productId) => {
    setSelected((prev) => ({ ...prev, [productId]: !prev[productId] }));
  };

  const toggleAllVisible = (checked) => {
    setSelected((prev) => {
      const next = { ...prev };
      for (const p of visibleProducts) next[p.id] = checked;
      return next;
    });
  };

  const handleSubmit = () => {
    const fd = new FormData();
    fd.set("selected_products", JSON.stringify(selectedIds));
    fd.set("discount_percent", discountPercent);
    fd.set("vip_tag", vipTag);
    if (vipSegmentId) fd.set("vip_segment_id", vipSegmentId);
    if (startsAt) fd.set("starts_at", startsAt);
    if (endsAt) fd.set("ends_at", endsAt);
    fetcher.submit(fd, { method: "POST" });
  };

  const handleFnSubmit = () => {
    const fd = new FormData();
    fd.set("_action", "configure_function");
    fd.set("function_percent", fnPercent || discountPercent);
    if (vipAutoDiscountInfo.id) fd.set("existing_discount_id", vipAutoDiscountInfo.id);
    fnFetcher.submit(fd, { method: "POST" });
  };

  const autoActive = vipAutoDiscountInfo.exists && vipAutoDiscountInfo.status === "ACTIVE";
  const fnSaving = fnFetcher.state !== "idle";
  const codesSaving = fetcher.state !== "idle";

  return (
    <s-page heading="VIP pricing">
      <s-link slot="breadcrumb-actions" href="/app">Dashboard</s-link>
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={handleFnSubmit}
        {...(fnSaving ? { loading: true } : {})}
      >
        {vipAutoDiscountInfo.exists ? "Save auto-pricing" : "Activate auto-pricing"}
      </s-button>

      {loaderError && (
        <s-banner heading="Some data could not be loaded" tone="critical">
          {loaderError}
        </s-banner>
      )}

      {/* ── Auto pricing (recommended) ── */}
      <s-section heading="Automatic VIP pricing">
        <s-stack gap="base">
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-text type="strong">Status</s-text>
            {vipAutoDiscountInfo.exists ? (
              <s-badge tone={autoActive ? "success" : "warning"}>
                {autoActive ? "Active" : formatStatus(vipAutoDiscountInfo.status)}
              </s-badge>
            ) : (
              <s-badge>Not set up</s-badge>
            )}
            {vipAutoDiscountInfo.percentage != null && (
              <s-badge tone="info">{vipAutoDiscountInfo.percentage}% off</s-badge>
            )}
            <s-badge>Recommended</s-badge>
          </s-stack>
          <s-paragraph color="subdued">
            Logged-in customers tagged <s-text type="strong">{vipTag || VIP_DEFAULT_TAG}</s-text> automatically
            get this discount on every product in their cart. No codes needed. Other discounts
            don&apos;t combine with it.
          </s-paragraph>
          <s-box maxInlineSize="240px">
            <s-number-field
              label="VIP discount"
              suffix="%"
              min={1}
              max={99}
              step={0.01}
              placeholder={discountPercent || "25"}
              value={fnPercent}
              onInput={(e) => setFnPercent(e.currentTarget.value)}
            />
          </s-box>
        </s-stack>
      </s-section>

      {/* ── Active codes ── */}
      {activeProducts.length > 0 && (
        <s-section heading={`Products with active VIP codes (${activeProducts.length})`} padding="none">
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Product</s-table-header>
              <s-table-header format="currency">Price</s-table-header>
              <s-table-header format="currency">Compare-at</s-table-header>
              <s-table-header listSlot="secondary">Code</s-table-header>
              <s-table-header>Status</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {activeProducts.map((p) => {
                const info = vipActiveByProduct[p.id];
                return (
                  <s-table-row key={p.id}>
                    <s-table-cell>{p.name}</s-table-cell>
                    <s-table-cell>{money(p.price)}</s-table-cell>
                    <s-table-cell>{p.compareAtPrice ? money(p.compareAtPrice) : "—"}</s-table-cell>
                    <s-table-cell>{info?.code || "—"}</s-table-cell>
                    <s-table-cell>
                      <s-badge tone={info?.status === "ACTIVE" ? "success" : undefined}>
                        {formatStatus(info?.status)}
                      </s-badge>
                    </s-table-cell>
                  </s-table-row>
                );
              })}
            </s-table-body>
          </s-table>
        </s-section>
      )}

      {/* ── Manual codes (legacy) ── */}
      <s-section heading="Manual discount codes">
        <s-stack gap="base">
          <s-paragraph color="subdued">
            Creates a separate discount code for each selected product. Customers must enter the
            code at checkout. Use this only when automatic pricing doesn&apos;t fit.
          </s-paragraph>
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap="base">
            <s-number-field
              label="Discount"
              suffix="%"
              min={1}
              max={100}
              step={0.01}
              value={discountPercent}
              onInput={(e) => setDiscountPercent(e.currentTarget.value)}
            />
            <s-text-field
              label="VIP customer tag"
              value={vipTag}
              onInput={(e) => setVipTag(e.currentTarget.value)}
            />
            <s-text-field
              label="Customer segment ID"
              details="Optional. Limits codes to this segment."
              placeholder="gid://shopify/Segment/…"
              value={vipSegmentId}
              onInput={(e) => setVipSegmentId(e.currentTarget.value)}
            />
          </s-grid>
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap="base">
            <DateTimeInput id="vip-start" label="Start date" value={startsAt} onChange={setStartsAt} />
            <DateTimeInput id="vip-end" label="End date (optional)" value={endsAt} onChange={setEndsAt} />
          </s-grid>
        </s-stack>
      </s-section>

      <s-section padding="none">
        <s-box padding="base">
          <s-stack direction="inline" justifyContent="space-between" alignItems="center" gap="base">
            <s-box inlineSize="100%" maxInlineSize="360px">
              <s-search-field
                label="Search products"
                labelAccessibilityVisibility="exclusive"
                placeholder="Search products"
                value={search}
                onInput={(e) => setSearch(e.currentTarget.value)}
              />
            </s-box>
            <s-stack direction="inline" gap="small-200" alignItems="center">
              {selectedIds.length > 0 && <s-text color="subdued">{selectedIds.length} selected</s-text>}
              <s-button
                onClick={handleSubmit}
                {...(codesSaving ? { loading: true } : {})}
                {...(selectedIds.length === 0 ? { disabled: true } : {})}
              >
                Create codes{selectedIds.length ? ` (${selectedIds.length})` : ""}
              </s-button>
            </s-stack>
          </s-stack>
        </s-box>

        {visibleProducts.length === 0 ? (
          <s-box padding="large-200">
            <s-stack alignItems="center" gap="small-200">
              <s-heading>No products found</s-heading>
              <s-text color="subdued">
                {search ? "Try a different search." : "All products already have an active VIP code."}
              </s-text>
            </s-stack>
          </s-box>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>
                <s-checkbox
                  accessibilityLabel="Select all products"
                  checked={allVisibleSelected}
                  onChange={(e) => toggleAllVisible(e.currentTarget.checked)}
                />
              </s-table-header>
              <s-table-header listSlot="primary">Product</s-table-header>
              <s-table-header format="currency">Price</s-table-header>
              <s-table-header format="currency">Compare-at</s-table-header>
              <s-table-header format="currency">VIP price at {percent}%</s-table-header>
              <s-table-header listSlot="secondary">Eligibility</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {visibleProducts.map((p) => {
                const calc = computeTargetAndFixedDiscount(p.price, p.compareAtPrice, percent);
                return (
                  <s-table-row key={p.id}>
                    <s-table-cell>
                      <s-checkbox
                        accessibilityLabel={`Select ${p.name}`}
                        checked={Boolean(selected[p.id])}
                        onChange={() => toggleProduct(p.id)}
                      />
                    </s-table-cell>
                    <s-table-cell>{p.name}</s-table-cell>
                    <s-table-cell>{money(p.price)}</s-table-cell>
                    <s-table-cell>{p.compareAtPrice ? money(p.compareAtPrice) : "—"}</s-table-cell>
                    <s-table-cell>{money(calc.targetPrice)}</s-table-cell>
                    <s-table-cell>
                      {calc.shouldApply ? (
                        <s-badge tone="success">Eligible · saves {money(calc.fixedAmount)}</s-badge>
                      ) : (
                        <s-tooltip id={`why-${p.id}`}>{calc.reason}</s-tooltip>
                      )}
                      {!calc.shouldApply && (
                        <s-badge tone="warning" interestFor={`why-${p.id}`}>Not eligible</s-badge>
                      )}
                    </s-table-cell>
                  </s-table-row>
                );
              })}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      {result && fetcher.state === "idle" && (
        <s-section heading="Last result">
          <s-stack gap="base">
            {result.applied?.length > 0 && (
              <s-banner tone="success" heading={`${result.applied.length} codes created`}>
                <s-unordered-list>
                  {result.applied.map((item, idx) => (
                    <s-list-item key={idx}>
                      <s-text type="strong">{item.code}</s-text> — {item.productName} · VIP price{" "}
                      {money(item.targetPrice)}
                      {item.segmentRestricted ? " · Segment only" : " · Any customer with the code"}
                    </s-list-item>
                  ))}
                </s-unordered-list>
              </s-banner>
            )}
            {result.errors?.length > 0 && (
              <s-banner tone="critical" heading={`${result.errors.length} products were skipped`}>
                <s-unordered-list>
                  {result.errors.map((err, idx) => (
                    <s-list-item key={idx}>{err.code ? `${err.code}: ` : ""}{err.message}</s-list-item>
                  ))}
                </s-unordered-list>
              </s-banner>
            )}
          </s-stack>
        </s-section>
      )}

      <s-section slot="aside" heading="Which option should I use?">
        <s-stack gap="small-200">
          <s-paragraph>
            <s-text type="strong">Automatic pricing</s-text> applies in cart and checkout for tagged,
            logged-in customers. Best for most stores.
          </s-paragraph>
          <s-paragraph>
            <s-text type="strong">Manual codes</s-text> need the customer to enter a code. Add a segment
            ID so only VIP customers can use them.
          </s-paragraph>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Show VIP prices on your store">
        <s-paragraph>
          Add the VIP price block to your product page in the theme editor so VIP customers see their
          price before checkout.
        </s-paragraph>
        <s-button href="shopify://admin/themes/current/editor?context=apps" target="_blank">
          Open theme editor
        </s-button>
      </s-section>
    </s-page>
  );
}

function DateTimeInput({ id, label, value, onChange }) {
  return (
    <s-stack gap="small-300">
      <label htmlFor={id}>
        <s-text>{label}</s-text>
      </label>
      <input
        id={id}
        type="datetime-local"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          font: "inherit",
          padding: "6px 10px",
          minHeight: 32,
          border: "1px solid #8a8a8a",
          borderRadius: 8,
          background: "#fff",
        }}
      />
    </s-stack>
  );
}

function formatStatus(status) {
  if (!status) return "Unknown";
  return status.charAt(0) + status.slice(1).toLowerCase();
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
