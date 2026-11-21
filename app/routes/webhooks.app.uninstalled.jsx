import { authenticate, sessionStorage } from "../shopify.server";

export const action = async ({ request }) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhooks can be delivered more than once, so this must be safe to repeat.
  const sessions = await sessionStorage.findSessionsByShop(shop);
  if (sessions.length) {
    await sessionStorage.deleteSessions(sessions.map((s) => s.id));
  }

  return new Response();
};
