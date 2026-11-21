/* eslint-disable react/prop-types */
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  const response = await admin.graphql(`#graphql
    query dashboard {
      shop { name currencyCode }
      total: productsCount { count }
      active: productsCount(query: "status:active") { count }
      draft: productsCount(query: "status:draft") { count }
      archived: productsCount(query: "status:archived") { count }
      vip: discountNodes(first: 1, query: "title:VIP-AUTO-FUNCTION") {
        nodes {
          discount { ... on DiscountAutomaticApp { title status } }
          metafield(namespace: "$app:vip-product-discount", key: "function-configuration") { value }
        }
      }
    }
  `);
  const json = await response.json();
  const d = json?.data ?? {};

  const vipNode = d.vip?.nodes?.find((n) => n?.discount?.title === "VIP-AUTO-FUNCTION");
  let vipPercent = null;
  try {
    vipPercent = JSON.parse(vipNode?.metafield?.value || "{}").percentage ?? null;
  } catch {
    vipPercent = null;
  }

  return {
    shopName: d.shop?.name || session.shop,
    stats: {
      total: d.total?.count ?? 0,
      active: d.active?.count ?? 0,
      draft: d.draft?.count ?? 0,
      archived: d.archived?.count ?? 0,
    },
    vip: {
      exists: Boolean(vipNode),
      status: vipNode?.discount?.status ?? null,
      percent: vipPercent,
    },
  };
};

const ACTIONS = [
  {
    title: "Export products",
    description: "Download products, variants, prices and inventory as an Excel file.",
    href: "/app/export",
    icon: "export",
    cta: "Start export",
  },
  {
    title: "Import products",
    description: "Upload an edited file to update many products at once.",
    href: "/app/import",
    icon: "import",
    cta: "Start import",
  },
  {
    title: "VIP pricing",
    description: "Give tagged VIP customers automatic prices in cart and checkout.",
    href: "/app/discount",
    icon: "discount",
    cta: "Manage VIP pricing",
  },
];

export default function Dashboard() {
  const { shopName, stats, vip } = useLoaderData();
  const vipActive = vip.exists && vip.status === "ACTIVE";

  const steps = [
    { done: stats.total > 0, label: "Add products to your store", href: "shopify://admin/products" },
    { done: false, label: "Export a backup of your products", href: "/app/export" },
    { done: vipActive, label: "Turn on automatic VIP pricing", href: "/app/discount" },
  ];
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <s-page heading="Dashboard">
      <s-button slot="primary-action" variant="primary" href="/app/export">
        Export products
      </s-button>
      <s-button slot="secondary-actions" href="/app/import">Import products</s-button>

      <s-section>
        <s-stack gap="small-200">
          <s-heading>Welcome, {shopName}</s-heading>
          <s-paragraph color="subdued">
            Move product data in and out of Shopify with Excel, and manage VIP customer pricing.
          </s-paragraph>
        </s-stack>
      </s-section>

      <s-section heading="Store overview">
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(150px, 1fr))" gap="base">
          <Metric label="Total products" value={stats.total} />
          <Metric label="Active" value={stats.active} />
          <Metric label="Draft" value={stats.draft} />
          <Metric label="Archived" value={stats.archived} />
        </s-grid>
      </s-section>

      <s-section heading="What would you like to do?">
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))" gap="base">
          {ACTIONS.map((a) => (
            <s-box key={a.href} padding="base" border="base" borderRadius="base">
              <s-stack gap="small-200">
                <s-stack direction="inline" gap="small-200" alignItems="center">
                  <s-icon type={a.icon} />
                  <s-heading>{a.title}</s-heading>
                </s-stack>
                <s-paragraph color="subdued">{a.description}</s-paragraph>
                <s-box>
                  <s-button href={a.href}>{a.cta}</s-button>
                </s-box>
              </s-stack>
            </s-box>
          ))}
        </s-grid>
      </s-section>

      <s-section slot="aside" heading="Setup guide">
        <s-stack gap="small-200">
          <s-text color="subdued">{doneCount} of {steps.length} completed</s-text>
          {steps.map((s) => (
            <s-stack key={s.label} direction="inline" gap="small-200" alignItems="center">
              <s-icon type={s.done ? "check-circle-filled" : "circle"} tone={s.done ? "success" : undefined} />
              <s-link href={s.href}>{s.label}</s-link>
            </s-stack>
          ))}
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="VIP pricing">
        <s-stack gap="small-200">
          <s-stack direction="inline" gap="small-200">
            {vip.exists ? (
              <s-badge tone={vipActive ? "success" : "warning"}>{vipActive ? "Active" : "Inactive"}</s-badge>
            ) : (
              <s-badge>Not set up</s-badge>
            )}
            {vip.percent != null && <s-badge tone="info">{vip.percent}% off</s-badge>}
          </s-stack>
          <s-link href="/app/discount">Manage VIP pricing</s-link>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Need help?">
        <s-paragraph>
          Read the guides or contact support from <s-link href="/app/help">Help &amp; support</s-link>.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

function Metric({ label, value }) {
  return (
    <s-box padding="base" border="base" borderRadius="base">
      <s-stack gap="small-300">
        <s-text color="subdued">{label}</s-text>
        <s-heading>{Number(value).toLocaleString()}</s-heading>
      </s-stack>
    </s-box>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
