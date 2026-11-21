import { useLoaderData } from "react-router";
import { SUPPORT_EMAIL } from "../shopify.server";

// Public Terms of Service page (no login). Includes the data processing terms
// that form the privacy and data protection agreement with merchants.
export const loader = () => ({
  supportEmail: SUPPORT_EMAIL,
  updated: "2026-11-22",
});

export const meta = () => [{ title: "Terms of service – Bulk Migration & VIP Pricing" }];

export default function Terms() {
  const { supportEmail, updated } = useLoaderData();
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "48px 20px", fontFamily: "Inter, system-ui, sans-serif", lineHeight: 1.6, color: "#303030" }}>
      <h1>Terms of service</h1>
      <p style={{ color: "#616161" }}>Last updated: {updated}</p>

      <p>
        These terms apply to merchants who install Bulk Migration &amp; VIP Pricing (&quot;the App&quot;)
        on a Shopify store. By installing or using the App you agree to these terms and to our{" "}
        <a href="/privacy">privacy policy</a>.
      </p>

      <h2>1. The service</h2>
      <p>
        The App lets you export product data to Excel, update existing products from a file, and offer
        automatic pricing to customers you tag as VIP. Features may change over time; we will tell you
        about changes that significantly affect how you use the App.
      </p>

      <h2>2. Your responsibilities</h2>
      <ul>
        <li>You are responsible for the data you import and the prices and discounts you configure.</li>
        <li>Imports overwrite existing product values. Export a backup before large changes.</li>
        <li>You must have the right to use any data you upload, and comply with Shopify&apos;s terms.</li>
      </ul>

      <h2>3. Fees</h2>
      <p>
        The App is currently free. If paid plans are introduced, charges are billed through Shopify,
        shown to you before you approve them, and you can cancel at any time. We will give notice before
        any free features become paid.
      </p>

      <h2>4. Data processing agreement</h2>
      <p>
        For personal data the App accesses on your behalf, you are the data controller and we act as
        your data processor. We agree to:
      </p>
      <ul>
        <li>Process personal data only to provide the App&apos;s features, following your instructions.</li>
        <li>Access only the minimum data needed (customer IDs and tags for VIP pricing).</li>
        <li>Not sell, rent or share personal data with third parties.</li>
        <li>Protect data with encryption in transit (HTTPS) and at rest.</li>
        <li>Keep store data only while the App is installed, and delete it after uninstall or when
          Shopify sends a data deletion request.</li>
        <li>Respond to customer data requests forwarded by Shopify, and notify you without undue delay
          of any security incident affecting your data.</li>
      </ul>

      <h2>5. Availability and liability</h2>
      <p>
        We work to keep the App available and accurate, but it is provided &quot;as is&quot; without
        warranties. To the extent permitted by law, we are not liable for indirect or consequential
        losses, or for losses caused by data you import or settings you choose.
      </p>

      <h2>6. Ending use</h2>
      <p>
        You can stop using the App at any time by uninstalling it. We may suspend access if the App is
        misused or if required by Shopify or by law.
      </p>

      <h2>7. Contact</h2>
      <p>
        Questions about these terms: <a href={`mailto:${supportEmail}`}>{supportEmail}</a>
      </p>
    </main>
  );
}
