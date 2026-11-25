
export function json(data, status = 200, extraHeaders = {}) {
  const headers = new Headers(extraHeaders);

  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Vary", "Cookie");

  return new Response(JSON.stringify(data), {
    status,
    headers
  });
}

export function isSameOrigin(request) {
  const origin = request.headers.get("Origin");

  if (!origin) return false;

  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export async function parseJson(request) {
  const contentType = request.headers.get("Content-Type") || "";

  if (!contentType.toLowerCase().includes("application/json")) {
    const error = new Error("Expected application/json.");
    error.status = 415;
    throw error;
  }

  const raw = await request.text();

  if (raw.length > 16_384) {
    const error = new Error("Request body is too large.");
    error.status = 413;
    throw error;
  }

  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    const error = new Error("Invalid JSON request body.");
    error.status = 400;
    throw error;
  }
}

export function methodNotAllowed(allowed) {
  return json(
    { error: "Method not allowed." },
    405,
    { Allow: allowed.join(", ") }
  );
}
