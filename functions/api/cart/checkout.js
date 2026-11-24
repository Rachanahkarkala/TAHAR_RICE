
import { json, isSameOrigin } from "../../_lib/response.js";

import {
  getSessionId,
  getStoredCartId
} from "../../_lib/session.js";

import {
  getShopifyCheckoutUrl
} from "../../_lib/shopify.js";

export async function onRequestGet(context) {
  const { request, env } = context;

  // A normal browser navigation can omit Origin.
  // Reject it only when an Origin is supplied and is different.
  const origin = request.headers.get("Origin");

  if (origin && !isSameOrigin(request)) {
    return json({ error: "Invalid request origin." }, 403);
  }

  try {
    const sessionId = getSessionId(request);

    if (!sessionId) {
      return json(
        { error: "Your basket session has expired." },
        401
      );
    }

    const cartId = await getStoredCartId(env, sessionId);

    if (!cartId) {
      return json(
        { error: "Your basket is empty. Add products first." },
        400
      );
    }

    const checkoutUrl = await getShopifyCheckoutUrl(
      context,
      cartId
    );

    const destination = new URL(checkoutUrl);

    // Only accept HTTPS URLs returned by Shopify.
    if (destination.protocol !== "https:") {
      throw new Error("Invalid Shopify checkout URL.");
    }

    return new Response(null, {
      status: 303,
      headers: {
        Location: destination.href,
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer"
      }
    });

  } catch (error) {
    console.error("Shopify checkout redirect failed:", error);

    return json(
      { error: "Unable to open checkout. Please try again." },
      502
    );
  }
}
