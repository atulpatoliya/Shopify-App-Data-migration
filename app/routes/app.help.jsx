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
    a: "No. Import only updates products that already exist and match a row in your file by handle or title.",
  },
  {
    q: "Which fields can be imported?",
    a: "Title, vendor, product type, status, description, tags and handle. Empty cells are ignored.",
  },
  {
    q: "How do VIP customers get their price?",
    a: "Tag a customer with the VIP tag (default vip_customer). When they log in, automatic VIP pricing applies in cart and checkout.",
  },
  {
    q: "Can VIP pricing combine with other discounts?",
    a: "No. Automatic VIP pricing doesn't combine with other product, order or shipping discounts.",
  },
  {
    q: "What happens to my data if I uninstall?",
    a: "We delete the app's session data for your store. Your products and discounts in Shopify are not changed.",
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
          <s-list-item><s-link href="/app/import">Bulk update products from a file</s-link></s-list-item>
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
          This app reads product and customer segment data only to provide its features. Customer
          personal data isn&apos;t stored by the app.
        </s-paragraph>
        <s-link href="/privacy" target="_blank">Read the privacy policy</s-link>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
