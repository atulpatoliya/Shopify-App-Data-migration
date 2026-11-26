import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate, SUPPORT_EMAIL } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return { supportEmail: SUPPORT_EMAIL };
};

const FAQ = [
  {
    q: "Does import create new products?",
    a: "Yes. Rows that match an existing product (by handle or title) update it; other rows become new products, saved as Draft by default. You can turn creating off in the import settings.",
  },
  {
    q: "Which fields can be imported?",
    a: "Title, vendor, type, status, description, tags, handle, SEO, variant price, compare-at price, SKU, barcode, stock, images and product metafields. Empty cells are ignored.",
  },
  {
    q: "Can I undo an import?",
    a: "Yes. Every import saves a backup first. Open Import history and select Undo to restore the previous values and delete products the import created.",
  },
  {
    q: "Can I import a Shopify product CSV?",
    a: "Yes. Files in Shopify's product CSV format, for example exported from another store you own, are detected automatically. You can also export in that format.",
  },
  {
    q: "How do VIP customers get their price?",
    a: "Tag a customer with vip_customer. When they log in, the automatic VIP discount applies in cart and checkout.",
  },
  {
    q: "Do VIP discounts combine with other discounts?",
    a: "No. The automatic VIP discount doesn't combine with other product, order or shipping discounts.",
  },
  {
    q: "What happens to my data if I uninstall?",
    a: "Scheduled exports stop and the app's session data is deleted. Import history and backups are deleted 48 hours later. Your products and discounts in Shopify are not changed.",
  },
];

export default function HelpPage() {
  const { supportEmail } = useLoaderData();
  return (
    <s-page heading="Help & support">
      <s-link slot="breadcrumb-actions" href="/app">Dashboard</s-link>

      <s-section heading="Frequently asked questions">
        <s-stack gap="base">
          {FAQ.map((item, i) => (
            <s-stack key={item.q} gap="small-300">
              {i > 0 && <s-divider />}
              <s-text type="strong">{item.q}</s-text>
              <s-paragraph color="subdued">{item.a}</s-paragraph>
            </s-stack>
          ))}
        </s-stack>
      </s-section>

      <s-section heading="Guides">
        <s-unordered-list>
          <s-list-item><s-link href="/app/export">Export products to Excel</s-link></s-list-item>
          <s-list-item><s-link href="/app/import">Import, update or create products from a file</s-link></s-list-item>
          <s-list-item><s-link href="/app/history">Undo an import</s-link></s-list-item>
          <s-list-item><s-link href="/app/schedule">Email a product export every week</s-link></s-list-item>
          <s-list-item><s-link href="/app/discount">Set up VIP pricing</s-link></s-list-item>
        </s-unordered-list>
      </s-section>

      <s-section slot="aside" heading="Contact support">
        <s-stack gap="small-200">
          <s-paragraph>We usually reply within 1 business day.</s-paragraph>
          <s-button href={`mailto:${supportEmail}`} target="_blank">Email support</s-button>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Privacy">
        <s-paragraph>
          This app reads product and customer tag data only to provide its features. It stores import
          backups so you can undo; customer personal data isn&apos;t stored.
        </s-paragraph>
        <s-stack gap="small-200">
          <s-link href="/privacy" target="_blank">Privacy policy</s-link>
          <s-link href="/terms" target="_blank">Terms of service</s-link>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
