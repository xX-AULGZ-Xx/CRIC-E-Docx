import { NextRequest } from "next/server";

/** Forward a client request to the internal FastAPI document engine at runtime. */
export async function proxyToBackend(req: NextRequest, targetPath: string): Promise<Response> {
  const baseUrl = (process.env.INTERNAL_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
  const targetUrl = `${baseUrl}${targetPath}${req.nextUrl.search}`;

  const headers = new Headers();
  req.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (lower === "host" || lower === "connection" || lower === "content-length") return;
    headers.set(key, value);
  });

  const incomingHost = req.headers.get("x-forwarded-host") || req.headers.get("host");
  if (incomingHost) headers.set("x-forwarded-host", incomingHost);
  const incomingProto = req.headers.get("x-forwarded-proto") || req.nextUrl.protocol.replace(":", "");
  if (incomingProto) headers.set("x-forwarded-proto", incomingProto);

  const init: RequestInit = {
    method: req.method,
    headers,
    redirect: "manual",
    cache: "no-store",
  };

  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.arrayBuffer();
  }

  const upstream = await fetch(targetUrl, init);
  const resHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (lower === "transfer-encoding" || lower === "content-encoding" || lower === "content-length" || lower === "set-cookie") {
      return;
    }
    resHeaders.set(key, value);
  });

  const getSetCookie = (upstream.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  if (typeof getSetCookie === "function") {
    for (const cookieVal of getSetCookie.call(upstream.headers)) {
      resHeaders.append("set-cookie", cookieVal);
    }
  } else {
    const singleCookie = upstream.headers.get("set-cookie");
    if (singleCookie) resHeaders.append("set-cookie", singleCookie);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: resHeaders,
  });
}
