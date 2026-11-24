
const SHOP_DOMAIN = "j03zst-qv.myshopify.com";
const API_VERSION = "2026-10";

const CART_FIELDS = `
  id
  totalQuantity
  checkoutUrl

  lines(first: 100) {
    nodes {
      id
      quantity

      cost {
        amountPerQuantity {
          amount
          currencyCode
        }
        totalAmount {
          amount
          currencyCode
        }
      }

      merchandise {
        ... on ProductVariant {
          id
          title

          selectedOptions {
            name
            value
          }

          product {
            title
            handle

            featuredImage {
              url
              altText
            }
          }
        }
      }
    }
  }

  cost {
    subtotalAmount {
      amount
      currencyCode
    }

    totalAmount {
      amount
      currencyCode
    }
  }
`;

async function shopifyRequest(context, query, variables = {}) {
  const token = context.env.SHOPIFY_STOREFRONT_PRIVATE_TOKEN;

  if (!token) {
    throw new Error("Shopify private token is missing.");
  }

  const endpoint =
    `https://${SHOP_DOMAIN}/api/${API_VERSION}/graphql.json`;

  const headers = {
    "Content-Type": "application/json",
    "Shopify-Storefront-Private-Token": token
  };

  // Forward the Cloudflare-provided buyer IP.
  const buyerIP =
    context.request.headers.get("cf-connecting-ip");

  if (buyerIP) {
    headers["Shopify-Storefront-Buyer-IP"] = buyerIP;
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables })
  });

  let result;

  try {
    result = await response.json();
  } catch {
    throw new Error("Invalid response from Shopify.");
  }

  if (!response.ok || result.errors?.length) {
    console.error(
      "Shopify API error:",
      result.errors || response.status
    );

    throw new Error("Shopify API request failed.");
  }

  if (!result.data) {
    throw new Error("Shopify returned no data.");
  }

  return result.data;
}

function checkCartPayload(payload, operation) {
  if (payload?.userErrors?.length) {
    console.error(
      `${operation} errors:`,
      payload.userErrors
    );

    throw new Error(`${operation} failed.`);
  }

  if (!payload?.cart) {
    throw new Error(`${operation} returned no cart.`);
  }

  return payload.cart;
}

// Create a Shopify cart.
export async function createShopifyCart(context, lines = []) {
  const query = `
    mutation CreateTaharCart($input: CartInput!) {
      cartCreate(input: $input) {
        cart {
          ${CART_FIELDS}
        }

        userErrors {
          field
          message
        }
      }
    }
  `;

  const data = await shopifyRequest(
    context,
    query,
    { input: { lines } }
  );

  return checkCartPayload(
    data.cartCreate,
    "Cart creation"
  );
}

// Get an existing cart.
export async function getShopifyCart(context, cartId) {
  const query = `
    query GetTaharCart($id: ID!) {
      cart(id: $id) {
        ${CART_FIELDS}
      }
    }
  `;

  const data = await shopifyRequest(
    context,
    query,
    { id: cartId }
  );

  return data.cart || null;
}

// Add product variants.
export async function addShopifyCartLines(
  context,
  cartId,
  lines
) {
  const query = `
    mutation AddTaharCartLines(
      $cartId: ID!,
      $lines: [CartLineInput!]!
    ) {
      cartLinesAdd(
        cartId: $cartId,
        lines: $lines
      ) {
        cart {
          ${CART_FIELDS}
        }

        userErrors {
          field
          message
        }
      }
    }
  `;

  const data = await shopifyRequest(
    context,
    query,
    { cartId, lines }
  );

  return checkCartPayload(
    data.cartLinesAdd,
    "Adding cart items"
  );
}

// Update quantities.
export async function updateShopifyCartLines(
  context,
  cartId,
  lines
) {
  const query = `
    mutation UpdateTaharCartLines(
      $cartId: ID!,
      $lines: [CartLineUpdateInput!]!
    ) {
      cartLinesUpdate(
        cartId: $cartId,
        lines: $lines
      ) {
        cart {
          ${CART_FIELDS}
        }

        userErrors {
          field
          message
        }
      }
    }
  `;

  const data = await shopifyRequest(
    context,
    query,
    { cartId, lines }
  );

  return checkCartPayload(
    data.cartLinesUpdate,
    "Updating cart items"
  );
}

// Remove cart lines.
export async function removeShopifyCartLines(
  context,
  cartId,
  lineIds
) {
  const query = `
    mutation RemoveTaharCartLines(
      $cartId: ID!,
      $lineIds: [ID!]!
    ) {
      cartLinesRemove(
        cartId: $cartId,
        lineIds: $lineIds
      ) {
        cart {
          ${CART_FIELDS}
        }

        userErrors {
          field
          message
        }
      }
    }
  `;

  const data = await shopifyRequest(
    context,
    query,
    { cartId, lineIds }
  );

  return checkCartPayload(
    data.cartLinesRemove,
    "Removing cart items"
  );
}

// Return only safe cart data to the browser.
// The actual Shopify Cart ID is deliberately excluded.
export function serializeCart(cart) {
  if (!cart) return null;

  return {
    totalQuantity: cart.totalQuantity,

    lines: {
      nodes: (cart.lines?.nodes || []).map(line => ({
        id: line.id,
        quantity: line.quantity,
        cost: line.cost,

        merchandise: line.merchandise
          ? {
              id: line.merchandise.id,
              title: line.merchandise.title,
              selectedOptions:
                line.merchandise.selectedOptions || [],

              product: line.merchandise.product
                ? {
                    title: line.merchandise.product.title,
                    handle: line.merchandise.product.handle,
                    featuredImage:
                      line.merchandise.product.featuredImage
                  }
                : null
            }
          : null
      }))
    },

    cost: cart.cost
  };
}

// Checkout URL stays server-side until the redirect.
export async function getShopifyCheckoutUrl(context, cartId) {
  const cart = await getShopifyCart(context, cartId);

  if (!cart || !cart.totalQuantity) {
    throw new Error("Your cart is empty.");
  }

  return cart.checkoutUrl;
}
