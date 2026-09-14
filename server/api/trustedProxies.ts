/**
 * Javora — trusted-proxy allowlist and X-Forwarded-For resolution.
 *
 * H-1 (docs/security-audit-followup-2026-09-04.md). The API used to trust
 * `X-Forwarded-For` whenever `JAVORA_TRUST_PROXY=true`, taking the LEFT-MOST
 * entry — the one value in that header a client fully controls. Combined with
 * a documented production config that set the flag and shipped no reverse
 * proxy at all, a client sending a fresh forged address on every request got
 * a fresh rate-limit bucket every time: total bypass, plus unbounded memory
 * growth in `rateBuckets` (fixed separately in server.ts).
 *
 * The replacement: `JAVORA_TRUSTED_PROXIES`, a comma-separated list of
 * CIDR ranges or bare addresses. A forwarded address is honoured only when
 * the actual TCP peer (`req.socket.remoteAddress`) is itself inside that
 * list, and the address taken is the RIGHT-MOST entry in the chain that is
 * NOT itself a trusted proxy — everything to its right was appended by a hop
 * this deployment vouches for; everything to its left (including the
 * left-most entry) is exactly what an attacker controls.
 */

import { isIPv4, isIPv6 } from "node:net";

export type TrustedRange =
  | { family: 4; base: number; prefixLen: number }
  | { family: 6; base: bigint; prefixLen: number };

/** Node reports an IPv4 peer on a dual-stack socket as "::ffff:1.2.3.4". */
export function normaliseIp(ip: string): string {
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(ip.trim());
  return mapped ? mapped[1]! : ip.trim();
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = (value << 8) | n;
  }
  return value >>> 0;
}

/** Expands "::" once, per RFC 4291; returns null for anything malformed. */
function ipv6ToBigInt(ip: string): bigint | null {
  if (!isIPv6(ip)) return null;
  let groups: string[];
  if (ip.includes("::")) {
    const [head, tail] = ip.split("::");
    const headParts = head ? head.split(":").filter(Boolean) : [];
    const tailParts = tail ? tail.split(":").filter(Boolean) : [];
    const missing = 8 - headParts.length - tailParts.length;
    if (missing < 0) return null;
    groups = [...headParts, ...Array(missing).fill("0"), ...tailParts];
  } else {
    groups = ip.split(":");
  }
  if (groups.length !== 8) return null;
  let value = 0n;
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    value = (value << 16n) | BigInt(parseInt(group, 16));
  }
  return value;
}

/** Parses one "1.2.3.0/24" / "1.2.3.4" / "::1" / "2001:db8::/32" entry. */
function parseCidr(entry: string): TrustedRange | null {
  const trimmed = entry.trim();
  if (!trimmed) return null;
  const slash = trimmed.lastIndexOf("/");
  const addr = slash === -1 ? trimmed : trimmed.slice(0, slash);
  const prefixRaw = slash === -1 ? undefined : trimmed.slice(slash + 1);

  if (isIPv4(addr)) {
    const base = ipv4ToInt(addr);
    if (base === null) return null;
    const prefixLen = prefixRaw === undefined ? 32 : Number(prefixRaw);
    if (!Number.isInteger(prefixLen) || prefixLen < 0 || prefixLen > 32) return null;
    const mask = prefixLen === 0 ? 0 : (0xffffffff << (32 - prefixLen)) >>> 0;
    return { family: 4, base: (base & mask) >>> 0, prefixLen };
  }

  if (isIPv6(addr)) {
    const base = ipv6ToBigInt(addr);
    if (base === null) return null;
    const prefixLen = prefixRaw === undefined ? 128 : Number(prefixRaw);
    if (!Number.isInteger(prefixLen) || prefixLen < 0 || prefixLen > 128) return null;
    const fullMask = (1n << 128n) - 1n;
    const mask = prefixLen === 0 ? 0n : (fullMask << BigInt(128 - prefixLen)) & fullMask;
    return { family: 6, base: base & mask, prefixLen };
  }

  return null;
}

/** Parses `JAVORA_TRUSTED_PROXIES`. Invalid entries are dropped, not thrown on. */
export function parseTrustedProxies(raw: string | undefined): TrustedRange[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((entry) => parseCidr(entry))
    .filter((range): range is TrustedRange => range !== null);
}

export function ipInRange(ip: string, range: TrustedRange): boolean {
  const normalised = normaliseIp(ip);
  if (range.family === 4) {
    if (!isIPv4(normalised)) return false;
    const value = ipv4ToInt(normalised);
    if (value === null) return false;
    const mask = range.prefixLen === 0 ? 0 : (0xffffffff << (32 - range.prefixLen)) >>> 0;
    return ((value & mask) >>> 0) === range.base;
  }
  if (!isIPv6(normalised)) return false;
  const value = ipv6ToBigInt(normalised);
  if (value === null) return false;
  const fullMask = (1n << 128n) - 1n;
  const mask = range.prefixLen === 0 ? 0n : (fullMask << BigInt(128 - range.prefixLen)) & fullMask;
  return (value & mask) === range.base;
}

export function isTrusted(ip: string, ranges: readonly TrustedRange[]): boolean {
  return ranges.some((range) => ipInRange(ip, range));
}

/**
 * Resolve the real client address for one request.
 *
 * `ranges` empty (the default, `JAVORA_TRUSTED_PROXIES` unset) means the
 * socket address is always used — the safe default this finding requires.
 * Otherwise: the socket peer must itself be a trusted proxy before its
 * `X-Forwarded-For` is even read, and the address returned is the
 * right-most chain entry that is not itself inside `ranges`.
 */
export function resolveClientIp(
  socketIp: string,
  forwardedFor: string | undefined,
  ranges: readonly TrustedRange[],
): string {
  const socket = normaliseIp(socketIp);
  if (ranges.length === 0) return socket;
  if (!isTrusted(socket, ranges)) return socket;

  if (!forwardedFor?.trim()) return socket;
  const chain = forwardedFor.split(",").map((s) => s.trim()).filter(Boolean);
  for (let i = chain.length - 1; i >= 0; i--) {
    const candidate = normaliseIp(chain[i]!);
    if (!isTrusted(candidate, ranges)) return candidate;
  }
  // Every hop in the chain claims to be a trusted proxy — fall back to the
  // actual TCP peer rather than trusting an all-proxy chain at face value.
  return socket;
}
