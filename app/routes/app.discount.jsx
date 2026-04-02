

import { useState } from "react";
import { useLoaderData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";

// Loader to fetch products from Shopify
// Helper to get collection IDs for selected products (for demo, not fetching real collections)
async function getCollectionIdsForProducts() {
  // You can implement this if you want to support collections
  return [];
}

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const discounts = JSON.parse(formData.get("discounts"));
  const code = formData.get("discount_code") || `DISCOUNT-${Date.now()}`;
  const discountType = formData.get("discount_type") || "percentage";
  const isAutomatic = formData.get("automatic") === "on";
  const startsAt = formData.get("starts_at") || new Date().toISOString();
  const endsAt = formData.get("ends_at") || null;
  const usageLimit = formData.get("usage_limit") ? parseInt(formData.get("usage_limit")) : null;
  const perCustomerLimit = formData.get("per_customer_limit") ? parseInt(formData.get("per_customer_limit")) : null;
  const appliesTo = formData.get("applies_to") || "products";
  const productIds = Object.keys(discounts);
  let collectionIds = [];
  if (appliesTo === "collections") {
    collectionIds = await getCollectionIdsForProducts(productIds, admin);
  }
  const discountValue = parseFloat(discounts[productIds[0]]); // For demo, use first discount value
  // Build the mutation and variables
  let mutation, variables;
  if (isAutomatic) {
    mutation = `#graphql
      mutation discountAutomaticBasicCreate($automaticAppDiscount: DiscountAutomaticBasicInput!) {
        discountAutomaticBasicCreate(automaticAppDiscount: $automaticAppDiscount) {
          userErrors { field message }
          automaticAppDiscount { id }
        }
      }
    `;
    variables = {
      automaticAppDiscount: {
        title: code,
        startsAt,
        endsAt,
        customerGets: {
          value: discountType === "percentage"
            ? { percentage: { value: discountValue } }
            : { fixedAmount: { value: discountValue, appliesOnEachItem: true } },
          items:
            appliesTo === "products"
              ? { products: productIds }
              : appliesTo === "collections"
              ? { collections: collectionIds }
              : { all: true },
        },
        appliesOncePerCustomer: !!perCustomerLimit,
        usageLimit: usageLimit,
        combinesWith: { orderDiscounts: true, productDiscounts: false, shippingDiscounts: false },
      },
    };
  } else {
    mutation = `#graphql
      mutation discountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
        discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
          userErrors { field message }
          codeDiscountNode { id }
        }
      }
    `;
    variables = {
      basicCodeDiscount: {
        title: code,
        code,
        startsAt,
        endsAt,
        customerGets: {
          value: discountType === "percentage"
            ? { percentage: { value: discountValue } }
            : { fixedAmount: { value: discountValue, appliesOnEachItem: true } },
          items:
            appliesTo === "products"
              ? { products: productIds }
              : appliesTo === "collections"
              ? { collections: collectionIds }
              : { all: true },
        },
        appliesOncePerCustomer: !!perCustomerLimit,
        usageLimit: usageLimit,
        combinesWith: { orderDiscounts: true, productDiscounts: false, shippingDiscounts: false },
      },
    };
  }
  const response = await admin.graphql(mutation, { variables });
  const json = await response.json();
  const errors = isAutomatic
    ? json.data.discountAutomaticBasicCreate.userErrors
    : json.data.discountCodeBasicCreate.userErrors;
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, code };
};

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  let hasNextPage = true;
  let after = null;
  const allProducts = [];
  while (hasNextPage) {
    const response = await admin.graphql(
      `#graphql
        query getProducts($first: Int!, $after: String) {
          products(first: $first, after: $after) {
            pageInfo { hasNextPage endCursor }
            edges {
              node {
                id
                title
                priceRange {
                  minVariantPrice { amount currencyCode }
                  maxVariantPrice { amount currencyCode }
                }
                variants(first: 1) {
                  edges {
                    node {
                      compareAtPrice
                    }
                  }
                }
              }
            }
          }
        }
      `,
      { variables: { first: 100, after } }
    );
    const json = await response.json();
    const pageProducts = json.data.products.edges.map((e) => e.node);
    allProducts.push(...pageProducts);
    hasNextPage = json.data.products.pageInfo.hasNextPage;
    after = json.data.products.pageInfo.endCursor;
  }
  // Map to simpler structure for the table
  const products = allProducts.map((p) => ({
    id: p.id,
    name: p.title,
    price: p.priceRange.minVariantPrice.amount,
    compareAtPrice: p.variants.edges[0]?.node?.compareAtPrice || "-",
  }));
  return { products };
}

