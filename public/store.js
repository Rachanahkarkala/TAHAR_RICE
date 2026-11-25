
document.documentElement.classList.add("js");

// ==========================================
// SCROLL HEADER & REVEAL ANIMATIONS
// ==========================================

document.addEventListener("DOMContentLoaded", function () {
  var header = document.querySelector(".site-header");

  if (header) {
    var onScroll = function () {
      header.classList.toggle("is-scrolled", window.scrollY > 8);
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  var items = document.querySelectorAll("[data-reveal]");

  if (!("IntersectionObserver" in window)) {
    items.forEach(function (el) {
      el.classList.add("visible");
    });
    return;
  }

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
        io.unobserve(entry.target);
      }
    });
  }, {
    threshold: 0.12,
    rootMargin: "0px 0px -6% 0px"
  });

  items.forEach(function (el) {
    io.observe(el);
  });
});


// ==========================================
// MAIN TAHAR STORE
// ==========================================

function createTaharStore() {
  return {
    products: window.TAHAR_PRODUCTS || [],

    cart: [],
    cartOpen: false,
    menuOpen: false,

    toast: "",
    toastTimer: null,

    selectedSizes: {},

    productsLoading: true,
    shopifyReady: false,
    shopifyError: "",

    shopifyCart: null,
    shopifyCartId: null,
    shopifyCartReady: false,
    cartBusy: false,
    checkoutBusy: false,

    // Live stock availability refresh.
    availabilityRefreshTimer: null,
    availabilityRefreshHandler: null,
    availabilityRefreshInFlight: false,

    // ========================================
    // CART COMPUTED VALUES
    // ========================================

    get cartCount() {
      return this.cart.reduce(function (total, item) {
        return total + item.qty;
      }, 0);
    },

    get subtotal() {
      return this.cart.reduce(function (total, item) {
        return total + item.qty * item.price;
      }, 0);
    },


    // ========================================
    // PRODUCT COMPUTED VALUES
    // ========================================

    get heroProduct() {
      return this.products.find(function (product) {
        return product.id === "premium";
      }) || this.products[0];
    },

    get loopProducts() {
      return this.products.concat(this.products);
    },

    get featuredProducts() {
      return this.products.filter(function (product) {
        return [
          "premium",
          "traditional",
          "everyday",
          "moti-mogra"
        ].includes(product.id);
      });
    },


    // ========================================
    // INITIALIZATION
    // ========================================

    async init() {
      this.setDefaultSelections();

      await this.loadShopifyProducts();

      if (this.shopifyReady) {
        await this.initShopifyCart();
      }
    },


    // ========================================
    // DEFAULT PRODUCT SELECTIONS
    // ========================================

    setDefaultSelections() {
      this.products.forEach((product) => {
        if (!product.sizes || !product.sizes.length) return;

        var current = this.selectedSizes[product.id];
        var currentVariant = product.sizes.find(function (size) {
          return size.size === current;
        });

        // Keep the current selection when it is available.
        // Otherwise choose the first available pack size.
        if (!currentVariant || currentVariant.availableForSale !== true) {
          var firstAvailable = product.sizes.find(function (size) {
            return size.availableForSale === true;
          });

          this.selectedSizes[product.id] =
            (firstAvailable || product.sizes[0]).size;
        }
      });
    },


    // ========================================
    // SHOPIFY PRODUCT SYNCHRONIZATION
    // ========================================

    async loadShopifyProducts() {
      this.productsLoading = true;
      this.shopifyReady = false;
      this.shopifyError = "";

      try {
        if (
          !window.TaharShopify ||
          typeof window.TaharShopify.syncProducts !== "function"
        ) {
          throw new Error(
            "Shopify integration is not loaded. Check script order."
          );
        }

        var syncedProducts =
          await window.TaharShopify.syncProducts(this.products);

        if (
          !Array.isArray(syncedProducts) ||
          syncedProducts.length !== this.products.length
        ) {
          throw new Error(
            "Shopify returned an incomplete product catalogue."
          );
        }

        this.products = syncedProducts;
        this.shopifyReady = true;

        this.setDefaultSelections();
        this.startAvailabilityRefresh();

        console.info(
          "Tahar catalogue synced with Shopify:",
          this.products.length,
          "products"
        );

      } catch (error) {
        this.shopifyError =
          error && error.message
            ? error.message
            : String(error);

        console.error(
          "Tahar Shopify catalogue sync failed:",
          error
        );

        this.notify(
          "Products could not sync with Shopify. Please refresh before ordering."
        );

      } finally {
        this.productsLoading = false;
      }
    },


    // ========================================
    // LIVE SHOPIFY STOCK AVAILABILITY
    // ========================================

    isAvailable(product, size) {
      var variant = product && product.sizes && product.sizes.find(function (item) {
        return item.size === size;
      });

      return Boolean(variant && variant.availableForSale === true);
    },

    startAvailabilityRefresh() {
      if (this.availabilityRefreshTimer) {
        clearInterval(this.availabilityRefreshTimer);
      }

      if (this.availabilityRefreshHandler) {
        document.removeEventListener(
          "visibilitychange",
          this.availabilityRefreshHandler
        );
      }

      this.availabilityRefreshHandler = () => {
        if (!document.hidden) {
          this.refreshShopifyAvailability();
        }
      };

      document.addEventListener(
        "visibilitychange",
        this.availabilityRefreshHandler
      );

      // Refresh every two minutes while the page is open.
      // Also refresh as soon as the customer returns to the tab.
      this.availabilityRefreshTimer = setInterval(() => {
        if (!document.hidden) {
          this.refreshShopifyAvailability();
        }
      }, 120000);
    },

    async refreshShopifyAvailability() {
      if (
        !this.shopifyReady ||
        this.availabilityRefreshInFlight ||
        !window.TaharShopify ||
        typeof window.TaharShopify.syncProducts !== "function"
      ) {
        return;
      }

      this.availabilityRefreshInFlight = true;

      try {
        var currentProductId = this.product ? this.product.id : null;
        var currentDetailSize = this.selectedSize || "";

        var refreshedProducts = await window.TaharShopify.syncProducts(
          this.products
        );

        if (
          !Array.isArray(refreshedProducts) ||
          refreshedProducts.length !== this.products.length
        ) {
          throw new Error("Shopify returned an incomplete stock update.");
        }

        this.products = refreshedProducts;
        this.setDefaultSelections();

        // Product detail pages hold a separate selected product reference.
        // Refresh that reference too, so stock changes appear without reloading.
        if (currentProductId) {
          this.product = this.products.find(function (product) {
            return product.id === currentProductId;
          }) || this.products[0];

          var selectedVariant = this.product && this.product.sizes.find(
            (size) => size.size === currentDetailSize
          );

          if (!selectedVariant || selectedVariant.availableForSale !== true) {
            var nextAvailable = this.product && this.product.sizes.find(
              function (size) {
                return size.availableForSale === true;
              }
            );

            this.selectedSize =
              (nextAvailable || (this.product && this.product.sizes[0]))?.size || "";
          }
        }

        console.info("Tahar stock availability refreshed from Shopify.");

      } catch (error) {
        // Keep the last known stock state if a temporary refresh fails.
        console.warn("Shopify availability refresh failed:", error);

      } finally {
        this.availabilityRefreshInFlight = false;
      }
    },


    // ========================================
    // INITIALIZE / RESTORE SHOPIFY CART
    // ========================================

    
async cartRequest(path, method = "GET", body = null) {
  const options = {
    method,
    credentials: "same-origin",
    headers: {}
  };

  if (body !== null) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }

  const response = await fetch(path, options);

  let result;

  try {
    result = await response.json();
  } catch {
    throw new Error("Cloudflare returned an invalid response.");
  }

  if (!response.ok) {
    throw new Error(
      result.error || `Cart request failed: ${response.status}`
    );
  }

  return result;
},

async initShopifyCart() {
  try {
    // Retrieve the cart associated with the secure session cookie.
    let result = await this.cartRequest("/api/cart");

    // Create a cart if this browser has no existing session.
    if (!result.cart) {
      result = await this.cartRequest(
        "/api/cart",
        "POST",
        {}
      );
    }

    if (!result.cart) {
      throw new Error("Shopify cart could not be initialized.");
    }

    this.applyShopifyCart(result.cart);
    this.shopifyCartReady = true;

    console.info("Secure Shopify cart initialized.");

  } catch (error) {
    this.shopifyCartReady = false;
    console.error("Secure cart initialization failed:", error);

    this.notify(
      "Unable to load your basket. Please refresh."
    );
  }
},



    // ========================================
    // APPLY SHOPIFY CART TO FRONTEND
    // ========================================

    
applyShopifyCart(remoteCart) {
  if (!remoteCart) {
    throw new Error("Invalid cart response.");
  }

  // No Shopify Cart ID is stored in browser JavaScript.
  this.shopifyCart = remoteCart;
  this.shopifyCartId = null;

  const lines = remoteCart.lines?.nodes || [];

  this.cart = lines.map(line => {
    const merchandise = line.merchandise || {};
    const remoteProduct = merchandise.product || {};

    const product = this.products.find(p =>
      p.sizes.some(
        s => s.shopifyVariantId === merchandise.id
      )
    );

    const variant = product?.sizes.find(
      s => s.shopifyVariantId === merchandise.id
    );

    const sizeOption = merchandise.selectedOptions?.find(
      option => /pack\s*size|size|weight/i.test(option.name)
    );

    return {
      key: line.id,
      lineId: line.id,
      shopifyVariantId: merchandise.id,
      id: product?.id || "",
      name: product?.name || remoteProduct.title || "Tahar product",
      size: variant?.size || sizeOption?.value || merchandise.title,
      price: Number(line.cost.amountPerQuantity.amount),
      image:
        product?.image ||
        remoteProduct.featuredImage?.url ||
        "",
      qty: line.quantity
    };
  });
},



    // ========================================
    // SAVE SHOPIFY CART ID
    // ========================================

    save() {
  // Shopify cart contents and the actual Cart ID
  // are stored securely on the Cloudflare backend.
  // The browser uses only the HttpOnly session cookie.
},


    // ========================================
    // FORMAT PRICE
    // ========================================

    money(amount) {
      return "₹" +
        Number(amount).toLocaleString("en-IN");
    },


    // ========================================
    // SELECTED PRODUCT PRICE
    // ========================================

    priceFor(product) {
      if (
        !product ||
        !Array.isArray(product.sizes) ||
        !product.sizes.length
      ) {
        return 0;
      }

      var selected = product.sizes.find((variant) => {
        return variant.size ===
          this.selectedSizes[product.id];

      }) || product.sizes[0];

      return selected.price;
    },


    // ========================================
    // TOAST NOTIFICATIONS
    // ========================================

    notify(message) {
      this.toast = message;

      clearTimeout(this.toastTimer);

      this.toastTimer = setTimeout(() => {
        this.toast = "";
      }, 2600);
    },


    // ========================================
    // OPEN BASKET
    // ========================================

    openCart() {
      this.cartOpen = true;
      this.menuOpen = false;
    },



async checkout() {
  if (!this.shopifyCartReady) {
    this.notify("Your basket is still connecting. Please try again.");
    return;
  }

  if (!this.cart.length) {
    this.notify("Your basket is empty.");
    return;
  }

  if (this.cartBusy || this.checkoutBusy) return;

  this.checkoutBusy = true;

  // Cloudflare retrieves the secret cart ID server-side
  // and redirects the customer to Shopify Checkout.
  window.location.assign("/api/cart/checkout");
},


    // ========================================
    // ADD PRODUCT TO SHOPIFY CART
    // ========================================

    
async add(product, size, quantity = 1) {
  if (!this.shopifyReady || !this.shopifyCartReady) {
    this.notify("Your basket is still connecting. Please try again.");
    return false;
  }

  if (this.cartBusy) return false;

  const selected = product?.sizes.find(
    variant => variant.size === size
  );

  if (!selected?.shopifyVariantId) {
    this.notify("This pack is not connected to Shopify.");
    return false;
  }

  if (!selected.availableForSale) {
    this.notify("This pack is currently unavailable.");
    return false;
  }

  this.cartBusy = true;

  try {
    const result = await this.cartRequest(
      "/api/cart/lines",
      "POST",
      {
        variantId: selected.shopifyVariantId,
        quantity: Math.min(
          20,
          Math.max(1, Math.floor(Number(quantity) || 1))
        )
      }
    );

    this.applyShopifyCart(result.cart);

    this.notify(product.name + " added to your basket");
    return true;

  } catch (error) {
    console.error("Secure add-to-cart failed:", error);
    this.notify(error.message || "Could not add this product.");
    return false;

  } finally {
    this.cartBusy = false;
  }
},


    // ========================================
    // UPDATE CART QUANTITY
    // ========================================

    
async changeQty(key, delta) {
  if (this.cartBusy || !this.shopifyCartReady) return;

  const item = this.cart.find(i => i.key === key);
  if (!item) return;

  const newQuantity = item.qty + delta;

  this.cartBusy = true;

  try {
    let result;

    if (newQuantity <= 0) {
      result = await this.cartRequest(
        "/api/cart/lines",
        "DELETE",
        { lineId: item.lineId }
      );
    } else {
      result = await this.cartRequest(
        "/api/cart/lines",
        "PATCH",
        {
          lineId: item.lineId,
          quantity: newQuantity
        }
      );
    }

    this.applyShopifyCart(result.cart);

  } catch (error) {
    console.error("Secure quantity update failed:", error);
    this.notify(error.message || "Could not update quantity.");

  } finally {
    this.cartBusy = false;
  }
},


    // ========================================
    // REMOVE CART ITEM
    // ========================================

    
async removeItem(key) {
  if (this.cartBusy || !this.shopifyCartReady) return;

  const item = this.cart.find(i => i.key === key);
  if (!item) return;

  this.cartBusy = true;

  try {
    const result = await this.cartRequest(
      "/api/cart/lines",
      "DELETE",
      { lineId: item.lineId }
    );

    this.applyShopifyCart(result.cart);
    this.notify("Item removed from basket");

  } catch (error) {
    console.error("Secure removal failed:", error);
    this.notify(error.message || "Could not remove this item.");

  } finally {
    this.cartBusy = false;
  }
},



    // ========================================
    // FIND PRODUCT BY LOCAL ID
    // ========================================

    findProduct(id) {
      return this.products.find(function (product) {
        return product.id === id;
      }) || this.products[0];
    }

  };
}


