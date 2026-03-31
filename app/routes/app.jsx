
import { Outlet, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

export default function App() {
  return (
    <>
      <s-app-nav>
        <s-link href="/app">📤 Export Products</s-link>
        <s-link href="/app/additional">📥 Import Products</s-link>
        <s-link href="/app/discount">💸 Apply Discount</s-link>
      </s-app-nav>
      <Outlet />
    </>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
