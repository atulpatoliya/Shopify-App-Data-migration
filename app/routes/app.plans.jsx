/* eslint-disable react/prop-types */
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getCurrentPlan, planSelectionUrl, PLAN_TIERS } from "../plans.server";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const plan = await getCurrentPlan(admin);
  return {
    plan,
    tiers: PLAN_TIERS,
    changePlanUrl: planSelectionUrl(session.shop),
  };
};

const formatLimit = (limit) =>
  limit == null ? "Unlimited products" : `Up to ${limit.toLocaleString()} products`;

export default function PlansPage() {
  const { plan, tiers, changePlanUrl } = useLoaderData();

  return (
    <s-page heading="Plans">
      <s-link slot="breadcrumb-actions" href="/app">Dashboard</s-link>
      {plan.enforced && (
        <s-button slot="primary-action" variant="primary" href={changePlanUrl} target="_top">
          Change plan
        </s-button>
      )}

      <s-section>
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <s-text>Current plan:</s-text>
          <s-badge tone="success">{plan.name}</s-badge>
          <s-text color="subdued">
            {plan.limit == null
              ? "Unlimited products per export and import"
              : `${plan.limit.toLocaleString()} products per export and import`}
          </s-text>
        </s-stack>
      </s-section>

      <s-section heading="Every plan includes all features">
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap="base">
          {tiers.map((t) => (
            <s-box
              key={t.name}
              padding="base"
              border="base"
              borderRadius="base"
              background={t.name === plan.name ? "subdued" : "base"}
            >
              <s-stack gap="small-200">
                <s-stack direction="inline" justifyContent="space-between" alignItems="center">
                  <s-heading>{t.name}</s-heading>
                  {t.name === plan.name && <s-badge tone="success">Current</s-badge>}
                </s-stack>
                <s-text type="strong">{t.price === 0 ? "Free" : `$${t.price} / month`}</s-text>
                <s-text>{formatLimit(t.limit)}</s-text>
                {t.price > 0 && <s-text color="subdued">7-day free trial</s-text>}
              </s-stack>
            </s-box>
          ))}
        </s-grid>
      </s-section>

      <s-section heading="Included in every plan">
        <s-unordered-list>
          <s-list-item>Excel export of products, variants, prices, inventory, images and SEO</s-list-item>
          <s-list-item>Bulk update from Excel or CSV with a preview before saving</s-list-item>
          <s-list-item>Automatic VIP discounts for tagged customers</s-list-item>
        </s-unordered-list>
      </s-section>

      <s-section slot="aside" heading="Billing">
        <s-paragraph>
          Plans are billed by Shopify on your regular Shopify invoice. You can change or cancel your
          plan at any time.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