// ==========================================
// HOMEPAGE STORE
// ==========================================

function taharStore() {
  return createTaharStore();
}


// ==========================================
// SHOP PAGE
// ==========================================

function shopPage() {
  var base = createTaharStore();

  return {
    ...base,

    // Restore reactive getters after object spread.

    get cartCount() {
      return this.cart.reduce(function (total, item) {
        return total + item.qty;
      }, 0);
    },

    get subtotal() {
      return this.cart.reduce(function (total, item) {
        return total + item.qty * item.price;
      }, 0);
    },

    get heroProduct() {
      return this.products.find(function (product) {
        return product.id === "premium";
      }) || this.products[0];
    },

    get loopProducts() {
      return this.products.concat(this.products);
    },

    get featuredProducts() {
      return this.products.filter(function (product) {
        return [
          "premium",
          "traditional",
          "everyday",
          "moti-mogra"
        ].includes(product.id);
      });
    },


    // Filters and sorting.

    query: "",
    categoryFilter: "all",
    sizeFilter: "all",
    sort: "featured",

    get filtered() {
      var query = this.query.toLowerCase();

      var list = this.products.filter(function (product) {
        return product.name.toLowerCase().includes(query);
      });

      if (this.categoryFilter !== "all") {
        list = list.filter((product) => {
          return product.id === this.categoryFilter;
        });
      }

      if (this.sizeFilter !== "all") {
        list = list.filter((product) => {
          return product.sizes.some((size) => {
            return size.size === this.sizeFilter;
          });
        });
      }

      var activePrice = (product) => {
        var selected = product.sizes.find((size) => {
          return size.size ===
            this.selectedSizes[product.id];
        }) || product.sizes[0];

        return selected ? selected.price : 0;
      };

      if (this.sort === "price-low") {
        list = list.slice().sort(
          (a, b) => activePrice(a) - activePrice(b)
        );
      }

      if (this.sort === "price-high") {
        list = list.slice().sort(
          (a, b) => activePrice(b) - activePrice(a)
        );
      }

      return list;
    },


    // Pack-size filter.

    applySizeFilter(size) {
      this.sizeFilter = size;

      var target = size === "all"
        ? "1 kg"
        : size;

      this.products.forEach((product) => {
        var available = product.sizes.find(function (variant) {
          return variant.size === target;
        });

        if (available) {
          this.selectedSizes[product.id] =
            available.size;
        }
      });
    }

  };
}


