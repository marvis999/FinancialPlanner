/**
 * Host-header allowlist, against DNS rebinding.
 *
 * The app has no authentication: reaching it is the same as owning the
 * ledger. Binding the container to 127.0.0.1 keeps the network out, but not
 * the browser already running on this machine. In a rebinding attack a page
 * the user visits re-resolves its own domain to 127.0.0.1, and every request
 * it then makes carries `Origin: http://evil.example` AND
 * `Host: evil.example:3210`. Next's Server Action guard compares those two
 * and sees a match, because the attacker controls the name in both — a
 * same-origin check cannot detect rebinding by construction.
 *
 * The Host header is what the attack cannot fake. To reach this process the
 * browser must resolve a name that points here, and that name is the one it
 * sends. It can make the browser ask for `evil.example`; it cannot make the
 * browser call us `localhost` while resolving `evil.example`.
 *
 * The other direction is already covered: a page on evil.example that fetches
 * `http://localhost:3210` directly sends a Host we accept, but then Origin no
 * longer equals Host, so Next rejects the action — and CORS keeps it from
 * reading the response to a plain GET. The two checks close opposite halves.
 */

/**
 * Loopback names: an attacker cannot make a browser send one of these.
 *
 * Bracketed IPv6 only. RFC 7230 requires the brackets in a Host header, so a
 * bare `::1` is malformed and gets refused with everything else malformed —
 * accepting it would only widen the allowlist for input no client sends.
 */
function isLoopback(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "[::1]" ||
    // The whole 127.0.0.0/8 block, not just 127.0.0.1.
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)
  );
}

/** The name out of a Host header, without the port. Handles [::1]:3210. */
export function hostnameOf(host: string): string {
  const trimmed = host.trim().toLowerCase();
  if (trimmed.startsWith("[")) {
    const close = trimmed.indexOf("]");
    return close === -1 ? trimmed : trimmed.slice(0, close + 1);
  }
  const colon = trimmed.indexOf(":");
  return colon === -1 ? trimmed : trimmed.slice(0, colon);
}

/** ALLOWED_HOSTS as a list; empty when unset. Names or name:port both work. */
export function parseAllowedHosts(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== "");
}

/**
 * Whether a request carrying this Host header may be served.
 *
 * A missing Host is refused: HTTP/1.1 requires it, so its absence is either a
 * broken client or someone probing.
 */
export function isAllowedHost(
  host: string | null | undefined,
  allowed: string[] = []
): boolean {
  if (!host) return false;
  const full = host.trim().toLowerCase();
  const hostname = hostnameOf(full);
  if (isLoopback(hostname)) return true;
  // A bare name in ALLOWED_HOSTS matches any port, so a proxy can forward on a
  // port this app never sees. A name:port entry is honoured strictly: naming a
  // port is a narrowing, and a security control should not widen it back.
  return allowed.includes(full) || allowed.includes(hostname);
}
