
const COOKIE_NAME = "__Host-tahar_session";
const CART_TTL_SECONDS = 60 * 60 * 24 * 30;

export function getSessionId(request) {
  const cookieHeader = request.headers.get("Cookie") || "";

  const cookies = cookieHeader.split(";");

  for (const cookie of cookies) {
    const separator = cookie.indexOf("=");

    if (separator === -1) continue;

    const name = cookie.slice(0, separator).trim();
    const value = cookie.slice(separator + 1).trim();

    if (
      name === COOKIE_NAME &&
      /^[a-f0-9]{64}$/.test(value)
    ) {
      return value;
    }
  }

  return null;
}

export function createSessionId() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);

  return Array.from(bytes, byte =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

export function createSessionCookie(sessionId) {
  return [
    `${COOKIE_NAME}=${sessionId}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${CART_TTL_SECONDS}`
  ].join("; ");
}

function cartKey(sessionId) {
  return `cart-session:v1:${sessionId}`;
}

function getNamespace(env) {
  if (!env.CART_SESSIONS) {
    throw new Error("CART_SESSIONS binding is missing.");
  }

  return env.CART_SESSIONS;
}

export async function getStoredCartId(env, sessionId) {
  if (!sessionId) return null;

  return getNamespace(env).get(cartKey(sessionId));
}

export async function storeCartId(env, sessionId, cartId) {
  if (!sessionId || !cartId) {
    throw new Error("Invalid cart session.");
  }

  await getNamespace(env).put(
    cartKey(sessionId),
    cartId,
    { expirationTtl: CART_TTL_SECONDS }
  );
}

export async function deleteStoredCartId(env, sessionId) {
  if (!sessionId) return;

  await getNamespace(env).delete(cartKey(sessionId));
}
