// Netlify serverless function — verifies a customer's Gumroad license key
// server-side, so the real check never ships to the browser (unlike a
// hardcoded password in the page's JS, which anyone can read via view-source).
//
// This checks a key against TWO Gumroad products — the one-time purchase and
// the monthly membership — since a customer could have bought either one.
//
// SETUP:
// Both Product IDs below are already wired to their Gumroad products
// (License key block added via Content > Insert > License key on each).
//
// How it decides someone is a valid customer:
// - A MASTER_KEY (below) always gets you in instantly, no Gumroad check —
//   this is for you, the site owner, so you're never locked out of your own
//   tool. Keep this one private; don't share it with customers.
// - Otherwise, tries the key against the one-time product first, then the
//   membership product, using Gumroad's /v2/licenses/verify endpoint.
// - One-time purchases: rejected if refunded or charged back.
// - Membership purchases: rejected if refunded/charged back, OR if the
//   subscription has ended, been cancelled, or failed to renew — so a
//   lapsed subscriber loses access on their next monthly re-check, same as
//   a real subscription should work.
// - Optionally caps how many different browsers/devices can activate the
//   same key (MAX_ACTIVATIONS below) as a soft limit on casual key-sharing —
//   Gumroad tracks a "uses" count per key when increment_uses_count=true.

const ONE_TIME_PRODUCT_ID = "m1OGb-skLKID_mMk9irESQ=="; // $20 one-time purchase
const MEMBERSHIP_PRODUCT_ID = "QbZs4V38oeaEkfLBCYnPGg=="; // $15/month membership
const MAX_ACTIVATIONS = 5; // generous room for one customer's own devices; raise/lower as you like

// Your personal bypass — type this into the gate instead of a license key.
// Change it to anything you like; it never touches Gumroad or counts against
// MAX_ACTIVATIONS.
const MASTER_KEY = "NG22-V0KZ-7RKY";

async function verifyAgainstProduct(productId, licenseKey) {
  const params = new URLSearchParams();
  params.append("product_id", productId);
  params.append("license_key", licenseKey);
  params.append("increment_uses_count", "true");

  const resp = await fetch("https://api.gumroad.com/v2/licenses/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString()
  });

  const data = await resp.json();

  if (!data.success || !data.purchase) {
    return { matched: false };
  }
  if (data.purchase.refunded || data.purchase.chargebacked) {
    return { matched: true, valid: false, reason: "refunded" };
  }
  if (
    data.purchase.subscription_ended_at ||
    data.purchase.subscription_cancelled_at ||
    data.purchase.subscription_failed_at
  ) {
    return { matched: true, valid: false, reason: "subscription_lapsed" };
  }
  if (typeof data.uses === "number" && data.uses > MAX_ACTIVATIONS) {
    return { matched: true, valid: false, reason: "too_many_devices" };
  }

  return { matched: true, valid: true };
}

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ valid: false, error: "Method not allowed" }) };
  }

  let licenseKey = "";
  try {
    const body = JSON.parse(event.body || "{}");
    licenseKey = (body.licenseKey || "").trim();
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ valid: false, error: "Bad request" }) };
  }

  if (!licenseKey) {
    return { statusCode: 400, body: JSON.stringify({ valid: false, error: "No license key provided" }) };
  }

  if (licenseKey === MASTER_KEY) {
    return { statusCode: 200, body: JSON.stringify({ valid: true }) };
  }

  try {
    const oneTime = await verifyAgainstProduct(ONE_TIME_PRODUCT_ID, licenseKey);
    if (oneTime.matched) {
      return { statusCode: 200, body: JSON.stringify({ valid: oneTime.valid, reason: oneTime.reason }) };
    }

    const membership = await verifyAgainstProduct(MEMBERSHIP_PRODUCT_ID, licenseKey);
    if (membership.matched) {
      return { statusCode: 200, body: JSON.stringify({ valid: membership.valid, reason: membership.reason }) };
    }

    return { statusCode: 200, body: JSON.stringify({ valid: false, reason: "not_found" }) };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ valid: false, error: "Verification service unavailable" }) };
  }
};
