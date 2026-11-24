
/*
 * TAHAR — Shopify Storefront API
 * Browser-side integration layer
 *
 * Uses the PUBLIC Storefront API token.
 * NEVER place the private token in frontend code.
 */

(function () {
  "use strict";

  // ==========================================
  // CONFIGURATION
  // ==========================================

  const CONFIG = Object.freeze({
    domain: "j03zst-qv.myshopify.com",
    publicToken: "edd76fceff24823842303c7238488c03",
    apiVersion: "2026-10"
  });

  const endpoint =
    `https://${CONFIG.domain}/api/${CONFIG.apiVersion}/graphql.json`;


  // ==========================================
  // GRAPHQL REQUEST HANDLER
  // ==========================================

  async function request(query, variables = {}) {
    if (
      !CONFIG.publicToken ||
      CONFIG.publicToken === "PASTE_YOUR_EXISTING_PUBLIC_TOKEN_HERE"
    ) {
      throw new Error(
        "Shopify public access token is not configured."
      );
    }

    if (typeof query !== "string" || !query.trim()) {
      throw new Error("A valid GraphQL query is required.");
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Storefront-Access-Token": CONFIG.publicToken
      },
      body: JSON.stringify({
        query,
        variables
      })
    });

    let result;

    try {
      result = await response.json();
    } catch {
      throw new Error(
        `Invalid Shopify response. HTTP ${response.status}`
      );
    }

    if (!response.ok || result.errors?.length) {
      const details = (result.errors || [])
        .map(error => error.message)
        .join("; ");

      throw new Error(
        details || `Shopify API failed. HTTP ${response.status}`
      );
    }

    if (!result.data) {
      throw new Error("Shopify returned no GraphQL data.");
    }

    return result.data;
  }


  // ==========================================
  // FETCH SHOPIFY PRODUCTS
  // ==========================================

  async function getProducts(first = 50) {
    const safeFirst = Math.max(
      1,
      Math.min(Number(first) || 50, 250)
    );

    const query = `
      query GetProducts($first: Int!) {
        products(first: $first) {
          nodes {
            id
            title
            handle
            descriptionHtml

            featuredImage {
              url
              altText
            }

            variants(first: 100) {
              nodes {
                id
                title
                sku
                availableForSale

                price {
                  amount
                  currencyCode
                }

                selectedOptions {
                  name
                  value
                }
              }
            }
          }
        }
      }
    `;

    const data = await request(query, {
      first: safeFirst
    });

    return data.products?.nodes || [];
  }


  // ==========================================
  // NORMALIZE PRODUCT / VARIANT NAMES
  // ==========================================

  function normalizeName(value) {
    return String(value ?? "")
      .normalize("NFKC")
      .replace(/^TAHAR\s+/i, "")
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
  }


  // ==========================================
  // GET VARIANT PACK SIZE
  // ==========================================

  function getVariantSize(variant) {
    const sizeOption = (variant.selectedOptions || []).find(
      option => /pack\s*size|size|weight/i.test(option.name || "")
    );

    return String(
      sizeOption?.value || variant.title || ""
    ).trim();
  }


  // ==========================================
  // MAP SHOPIFY PRODUCTS TO TAHAR PRODUCTS
  // ==========================================

  async function syncProducts(
    localProducts = window.TAHAR_PRODUCTS
  ) {
    if (
      !Array.isArray(localProducts) ||
      localProducts.length === 0
    ) {
      throw new Error(
        "Local products not found. Make sure products.js loads before shopify.js."
      );
    }

    const remoteProducts = await getProducts(50);

    // Create a lookup using normalized product names.
    const remoteByName = new Map(
      remoteProducts.map(product => [
        normalizeName(product.title),
        product
      ])
    );

    const problems = [];

    const mappedProducts = localProducts.map(localProduct => {
      if (
        !localProduct ||
        !localProduct.name ||
        !Array.isArray(localProduct.sizes)
      ) {
        problems.push(
          "A local product is missing its name or sizes."
        );

        return localProduct;
      }

      // Match local product to Shopify product.
      const remoteProduct = remoteByName.get(
        normalizeName(localProduct.name)
      );

      if (!remoteProduct) {
        problems.push(
          `Product not found in Shopify: ${localProduct.name}`
        );

        return localProduct;
      }

      const remoteVariants =
        remoteProduct.variants?.nodes || [];

      // Match each pack size to its Shopify variant.
      const mappedSizes = localProduct.sizes.map(localSize => {

        const remoteVariant = remoteVariants.find(variant => {
          return (
            normalizeName(getVariantSize(variant)) ===
            normalizeName(localSize.size)
          );
        });

        if (!remoteVariant) {
          problems.push(
            `${localProduct.name}: variant not found for ${localSize.size}`
          );

          return localSize;
        }

        return {
          ...localSize,

          // Shopify becomes the source of truth.
          price: Number(remoteVariant.price.amount),

          // Shopify variant information.
          currencyCode: remoteVariant.price.currencyCode,
          shopifyVariantId: remoteVariant.id,
          availableForSale: Boolean(
            remoteVariant.availableForSale
          ),
          sku: remoteVariant.sku || ""
        };
      });

      return {
        ...localProduct,

        // Shopify product identifiers.
        shopifyProductId: remoteProduct.id,
        shopifyHandle: remoteProduct.handle,

        // Preserve existing local content.
        descriptionHtml: remoteProduct.descriptionHtml || "",

        // Use Shopify image when available;
        // otherwise retain the supplied Tahar image.
        image:
          remoteProduct.featuredImage?.url ||
          localProduct.image ||
          "",

        sizes: mappedSizes
      };
    });

    // Prevent incomplete mappings from being used.
    if (problems.length > 0) {
      throw new Error(
        "Shopify product mapping incomplete:\n- " +
        problems.join("\n- ")
      );
    }

    return mappedProducts;
  }




