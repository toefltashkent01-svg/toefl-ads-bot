// Sales Automation Engine (../sales-engine) — same fire-and-forget discipline
// as identity-resolve.js in this same folder: a lead sharing their phone
// number must never fail or slow down because sales-engine is unreachable or
// not yet deployed. No-ops until SALES_ENGINE_URL and
// TOEFL_ADS_BOT_SALES_ENGINE_API_KEY are both set.
//
// sales-engine does its OWN identity resolution internally (it calls
// identity-service itself) — this bot never needs a personId, only the same
// raw phone/name/telegramId identity-resolve.js already sends. `adId`
// becomes sales-engine's `campaignId` (its own §4 source-attribution field),
// and `product` ('DET' | 'TOEFL', see models/Lead.js) picks the closest real
// product code from sales-engine's own src/config/products.ts.
//
// 🚨 Brand-separation note (see `../sales-engine/README.md`'s own callout):
// a lead captured here can land in the same sales-engine routing pool as
// Maktab's own DET-course leads. The owner's rule in
// `../maktab-english/PRODUCT-RULEBOOK.md` is that TOEFL Help and Maktab must
// never share a phone/channel/rep — sales-engine itself does not enforce
// this, so whoever staffs `ROUTING_OWNER_POOLS` must keep this bot's leads
// routed to people who are not also working Maktab's own DET-course pool.
const CAPTURE_TIMEOUT_MS = 10_000;

function configured() {
  return !!(process.env.SALES_ENGINE_URL && process.env.TOEFL_ADS_BOT_SALES_ENGINE_API_KEY);
}

function productInterestFor(product) {
  return product === 'DET' ? 'DET_HELP' : 'TOEFL_HELP';
}

async function captureLead({ userId, fullName, phone, username, adId, product }) {
  if (!configured()) return;
  const base = process.env.SALES_ENGINE_URL.replace(/\/+$/, '');
  try {
    const res = await fetch(`${base}/leads`, {
      method: 'POST',
      headers: {
        'x-api-key': process.env.TOEFL_ADS_BOT_SALES_ENGINE_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: fullName,
        phone,
        telegramId: String(userId),
        source: 'toefl-ads-bot',
        campaignId: adId || undefined,
        productInterest: productInterestFor(product),
      }),
      signal: AbortSignal.timeout(CAPTURE_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`sales-engine lead capture returned HTTP ${res.status} for lead ${userId}`);
    }
  } catch (err) {
    console.warn(`sales-engine lead capture failed for ${userId}: ${err.message}`);
  }
}

module.exports = { captureLead, configured };
