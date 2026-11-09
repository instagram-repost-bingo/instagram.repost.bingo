import { describe, expect, it } from "vitest";
import { addDays, isDateKey, londonDateKey } from "@/lib/london-time";

describe("londonDateKey", () => {
  it("uses GMT (UTC+0) in winter", () => {
    expect(londonDateKey(new Date("2026-11-09T00:00:00Z"))).toBe("2026-11-09");
    expect(londonDateKey(new Date("2026-11-09T23:59:59Z"))).toBe("2026-11-09");
  });

  it("uses BST (UTC+1) in summer", () => {
    // 23:30 UTC is already the next day in London during BST.
    expect(londonDateKey(new Date("2026-07-01T23:30:00Z"))).toBe("2026-07-02");
    expect(londonDateKey(new Date("2026-07-01T22:59:59Z"))).toBe("2026-07-01");
  });

  it("follows the clocks changing", () => {
    // BST starts 29 March 2026 at 01:00 UTC and ends 25 October 2026 at 01:00 UTC.
    expect(londonDateKey(new Date("2026-03-28T23:30:00Z"))).toBe("2026-03-28");
    expect(londonDateKey(new Date("2026-03-29T23:30:00Z"))).toBe("2026-03-30");
    expect(londonDateKey(new Date("2026-10-24T23:30:00Z"))).toBe("2026-10-25");
    expect(londonDateKey(new Date("2026-10-25T23:30:00Z"))).toBe("2026-10-25");
  });

  it("throws on an invalid date", () => {
    expect(() => londonDateKey(new Date("nope"))).toThrow(RangeError);
  });
});

describe("addDays / isDateKey", () => {
  it("handles month, year and leap-day boundaries", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("validates date keys", () => {
    expect(isDateKey("2026-11-09")).toBe(true);
    expect(isDateKey("2026-02-30")).toBe(false);
    expect(isDateKey("2026-11-9")).toBe(false);
    expect(isDateKey(20261109)).toBe(false);
    expect(() => addDays("tomorrow", 1)).toThrow(RangeError);
  });
});
