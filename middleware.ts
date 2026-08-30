import { NextResponse, type NextRequest } from "next/server";
import { isAllowedHost, parseAllowedHosts } from "@/lib/allowed-host";

/**
 * Refuse any request whose Host header is not a loopback name or one of
 * ALLOWED_HOSTS. See lib/allowed-host.ts for why the Host header is the thing
 * worth checking.
 *
 * Every request, not just Server Actions: the dashboard renders the whole
 * ledger into its GET response, so a rebound page could read it with a plain
 * fetch without ever invoking an action.
 */
export function middleware(request: NextRequest): NextResponse {
  const allowed = parseAllowedHosts(process.env.ALLOWED_HOSTS);
  if (isAllowedHost(request.headers.get("host"), allowed)) {
    return NextResponse.next();
  }
  return new NextResponse(
    "Refused: unexpected Host header. Reach this app on localhost, or name " +
      "this host in ALLOWED_HOSTS.\n",
    { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } }
  );
}