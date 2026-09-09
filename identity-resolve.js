// Master Student Identity (../identity-service) — "one human = one permanent
// Person ID across every business-unit app". This bot is exactly the example
// in identity-service/README.md ("resolving a lead from a Telegram bot").
//
// FIRE-AND-FORGET, ALWAYS — same discipline as maktab-english's
// IdentityResolveService and toefl-test's resolveIdentityForSignup: a lead
// capturing their phone number must never fail or slow down because
// identity-service is unreachable or not yet deployed. No-ops until
// IDENTITY_SERVICE_URL and TOEFL_ADS_BOT_IDENTITY_API_KEY are both set.
const RESOLVE_TIMEOUT_MS = 10_000;

function configured() {
  return !!(process.env.IDENTITY_SERVICE_URL && process.env.TOEFL_ADS_BOT_IDENTITY_API_KEY);
}

async function resolveLead({ userId, fullName, phone, username }) {
  if (!configured()) return;
  const base = process.env.IDENTITY_SERVICE_URL.replace(/\/+$/, '');
  try {
    const res = await fetch(`${base}/identity/resolve`, {
      method: 'POST',
      headers: {
        'x-api-key': process.env.TOEFL_ADS_BOT_IDENTITY_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: fullName,
        phone,
        telegramId: String(userId),
        telegramUsername: username || undefined,
        verifiedPhone: false,
        externalId: String(userId),
        entityType: 'lead',
      }),
      signal: AbortSignal.timeout(RESOLVE_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`identity-service resolve returned HTTP ${res.status} for lead ${userId}`);
    }
  } catch (err) {
    console.warn(`identity-service resolve failed for lead ${userId}: ${err.message}`);
  }
}

module.exports = { resolveLead, configured };