export default function DiscountPage() {
  const { products } = useLoaderData();
  const navigation = useNavigation();
  const [discounts, setDiscounts] = useState({});
  const [discountCode, setDiscountCode] = useState("");
  const [discountType, setDiscountType] = useState("percentage");
  const [automatic, setAutomatic] = useState(false);
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [usageLimit, setUsageLimit] = useState("");
  const [perCustomerLimit, setPerCustomerLimit] = useState("");
  const [appliesTo, setAppliesTo] = useState("products");
  const [applied, setApplied] = useState(null);
  const [serverResult, setServerResult] = useState(null);

  const handleDiscountChange = (id, value) => {
    setDiscounts((prev) => ({ ...prev, [id]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const form = e.target;
    const formData = new FormData(form);
    formData.set("discounts", JSON.stringify(discounts));
    // Add advanced options
    formData.set("discount_type", discountType);
    if (automatic) formData.set("automatic", "on");
    if (startsAt) formData.set("starts_at", startsAt);
    if (endsAt) formData.set("ends_at", endsAt);
    if (usageLimit) formData.set("usage_limit", usageLimit);
    if (perCustomerLimit) formData.set("per_customer_limit", perCustomerLimit);
    formData.set("applies_to", appliesTo);
    // Submit using fetch to action
    const res = await fetch("/app/discount", {
      method: "POST",
      body: formData,
    });
    const result = await res.json();
    setServerResult(result);
    if (result.ok) {
      setApplied(
        products
          .filter((product) => discounts[product.id])
          .map((product) => ({
            name: product.name,
            price: product.price,
            compareAtPrice: product.compareAtPrice,
            discount: discounts[product.id],
          }))
      );
    }
  };

  return (
    <div style={{ maxWidth: 800, margin: "2rem auto" }}>
      <h2>Apply Discount Per Product</h2>
      <form method="post" onSubmit={handleSubmit}>
        <div style={{ marginBottom: 12, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <label htmlFor="discount-type">Discount Type: </label>
            <select id="discount-type" value={discountType} onChange={e => setDiscountType(e.target.value)} name="discount_type">
              <option value="percentage">Percentage (%)</option>
              <option value="fixed">Fixed Amount</option>
            </select>
          </div>
          <div>
            <label htmlFor="automatic-discount">Automatic Discount: </label>
            <input id="automatic-discount" type="checkbox" checked={automatic} onChange={e => setAutomatic(e.target.checked)} name="automatic" />
          </div>
          {!automatic && (
            <div>
              <label htmlFor="discount-code">Discount Code (for checkout): </label>
              <input
                id="discount-code"
                type="text"
                name="discount_code"
                value={discountCode}
                onChange={(e) => setDiscountCode(e.target.value)}
                placeholder="e.g. SPRING10"
                style={{ width: 120 }}
              />
            </div>
          )}
          <div>
            <label htmlFor="starts-at">Start Date: </label>
            <input id="starts-at" type="datetime-local" value={startsAt} onChange={e => setStartsAt(e.target.value)} name="starts_at" />
          </div>
          <div>
            <label htmlFor="ends-at">End Date: </label>
            <input id="ends-at" type="datetime-local" value={endsAt} onChange={e => setEndsAt(e.target.value)} name="ends_at" />
          </div>
          <div>
            <label htmlFor="usage-limit">Usage Limit: </label>
            <input id="usage-limit" type="number" min="1" value={usageLimit} onChange={e => setUsageLimit(e.target.value)} name="usage_limit" style={{ width: 80 }} />
          </div>
          <div>
            <label htmlFor="per-customer-limit">Per Customer Limit: </label>
            <input id="per-customer-limit" type="number" min="1" value={perCustomerLimit} onChange={e => setPerCustomerLimit(e.target.value)} name="per_customer_limit" style={{ width: 80 }} />
          </div>
          <div>
            <label htmlFor="applies-to">Applies To: </label>
            <select id="applies-to" value={appliesTo} onChange={e => setAppliesTo(e.target.value)} name="applies_to">
              <option value="products">Selected Products</option>
              <option value="collections">Collections (not implemented)</option>
              <option value="all">All Products</option>
            </select>
          </div>
        </div>
        <table border="1" cellPadding="8" cellSpacing="0" style={{ width: "100%", marginBottom: 16 }}>
          <thead>
            <tr>
              <th>Product Name</th>
              <th>Price</th>
              <th>Compare Price</th>
              <th>Discount (%)</th>
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr key={product.id}>
                <td>{product.name}</td>
                <td>{product.price}</td>
                <td>{product.compareAtPrice}</td>
                <td>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={discounts[product.id] || ""}
                    onChange={(e) => handleDiscountChange(product.id, e.target.value)}
                    style={{ width: 60 }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="submit" disabled={navigation.state === "submitting"}>
          {navigation.state === "submitting" ? "Applying..." : "Apply Discounts"}
        </button>
      </form>
      {serverResult && serverResult.ok && (
        <div style={{ marginTop: 24 }}>
          <h3>Discount Code Created: <span style={{color:'green'}}>{serverResult.code}</span></h3>
          <p>Customers can use this code at checkout for the selected products.</p>
          <table border="1" cellPadding="8" cellSpacing="0" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th>Product Name</th>
                <th>Price</th>
                <th>Compare Price</th>
                <th>Discount (%)</th>
              </tr>
            </thead>
            <tbody>
              {applied.map((item, idx) => (
                <tr key={idx}>
                  <td>{item.name}</td>
                  <td>{item.price}</td>
                  <td>{item.compareAtPrice}</td>
                  <td>{item.discount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {serverResult && serverResult.errors && (
        <div style={{color:'red'}}>
          <h4>Errors:</h4>
          <ul>
            {serverResult.errors.map((err, idx) => (
              <li key={idx}>{err.message}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
