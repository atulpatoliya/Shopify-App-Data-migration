import { authenticate, sessionStorage } from "../shopify.server";
import { deleteShopData } from "../db.server";

// Mandatory privacy (GDPR) compliance webhooks.
// https://shopify.dev/docs/apps/build/privacy-law-compliance
// authenticate.webhook verifies the HMAC and responds 401 if it is invalid.
export const action = async ({ request }) => {
  const { topic, shop } = await authenticate.webhook(request);

  switch (topic) {
    case "CUSTOMERS_DATA_REQUEST":
      // This app does not store customer personal data, so there is nothing to return.
      console.log(`[compliance] data request for ${shop}: no customer data stored`);
      break;
    case "CUSTOMERS_REDACT":
      // No customer data stored by the app — nothing to delete.
      console.log(`[compliance] customer redact for ${shop}: no customer data stored`);
      break;
    case "SHOP_REDACT": {
      // Sent 48 hours after uninstall: remove everything stored for this shop.
      const sessions = await sessionStorage.findSessionsByShop(shop);
      if (sessions.length) {
        await sessionStorage.deleteSessions(sessions.map((s) => s.id));
      }
      await deleteShopData(shop);
      console.log(`[compliance] shop redact for ${shop}: deleted ${sessions.length} sessions and app data`);
      break;
    }
    default:
      console.warn(`[compliance] unhandled topic ${topic} for ${shop}`);
  }

  return new Response();
};
