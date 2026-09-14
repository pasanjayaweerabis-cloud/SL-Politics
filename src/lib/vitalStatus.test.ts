import { describe, it, expect } from "vitest";
import { deriveVitalStatus } from "./vitalStatus.ts";

describe("deriveVitalStatus", () => {
  it("is deceased whenever a death date is recorded, serving or not", () => {
    expect(deriveVitalStatus({ dateOfDeath: "1959-09-26" }, false)).toBe("deceased");
    // A recorded death always wins, even against a data error that also
    // marks the same record as still serving — the death fact must never be
    // silently overridden by a stale or conflicting position record.
    expect(deriveVitalStatus({ dateOfDeath: "1959-09-26" }, true)).toBe("deceased");
  });

  it("is alive when currently serving with no death recorded", () => {
    // Holding an open office today is the one case an absent dateOfDeath can
    // resolve toward "alive" rather than "unknown" — Parliament does not
    // seat the dead.
    expect(deriveVitalStatus({ dateOfDeath: null }, true)).toBe("alive");
  });

  it("is unknown — never deceased — for a former member with no death recorded", () => {
    // The core "do not guess" rule: former, historical or long out of office
    // is not evidence of death.
    expect(deriveVitalStatus({ dateOfDeath: null }, false)).toBe("unknown");
  });
});
