import { useLoaderData } from "react-router";
import { SUPPORT_EMAIL } from "../shopify.server";

// Public privacy policy page (no login). Use <APP_URL>/privacy as the
// "Privacy policy URL" in the Partner Dashboard / App Store listing.
export const loader = () => ({
  supportEmail: SUPPORT_EMAIL,
  updated: "2026-11-21",
});

export const meta = () => [{ title: "Privacy policy – Data Migration" }];

export default function Privacy() {
  const { supportEmail, updated } = useLoaderData();
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "48px 20px", fontFamily: "Inter, system-ui, sans-serif", lineHeight: 1.6, color: "#303030" }}>
      <h1>Privacy policy</h1>
      <p style={{ color: "#616161" }}>Last updated: {updated}</p>

      <p>
        Data Migration (&quot;the App&quot;) helps Shopify merchants export and import product data and
        manage VIP pricing. This policy explains what information the App accesses and how it is used.
      </p>

      <h2>Information we access</h2>
      <ul>
        <li><strong>Store information:</strong> shop domain, name and currency, needed to run the App.</li>
        <li><strong>Product data:</strong> products, variants, prices, inventory, images and SEO fields, used only for export and import.</li>
        <li><strong>Discounts:</strong> discounts the App creates for VIP pricing.</li>
        <li><strong>Customer segments and tags:</strong> read only to target VIP pricing. The App does not store customer personal data.</li>
      </ul>

      <h2>How we use information</h2>
      <p>
        Information is used only to provide the App&apos;s features to the merchant who installed it. We do
        not sell or share data with third parties. Export files are generated in your browser and are not
        stored on our servers.
      </p>

      <h2>Data we store</h2>
      <p>
        We store a Shopify access session for your store so the App can work. No customer personal
        information is stored.
      </p>

      <h2>Data retention and deletion</h2>
      <p>
        When you uninstall the App, its session data is deleted. We also respond to Shopify&apos;s
        mandatory privacy webhooks (customer data request, customer redact and shop redact).
      </p>

      <h2>Contact</h2>
      <p>
        Questions about this policy: <a href={`mailto:${supportEmail}`}>{supportEmail}</a>
      </p>
    </main>
  );
}
