
import {
  json,
  isSameOrigin,
  parseJson
} from "../../_lib/response.js";

import {
  getSessionId,
  getStoredCartId
} from "../../_lib/session.js";

import {
  addShopifyCartLines,
  updateShopifyCartLines,
  removeShopifyCartLines,
  serializeCart
} from "../../_lib/shopify.js";

async function getCurrentCart(context) {
  const sessionId = getSessionId(context.request);

  if (!sessionId) {
    const error = new Error("Cart session not found.");
    error.status = 401;
    throw error;
  }

  const cartId = await getStoredCartId(
    context.env,
    sessionId
  );

  if (!cartId) {
    const error = new Error("Cart not found.");
    error.status = 404;
    throw error;
  }

  return cartId;
}

function validLineId(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512
  );
}

async function handleError(error, operation) {
  console.error(`${operation} failed:`, error);

  return json(
    {
      error:
        error.status === 401
          ? "Your basket session has expired. Refresh the page."
          : error.status === 404
            ? "Basket not found. Please refresh."
            : "Unable to update your basket. Please try again."
    },
    error.status || 502
  );
}


// ==========================================
// ADD CART LINE
// POST /api/cart/lines
// ==========================================

export async function onRequestPost(context) {
  const { request } = context;

  if (!isSameOrigin(request)) {
    return json({ error: "Invalid request origin." }, 403);
  }

  try {
    const body = await parseJson(request);

    const { variantId, quantity = 1 } = body;

    if (
      typeof variantId !== "string" ||
      !/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(variantId)
    ) {
      return json({ error: "Invalid product variant." }, 400);
    }

    if (
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 20
    ) {
      return json({ error: "Invalid quantity." }, 400);
    }

    const cartId = await getCurrentCart(context);

    const updatedCart = await addShopifyCartLines(
      context,
      cartId,
      [{
        merchandiseId: variantId,
        quantity
      }]
    );

    return json({
      cart: serializeCart(updatedCart)
    });

  } catch (error) {
    return handleError(error, "Adding cart line");
  }
}


// ==========================================
// UPDATE CART LINE
// PATCH /api/cart/lines
// ==========================================

export async function onRequestPatch(context) {
  const { request } = context;

  if (!isSameOrigin(request)) {
    return json({ error: "Invalid request origin." }, 403);
  }

  try {
    const body = await parseJson(request);

    const { lineId, quantity } = body;

    if (!validLineId(lineId)) {
      return json({ error: "Invalid cart line." }, 400);
    }

    if (
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 99
    ) {
      return json({ error: "Invalid quantity." }, 400);
    }

    const cartId = await getCurrentCart(context);

    const updatedCart = await updateShopifyCartLines(
      context,
      cartId,
      [{
        id: lineId,
        quantity
      }]
    );

    return json({
      cart: serializeCart(updatedCart)
    });

  } catch (error) {
    return handleError(error, "Updating cart line");
  }
}


// ==========================================
// REMOVE CART LINE
// DELETE /api/cart/lines
// ==========================================

export async function onRequestDelete(context) {
  const { request } = context;

  if (!isSameOrigin(request)) {
    return json({ error: "Invalid request origin." }, 403);
  }

  try {
    const body = await parseJson(request);

    const { lineId } = body;

    if (!validLineId(lineId)) {
      return json({ error: "Invalid cart line." }, 400);
    }

    const cartId = await getCurrentCart(context);

    const updatedCart = await removeShopifyCartLines(
      context,
      cartId,
      [lineId]
    );

    return json({
      cart: serializeCart(updatedCart)
    });

  } catch (error) {
    return handleError(error, "Removing cart line");
  }
}