// ==========================================
// PRODUCT DETAIL PAGE
// ==========================================

function productPage() {
  var base = createTaharStore();

  return {
    ...base,

    // Restore reactive getters after object spread.

    get cartCount() {
      return this.cart.reduce(function (total, item) {
        return total + item.qty;
      }, 0);
    },

    get subtotal() {
      return this.cart.reduce(function (total, item) {
        return total + item.qty * item.price;
      }, 0);
    },

    get heroProduct() {
      return this.products.find(function (product) {
        return product.id === "premium";
      }) || this.products[0];
    },

    get loopProducts() {
      return this.products.concat(this.products);
    },

    get featuredProducts() {
      return this.products.filter(function (product) {
        return [
          "premium",
          "traditional",
          "everyday",
          "moti-mogra"
        ].includes(product.id);
      });
    },


    // Product detail state.

    product: null,
    selectedSize: "",
    qty: 1,


    get related() {
      return this.products.filter((product) => {
        return product.id !== this.product?.id;
      }).slice(0, 4);
    },

    get selected() {
      return this.product?.sizes.find((size) => {
        return size.size === this.selectedSize;
      }) || this.product?.sizes[0];
    },

    get currentPrice() {
      return this.selected?.price || 0;
    },


    // Product detail initialization.

    async init() {
      this.setDefaultSelections();

      await this.loadShopifyProducts();

      if (this.shopifyReady) {
        await this.initShopifyCart();
      }

      var id = new URLSearchParams(
        window.location.search
      ).get("id");

      this.product = this.findProduct(id);

      var firstAvailableSize = this.product?.sizes.find(function (size) {
        return size.availableForSale === true;
      });

      this.selectedSize =
        (firstAvailableSize || this.product?.sizes[0])?.size || "";

      this.setDefaultSelections();

      if (this.product) {
        document.title =
          this.product.name + " — Tahar";
      }
    },


    // Add selected product and quantity.

    async addDetail() {
      if (!this.product) return;

      var added = await this.add(
        this.product,
        this.selectedSize,
        this.qty
      );

      if (added) {
        this.openCart();
      }
    }

  };
}
