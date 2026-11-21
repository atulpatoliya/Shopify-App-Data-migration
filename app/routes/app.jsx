import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { appApiKey, authenticate, PLAN_LIMITS_ENABLED } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return { apiKey: appApiKey, showPlans: PLAN_LIMITS_ENABLED };
};

export default function App() {
  const { apiKey, showPlans } = useLoaderData();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app" rel="home">Dashboard</s-link>
        <s-link href="/app/export">Export products</s-link>
        <s-link href="/app/import">Import products</s-link>
        <s-link href="/app/history">Import history</s-link>
        <s-link href="/app/schedule">Scheduled exports</s-link>
        <s-link href="/app/discount">VIP pricing</s-link>
        {/* Plans only for the public App Store app (custom app is unlimited) */}
        {showPlans && <s-link href="/app/plans">Plans</s-link>}
        <s-link href="/app/help">Help &amp; support</s-link>
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