// ==========================================
// SHOPIFY CART API
// ==========================================

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

function handleCartPayload(payload, operation) {
  const errors = payload?.userErrors || [];

  if (errors.length) {
    throw new Error(
      `${operation}: ` +
      errors.map(error => error.message).join("; ")
    );
  }

  if (!payload?.cart) {
    throw new Error(`${operation}: Shopify returned no cart.`);
  }

  return payload.cart;
}


// Create a new Shopify cart.
async function createCart(lines = []) {
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

  const data = await request(query, {
    input: { lines }
  });

  return handleCartPayload(data.cartCreate, "Cart creation");
}


// Retrieve an existing cart.
async function getCart(cartId) {
  const query = `
    query GetTaharCart($id: ID!) {
      cart(id: $id) {
        ${CART_FIELDS}
      }
    }
  `;

  const data = await request(query, { id: cartId });

  return data.cart || null;
}


// Add variants to a cart.
async function addCartLines(cartId, lines) {
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

  const data = await request(query, {
    cartId,
    lines
  });

  return handleCartPayload(
    data.cartLinesAdd,
    "Adding cart items"
  );
}


// Update quantities in a cart.
async function updateCartLines(cartId, lines) {
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

  const data = await request(query, {
    cartId,
    lines
  });

  return handleCartPayload(
    data.cartLinesUpdate,
    "Updating cart quantities"
  );
}


// Remove items from a cart.
async function removeCartLines(cartId, lineIds) {
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

  const data = await request(query, {
    cartId,
    lineIds
  });

  return handleCartPayload(
    data.cartLinesRemove,
    "Removing cart items"
  );
}




  // ==========================================
  // PUBLIC TAHAR SHOPIFY API
  // ==========================================

  window.TaharShopify = Object.freeze({
  request,
  getProducts,
  syncProducts,

  createCart,
  getCart,
  addCartLines,
  updateCartLines,
  removeCartLines
});

})();
