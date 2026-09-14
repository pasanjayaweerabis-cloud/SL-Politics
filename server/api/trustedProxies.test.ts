import { describe, it, expect } from "vitest";
import { parseTrustedProxies, ipInRange, isTrusted, resolveClientIp, normaliseIp } from "./trustedProxies.ts";

describe("normaliseIp", () => {
  it("strips the IPv4-mapped IPv6 prefix Node reports on dual-stack sockets", () => {
    expect(normaliseIp("::ffff:127.0.0.1")).toBe("127.0.0.1");
  });
  it("leaves an ordinary address alone", () => {
    expect(normaliseIp("203.0.113.9")).toBe("203.0.113.9");
    expect(normaliseIp("2001:db8::1")).toBe("2001:db8::1");
  });
});

describe("parseTrustedProxies", () => {
  it("returns an empty list for unset/empty input", () => {
    expect(parseTrustedProxies(undefined)).toEqual([]);
    expect(parseTrustedProxies("")).toEqual([]);
    expect(parseTrustedProxies("   ")).toEqual([]);
  });

  it("parses a bare IPv4 address as a /32", () => {
    const [range] = parseTrustedProxies("127.0.0.1");
    expect(range).toEqual({ family: 4, base: ipToInt(127, 0, 0, 1), prefixLen: 32 });
  });

  it("parses an IPv4 CIDR range", () => {
    const [range] = parseTrustedProxies("10.0.0.0/8");
    expect(range).toEqual({ family: 4, base: ipToInt(10, 0, 0, 0), prefixLen: 8 });
  });

  it("parses multiple comma-separated entries, dropping invalid ones", () => {
    const ranges = parseTrustedProxies("127.0.0.1/32, not-an-ip, 10.0.0.0/8,  ");
    expect(ranges).toHaveLength(2);
  });

  it("parses a bare IPv6 address as a /128 and an IPv6 CIDR", () => {
    const ranges = parseTrustedProxies("::1,2001:db8::/32");
    expect(ranges).toEqual([
      { family: 6, base: expect.any(BigInt), prefixLen: 128 },
      { family: 6, base: expect.any(BigInt), prefixLen: 32 },
    ]);
  });

  it("rejects an out-of-range prefix length", () => {
    expect(parseTrustedProxies("10.0.0.0/33")).toEqual([]);
    expect(parseTrustedProxies("10.0.0.0/-1")).toEqual([]);
  });
});

function ipToInt(a: number, b: number, c: number, d: number): number {
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

describe("ipInRange / isTrusted", () => {
  it("matches an address inside a CIDR range", () => {
    const [range] = parseTrustedProxies("10.0.0.0/8");
    expect(ipInRange("10.1.2.3", range!)).toBe(true);
    expect(ipInRange("11.0.0.1", range!)).toBe(false);
  });

  it("matches an exact bare-address entry only exactly", () => {
    const [range] = parseTrustedProxies("127.0.0.1");
    expect(ipInRange("127.0.0.1", range!)).toBe(true);
    expect(ipInRange("127.0.0.2", range!)).toBe(false);
  });

  it("normalises an IPv4-mapped IPv6 socket address before matching an IPv4 range", () => {
    const [range] = parseTrustedProxies("127.0.0.1/32");
    expect(ipInRange("::ffff:127.0.0.1", range!)).toBe(true);
  });

  it("isTrusted is true when any range in the list matches", () => {
    const ranges = parseTrustedProxies("10.0.0.0/8,192.168.0.0/16");
    expect(isTrusted("192.168.1.1", ranges)).toBe(true);
    expect(isTrusted("172.16.0.1", ranges)).toBe(false);
  });

  it("matches an IPv6 CIDR range", () => {
    const [range] = parseTrustedProxies("2001:db8::/32");
    expect(ipInRange("2001:db8::1", range!)).toBe(true);
    expect(ipInRange("2001:db9::1", range!)).toBe(false);
  });
});

/*
 * H-1's core requirement: X-Forwarded-For is honoured only from a trusted
 * socket, and the RIGHT-MOST non-trusted entry is taken — never the
 * left-most, which is exactly what a client sending the header directly
 * controls.
 */
describe("resolveClientIp", () => {
  it("with no trusted proxies configured, always returns the socket address — X-Forwarded-For is never read", () => {
    const result = resolveClientIp("203.0.113.9", "1.2.3.4, 5.6.7.8", []);
    expect(result).toBe("203.0.113.9");
  });

  it("ignores X-Forwarded-For from a socket that is not itself trusted", () => {
    const ranges = parseTrustedProxies("10.0.0.0/8");
    // The request arrived directly from an untrusted address; a client could
    // put anything at all in this header — it must not be read.
    const result = resolveClientIp("203.0.113.9", "1.2.3.4", ranges);
    expect(result).toBe("203.0.113.9");
  });

  it("takes the right-most entry, not the left-most, from a trusted socket", () => {
    const ranges = parseTrustedProxies("127.0.0.1/32");
    // A client-forged left-most entry ("1.2.3.4", attacker-controlled)
    // followed by what the trusted proxy actually appended ("203.0.113.9").
    const result = resolveClientIp("127.0.0.1", "1.2.3.4, 203.0.113.9", ranges);
    expect(result).toBe("203.0.113.9");
  });

  it("skips right-most entries that are themselves trusted proxies (a multi-hop trusted chain)", () => {
    const ranges = parseTrustedProxies("127.0.0.1/32,10.0.0.1/32");
    const result = resolveClientIp("127.0.0.1", "1.2.3.4, 203.0.113.9, 10.0.0.1", ranges);
    expect(result).toBe("203.0.113.9");
  });

  it("falls back to the socket address when every chain entry is a trusted proxy", () => {
    const ranges = parseTrustedProxies("127.0.0.1/32,10.0.0.1/32");
    const result = resolveClientIp("127.0.0.1", "10.0.0.1", ranges);
    expect(result).toBe("127.0.0.1");
  });

  it("falls back to the socket address when the trusted socket sent no X-Forwarded-For at all", () => {
    const ranges = parseTrustedProxies("127.0.0.1/32");
    expect(resolveClientIp("127.0.0.1", undefined, ranges)).toBe("127.0.0.1");
  });
});
