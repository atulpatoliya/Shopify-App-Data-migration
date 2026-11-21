/* eslint-disable react/prop-types */
import { Form, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { APP_HANDLE, authenticate, BILLING_ENABLED, BILLING_IS_TEST, PLANS, PRO_PLAN } from "../shopify.server";

export const loader = async ({ request }) => {
  const { billing } = await authenticate.admin(request);

  let currentPlan = "Free";
  if (BILLING_ENABLED) {
    const { hasActivePayment, appSubscriptions } = await billing.check({
      plans: [PRO_PLAN],
      isTest: BILLING_IS_TEST,
    });
    if (hasActivePayment) currentPlan = appSubscriptions[0]?.name || PRO_PLAN;
  }

  const pro = PLANS[PRO_PLAN].lineItems[0];
  return {
    billingEnabled: BILLING_ENABLED,
    currentPlan,
    pro: { name: PRO_PLAN, price: pro.amount, currency: pro.currencyCode, trialDays: PLANS[PRO_PLAN].trialDays },
  };
};

export const action = async ({ request }) => {
  const { billing, session } = await authenticate.admin(request);
  if (!BILLING_ENABLED) return { error: "Paid plans are not available yet." };

  const form = await request.formData();
  const isTest = BILLING_IS_TEST;

  if (form.get("intent") === "cancel") {
    const { appSubscriptions } = await billing.check({ plans: [PRO_PLAN], isTest });
    if (appSubscriptions[0]) {
      await billing.cancel({ subscriptionId: appSubscriptions[0].id, isTest, prorate: true });
    }
    return { ok: true };
  }

  // Redirects the merchant to Shopify's approval page.
  const storeHandle = session.shop.replace(".myshopify.com", "");
  const appHandle = APP_HANDLE;
  return billing.request({
    plan: PRO_PLAN,
    isTest,
    returnUrl: `https://admin.shopify.com/store/${storeHandle}/apps/${appHandle}/app/plans`,
  });
};

const FREE_FEATURES = ["Excel export", "Bulk import from file", "VIP pricing"];
const PRO_FEATURES = ["Everything in Free", "Priority support", "Large catalogs and scheduled exports"];

export default function PlansPage() {
  const { billingEnabled, currentPlan, pro } = useLoaderData();
  const busy = useNavigation().state !== "idle";
  const onPro = currentPlan !== "Free";

  return (
    <s-page heading="Plans">
      <s-link slot="breadcrumb-actions" href="/app">Dashboard</s-link>

      {!billingEnabled && (
        <s-banner tone="info" heading="This app is free right now">
          All features are free while the app is in early access. We&apos;ll let you know well before
          any paid plans start.
        </s-banner>
      )}

      <s-section>
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(260px, 1fr))" gap="base">
          <PlanCard
            name="Free"
            price="$0"
            features={FREE_FEATURES}
            current={!onPro}
          />
          <PlanCard
            name={pro.name}
            price={`$${pro.price}`}
            note={`${pro.currency} / 30 days · ${pro.trialDays}-day free trial`}
            features={PRO_FEATURES}
            current={onPro}
          >
            {!billingEnabled ? (
              <s-button disabled>Coming soon</s-button>
            ) : onPro ? (
              <Form method="post">
                <input type="hidden" name="intent" value="cancel" />
                <s-button type="submit" tone="critical" {...(busy ? { loading: true } : {})}>
                  Cancel plan
                </s-button>
              </Form>
            ) : (
              <Form method="post">
                <input type="hidden" name="intent" value="upgrade" />
                <s-button type="submit" variant="primary" {...(busy ? { loading: true } : {})}>
                  Start free trial
                </s-button>
              </Form>
            )}
          </PlanCard>
        </s-grid>
      </s-section>

      <s-section slot="aside" heading="Billing">
        <s-paragraph>
          Charges are billed by Shopify on your regular Shopify invoice. You can cancel at any time.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

function PlanCard({ name, price, note, features, current, children }) {
  return (
    <s-box padding="base" border="base" borderRadius="base">
      <s-stack gap="base">
        <s-stack direction="inline" justifyContent="space-between" alignItems="center">
          <s-heading>{name}</s-heading>
          {current && <s-badge tone="success">Current plan</s-badge>}
        </s-stack>
        <s-stack gap="small-300">
          <s-text type="strong">{price}</s-text>
          {note && <s-text color="subdued">{note}</s-text>}
        </s-stack>
        <s-unordered-list>
          {features.map((f) => (
            <s-list-item key={f}>{f}</s-list-item>
          ))}
        </s-unordered-list>
        {children}
      </s-stack>
    </s-box>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
