// Netlify serverless function — verifies a customer's Gumroad license key
// server-side, so the real check never ships to the browser (unlike a
// hardcoded password in the page's JS, which anyone can read via view-source).
//
// SETUP:
// 1. Done — Product ID below is wired to the "AI Stack Navigator & Prompt
//    Builder" Gumroad product (License key block added via Content > Insert
//    > License key).
// 2. Deploy this whole folder (index.html + netlify.toml + netlify/functions)
//    to Netlify via a connected account (Git, or `netlify deploy`) — Netlify's
//    anonymous drag-and-drop deploy does NOT run serverless functions, so this
//    piece needs a logged-in deploy. Ask me if you want help with that step.
//
// How it decides someone is a valid customer:
// - A MASTER_KEY (below) always gets you in instantly, no Gumroad check —
//   this is for you, the site owner, so you're never locked out of your own
//   tool. Keep this one private; don't share it with customers.
// - Otherwise, calls Gumroad's own /v2/licenses/verify endpoint with the key
//   they typed.
// - Rejects the key if Gumroad reports the purchase was refunded or
//   charged back (so a refund automatically revokes access on their next
//   monthly re-check).
// - Optionally caps how many different browsers/devices can activate the
//   same key (MAX_ACTIVATIONS below) as a soft limit on casual key-sharing —
//   Gumroad tracks a "uses" count per key when increment_uses_count=true.

const GUMROAD_PRODUCT_ID = "m1OGb-skLKID_mMk9irESQ==";
const MAX_ACTIVATIONS = 5; // generous room for one customer's own devices; raise/lower as you like

// Your personal bypass — type this into the gate instead of a license key.
// Change it to anything you like; it never touches Gumroad or counts against
// MAX_ACTIVATIONS.
const MASTER_KEY = "NG22-V0KZ-7RKY";

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

  if (GUMROAD_PRODUCT_ID === "REPLACE_WITH_YOUR_GUMROAD_PRODUCT_ID") {
    return {
      statusCode: 500,
      body: JSON.stringify({ valid: false, error: "Server not configured yet — set GUMROAD_PRODUCT_ID in verify-license.js" })
    };
  }

  try {
    const params = new URLSearchParams();
    params.append("product_id", GUMROAD_PRODUCT_ID);
    params.append("license_key", licenseKey);
    params.append("increment_uses_count", "true");

    const resp = await fetch("https://api.gumroad.com/v2/licenses/verify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString()
    });

    const data = await resp.json();

    if (!data.success || !data.purchase) {
      return { statusCode: 200, body: JSON.stringify({ valid: false, reason: "not_found" }) };
    }
    if (data.purchase.refunded || data.purchase.chargebacked) {
      return { statusCode: 200, body: JSON.stringify({ valid: false, reason: "refunded" }) };
    }
    if (typeof data.uses === "number" && data.uses > MAX_ACTIVATIONS) {
      return { statusCode: 200, body: JSON.stringify({ valid: false, reason: "too_many_devices" }) };
    }

    return { statusCode: 200, body: JSON.stringify({ valid: true }) };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ valid: false, error: "Verification service unavailable" }) };
  }
};
