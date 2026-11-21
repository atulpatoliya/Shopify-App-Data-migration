// Fetches one page of products for export, in the shape product-format.js expects.
export const EXPORT_PAGE_SIZE = 50;

const EXPORT_PAGE_QUERY = `#graphql
  query exportPage($first: Int!, $after: String, $query: String) {
    products(first: $first, after: $after, query: $query) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id title vendor productType status tags handle createdAt updatedAt
        totalInventory descriptionHtml
        priceRange: priceRangeV2 {
          minVariantPrice { amount currencyCode }
          maxVariantPrice { amount currencyCode }
        }
        seo { title description }
        options { name }
        media(first: 10) { nodes { ... on MediaImage { image { url } } } }
        collections(first: 5) { nodes { title } }
        metafields(first: 20) { nodes { namespace key type value } }
        variants(first: 100) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id title sku price compareAtPrice inventoryQuantity barcode
            selectedOptions { name value }
            inventoryItem { measurement { weight { value unit } } }
          }
        }
      }
    }
  }
`;

const EXTRA_VARIANTS_QUERY = `#graphql
  query extraVariants($id: ID!, $after: String) {
    product(id: $id) {
      variants(first: 250, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id title sku price compareAtPrice inventoryQuantity barcode
          selectedOptions { name value }
          inventoryItem { measurement { weight { value unit } } }
        }
      }
    }
  }
`;

export async function fetchExportPage(admin, { first = EXPORT_PAGE_SIZE, after = null, query = null }) {
  const res = await admin.graphql(EXPORT_PAGE_QUERY, { variables: { first, after, query } });
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join(", "));
  const page = json.data.products;

  const products = [];
  for (const node of page.nodes) {
    let info = node.variants.pageInfo;
    while (info?.hasNextPage) {
      const r = await admin.graphql(EXTRA_VARIANTS_QUERY, { variables: { id: node.id, after: info.endCursor } });
      const extra = (await r.json()).data?.product?.variants;
      if (!extra) break;
      node.variants.nodes.push(...extra.nodes);
      info = extra.pageInfo;
    }
    products.push({
      ...node,
      images: { nodes: node.media.nodes.filter((m) => m?.image?.url).map((m) => ({ url: m.image.url })) },
    });
  }
  return { products, hasNextPage: page.pageInfo.hasNextPage, cursor: page.pageInfo.endCursor };
}

/** Fetches all products (up to `limit`) — used by scheduled exports. */
export async function fetchAllProducts(admin, { query = null, limit = null } = {}) {
  const all = [];
  let after = null;
  for (;;) {
    const remaining = limit == null ? EXPORT_PAGE_SIZE : Math.min(EXPORT_PAGE_SIZE, limit - all.length);
    if (remaining <= 0) break;
    const page = await fetchExportPage(admin, { first: remaining, after, query });
    all.push(...page.products);
    if (!page.hasNextPage) break;
    after = page.cursor;
  }
  return all;
}
