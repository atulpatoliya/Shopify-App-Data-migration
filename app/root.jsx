import { appApiKey, authenticate } from "./shopify.server";
export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return { apiKey: appApiKey };
};

import { Links, Meta, Outlet, Scripts, ScrollRestoration, useLoaderData } from "react-router";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

export default function App() {
  const { apiKey } = useLoaderData();
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
      </head>
      <body>
        <AppProvider embedded apiKey={apiKey}>
          <Outlet />
        </AppProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
