import { NextRequest } from "next/server";
import { proxyToBackend } from "@/lib/proxyBackend";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  return proxyToBackend(req, "/health");
}
