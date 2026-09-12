// Content Intelligence Engine (../content-intelligence-engine) — the actual
// ad-click/DM-start moment, recorded as a person-level ContentTouch instead
// of relying only on ../sales-engine's later campaign-level match (§10 of
// that service's own plan: a real touch gets DIRECT attribution confidence,
// a campaign-tag-only match gets the weaker ATTRIBUTED). Same fire-and-forget
// discipline as identity-resolve.js/sales-engine.js in this same folder — a
// user starting the bot must never fail or slow down because
// content-intelligence-engine is unreachable or not yet deployed. No-ops
// until CONTENT_INTELLIGENCE_ENGINE_URL and
// TOEFL_ADS_BOT_CONTENT_INTELLIGENCE_API_KEY are both set.
const TOUCH_TIMEOUT_MS = 10_000;

function configured() {
  return !!(process.env.CONTENT_INTELLIGENCE_ENGINE_URL && process.env.TOEFL_ADS_BOT_CONTENT_INTELLIGENCE_API_KEY);
}

// Starting the bot via an ad deep link is this bot's own closest equivalent
// of "clicked through and opened a DM" — recorded as DM_STARTED, the same
// touch type a real Telegram DM start would get.
async function recordTouch({ userId, fullName, adId }) {
  if (!configured() || !adId) return; // no campaign tag, nothing to attribute a touch to
  const base = process.env.CONTENT_INTELLIGENCE_ENGINE_URL.replace(/\/+$/, '');
  try {
    const res = await fetch(`${base}/touches`, {
      method: 'POST',
      headers: {
        'x-api-key': process.env.TOEFL_ADS_BOT_CONTENT_INTELLIGENCE_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: fullName,
        telegramId: String(userId),
        campaignId: adId,
        touchType: 'DM_STARTED',
        source: 'toefl-ads-bot',
      }),
      signal: AbortSignal.timeout(TOUCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`content-intelligence-engine touch failed HTTP ${res.status} for lead ${userId}`);
    }
  } catch (err) {
    console.warn(`content-intelligence-engine touch failed for ${userId}: ${err.message}`);
  }
}

module.exports = { recordTouch, configured };
