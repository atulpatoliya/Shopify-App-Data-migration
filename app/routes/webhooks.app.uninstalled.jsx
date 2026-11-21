import { authenticate, sessionStorage } from "../shopify.server";
import { getSchedule, saveSchedule } from "../db.server";

export const action = async ({ request }) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhooks can be delivered more than once, so this must be safe to repeat.
  const sessions = await sessionStorage.findSessionsByShop(shop);
  if (sessions.length) {
    await sessionStorage.deleteSessions(sessions.map((s) => s.id));
  }

  // Stop scheduled exports; history and backups are removed on shop/redact (48h later).
  const schedule = await getSchedule(shop).catch(() => null);
  if (schedule?.enabled) await saveSchedule(shop, { ...schedule, enabled: false });

  return new Response();
};
