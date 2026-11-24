
import {
  json,
  isSameOrigin
} from "../../_lib/response.js";

import {
  getSessionId,
  createSessionId,
  createSessionCookie,
  getStoredCartId,
  storeCartId,
  deleteStoredCartId
} from "../../_lib/session.js";

import {
  createShopifyCart,
  getShopifyCart,
  serializeCart
} from "../../_lib/shopify.js";

export async function onRequestGet(context) {
  try {
    const sessionId = getSessionId(context.request);

    if (!sessionId) {
      return json({ cart: null });
    }

    const cartId = await getStoredCartId(
      context.env,
      sessionId
    );

    if (!cartId) {
      return json({ cart: null });
    }

    const cart = await getShopifyCart(context, cartId);

    if (!cart) {
      await deleteStoredCartId(context.env, sessionId);
      return json({ cart: null });
    }

    return json({ cart: serializeCart(cart) });

  } catch (error) {
    console.error("GET /api/cart failed:", error);

    return json(
      { error: "Unable to retrieve your basket." },
      500
    );
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!isSameOrigin(request)) {
    return json({ error: "Invalid request origin." }, 403);
  }

  try {
    let sessionId = getSessionId(request);
    const isNewSession = !sessionId;

    if (!sessionId) {
      sessionId = createSessionId();
    }

    let cart = null;

    const savedCartId = await getStoredCartId(
      env,
      sessionId
    );

    // Restore the existing cart whenever possible.
    if (savedCartId) {
      cart = await getShopifyCart(
        context,
        savedCartId
      );
    }

    // Otherwise create a fresh empty cart.
    if (!cart) {
      cart = await createShopifyCart(context, []);

      await storeCartId(
        env,
        sessionId,
        cart.id
      );
    }

    const headers = {};

    if (isNewSession) {
      headers["Set-Cookie"] =
        createSessionCookie(sessionId);
    }

    return json(
      { cart: serializeCart(cart) },
      200,
      headers
    );

  } catch (error) {
    console.error("POST /api/cart failed:", error);

    return json(
      { error: "Unable to initialize your basket." },
      500
    );
  }
}
