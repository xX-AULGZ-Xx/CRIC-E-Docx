import { NextRequest } from "next/server";
import { proxyToBackend } from "@/lib/proxyBackend";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ path: string[] }> };

async function handle(req: NextRequest, context: RouteContext): Promise<Response> {
  const { path } = await context.params;
  return proxyToBackend(req, `/v1/${path.join("/")}`);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
