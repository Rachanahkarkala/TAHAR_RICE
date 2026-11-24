
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

        var exists = product.sizes.some(function (size) {
          return size.size === current;
        });

        if (!exists) {
          this.selectedSizes[product.id] =
            product.sizes[0].size;
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
    // INITIALIZE / RESTORE SHOPIFY CART
    // ========================================

    async initShopifyCart() {
      try {
        var api = window.TaharShopify;
        var remoteCart = null;
        var savedCartId = null;

        // Read previously saved Shopify cart ID.
        try {
          savedCartId = localStorage.getItem(
            "tahar-shopify-cart-id"
          );
        } catch (storageError) {
          console.warn(
            "Browser storage is unavailable:",
            storageError
          );
        }

        // Attempt to restore an existing Shopify cart.
        if (savedCartId) {
          try {
            remoteCart = await api.getCart(savedCartId);
          } catch (restoreError) {
            console.warn(
              "Saved Shopify cart could not be restored; creating a new cart.",
              restoreError
            );
          }

          if (!remoteCart) {
            try {
              localStorage.removeItem("tahar-shopify-cart-id");
            } catch (storageError) {
              console.warn(
                "Could not clear expired cart ID:",
                storageError
              );
            }
          }
        }

        // Create a new cart if no valid cart exists.
        if (!remoteCart) {
          var legacyItems = [];

          // Read any existing localStorage cart.
          try {
            legacyItems = JSON.parse(
              localStorage.getItem("tahar-cart") || "[]"
            );
          } catch (legacyError) {
            console.warn(
              "Legacy cart could not be read:",
              legacyError
            );
          }

          if (!Array.isArray(legacyItems)) {
            legacyItems = [];
          }

          // Convert legacy items into Shopify cart lines.
          var lines = legacyItems.map((item) => {
            var product = this.products.find(function (candidate) {
              return candidate.id === item.id;
            });

            var variant = product && product.sizes.find(
              function (candidate) {
                return candidate.size === item.size;
              }
            );

            var variantId =
              (variant && variant.shopifyVariantId) ||
              item.shopifyVariantId;

            var quantity = Math.max(
              1,
              Math.floor(Number(item.qty) || 1)
            );

            return variantId
              ? {
                  merchandiseId: variantId,
                  quantity: quantity
                }
              : null;

          }).filter(Boolean);

          remoteCart = await api.createCart(lines);

          // Preserve previous basket as a backup.
          if (legacyItems.length) {
            try {
              localStorage.setItem(
                "tahar-cart-legacy-backup",
                JSON.stringify(legacyItems)
              );

              localStorage.removeItem("tahar-cart");

            } catch (storageError) {
              console.warn(
                "Legacy cart backup could not be saved:",
                storageError
              );
            }
          }
        }

        this.applyShopifyCart(remoteCart);
        this.shopifyCartReady = true;

        console.info(
          "Shopify cart restored:",
          this.cart.length,
          "lines"
        );

      } catch (error) {
        this.shopifyCartReady = false;

        console.error(
          "Shopify cart initialization failed:",
          error
        );

        this.notify(
          "Unable to load your basket. Please refresh."
        );
      }
    },


    // ========================================
    // APPLY SHOPIFY CART TO FRONTEND
    // ========================================

    applyShopifyCart(remoteCart) {
      if (!remoteCart || !remoteCart.id) {
        throw new Error("Shopify returned an invalid cart.");
      }

      this.shopifyCart = remoteCart;
      this.shopifyCartId = remoteCart.id;

      this.save();

      var lines =
        remoteCart.lines && remoteCart.lines.nodes
          ? remoteCart.lines.nodes
          : [];

      this.cart = lines.map((line) => {
        var merchandise = line.merchandise || {};

        var product = this.products.find(function (candidate) {
          return candidate.sizes.some(function (size) {
            return size.shopifyVariantId === merchandise.id;
          });
        });

        var variant = product && product.sizes.find(
          function (size) {
            return size.shopifyVariantId === merchandise.id;
          }
        );

        var sizeOption = (
          merchandise.selectedOptions || []
        ).find(function (option) {
          return /pack\s*size|size|weight/i.test(
            option.name || ""
          );
        });

        return {
          key: line.id,
          lineId: line.id,

          shopifyVariantId: merchandise.id,

          id: product ? product.id : "",

          name: product
            ? product.name
            : (
                merchandise.product &&
                merchandise.product.title
              ) || "Tahar product",

          size:
            (variant && variant.size) ||
            (sizeOption && sizeOption.value) ||
            merchandise.title ||
            "",

          price: Number(
            line.cost.amountPerQuantity.amount
          ),

          image:
            (product && product.image) ||
            (
              merchandise.product &&
              merchandise.product.featuredImage &&
              merchandise.product.featuredImage.url
            ) ||
            "",

          qty: line.quantity
        };
      });
    },


    // ========================================
    // SAVE SHOPIFY CART ID
    // ========================================

    save() {
      if (!this.shopifyCart || !this.shopifyCart.id) {
        return;
      }

      try {
        localStorage.setItem(
          "tahar-shopify-cart-id",
          this.shopifyCart.id
        );
      } catch (error) {
        console.warn(
          "Could not persist Shopify cart ID:",
          error
        );
      }
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


    // ========================================
    // ADD PRODUCT TO SHOPIFY CART
    // ========================================

    async add(product, size, quantity) {
      if (!this.shopifyReady || !this.shopifyCartReady) {
        this.notify(
          "Your basket is still connecting. Please try again."
        );
        return false;
      }

      if (this.cartBusy) return false;

      var selected = product && product.sizes.find(
        function (variant) {
          return variant.size === size;
        }
      );

      if (!selected || !selected.shopifyVariantId) {
        this.notify(
          "This pack is not connected to Shopify."
        );
        return false;
      }

      if (!selected.availableForSale) {
        this.notify(
          "This pack is currently unavailable."
        );
        return false;
      }

      var safeQuantity = Math.max(
        1,
        Math.floor(Number(quantity) || 1)
      );

      this.cartBusy = true;

      try {
        var updatedCart =
          await window.TaharShopify.addCartLines(
            this.shopifyCart.id,
            [{
              merchandiseId: selected.shopifyVariantId,
              quantity: safeQuantity
            }]
          );

        this.applyShopifyCart(updatedCart);

        this.notify(
          product.name + " added to your basket"
        );

        return true;

      } catch (error) {
        console.error(
          "Shopify add-to-cart failed:",
          error
        );

        this.notify(
          "Could not add this product. Please try again."
        );

        return false;

      } finally {
        this.cartBusy = false;
      }
    },


    // ========================================
    // UPDATE CART QUANTITY
    // ========================================

    async changeQty(key, delta) {
      if (this.cartBusy || !this.shopifyCart) {
        return;
      }

      var item = this.cart.find(function (candidate) {
        return candidate.key === key;
      });

      if (!item) return;

      var newQuantity = item.qty + Number(delta || 0);

      this.cartBusy = true;

      try {
        var updatedCart;

        if (newQuantity <= 0) {
          updatedCart =
            await window.TaharShopify.removeCartLines(
              this.shopifyCart.id,
              [item.lineId]
            );

        } else {
          updatedCart =
            await window.TaharShopify.updateCartLines(
              this.shopifyCart.id,
              [{
                id: item.lineId,
                quantity: newQuantity
              }]
            );
        }

        this.applyShopifyCart(updatedCart);

      } catch (error) {
        console.error(
          "Shopify quantity update failed:",
          error
        );

        this.notify(
          "Could not update quantity."
        );

      } finally {
        this.cartBusy = false;
      }
    },


    // ========================================
    // REMOVE CART ITEM
    // ========================================

    async removeItem(key) {
      if (this.cartBusy || !this.shopifyCart) {
        return;
      }

      var item = this.cart.find(function (candidate) {
        return candidate.key === key;
      });

      if (!item) return;

      this.cartBusy = true;

      try {
        var updatedCart =
          await window.TaharShopify.removeCartLines(
            this.shopifyCart.id,
            [item.lineId]
          );

        this.applyShopifyCart(updatedCart);

        this.notify("Item removed from basket");

      } catch (error) {
        console.error(
          "Shopify item removal failed:",
          error
        );

        this.notify(
          "Could not remove this item."
        );

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

      this.selectedSize =
        this.product?.sizes[0]?.size || "";

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
