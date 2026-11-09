import { describe, expect, it } from "vitest";
import { addDays, isDateKey, londonClock, londonDateKey, nextLondonMidnight } from "@/lib/london-time";

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

describe("nextLondonMidnight (the next draw)", () => {
  const next = (iso: string) => nextLondonMidnight(new Date(iso)).toISOString();

  it("is 00:00 UTC in winter (GMT)", () => {
    expect(next("2026-11-09T21:00:00Z")).toBe("2026-11-10T00:00:00.000Z");
    expect(next("2026-11-09T00:00:00Z")).toBe("2026-11-10T00:00:00.000Z");
    expect(next("2026-12-31T23:59:59Z")).toBe("2027-01-01T00:00:00.000Z");
  });

  it("is 23:00 UTC the evening before in summer (BST)", () => {
    expect(next("2026-07-01T10:00:00Z")).toBe("2026-07-01T23:00:00.000Z");
    // 23:30 UTC is already 00:30 on 2 July in London, so the next one is the following night.
    expect(next("2026-07-01T23:30:00Z")).toBe("2026-07-02T23:00:00.000Z");
  });

  it("handles the nights the clocks change", () => {
    // BST starts 29 March 2026 at 01:00 UTC: that midnight is still GMT.
    expect(next("2026-03-28T12:00:00Z")).toBe("2026-03-29T00:00:00.000Z");
    expect(next("2026-03-29T12:00:00Z")).toBe("2026-03-29T23:00:00.000Z");
    // BST ends 25 October 2026 at 01:00 UTC: that midnight is still BST.
    expect(next("2026-10-24T12:00:00Z")).toBe("2026-10-24T23:00:00.000Z");
    expect(next("2026-10-25T12:00:00Z")).toBe("2026-10-26T00:00:00.000Z");
  });

  it("always lands on 00:00 in London", () => {
    for (let day = 0; day < 400; day += 7) {
      const target = nextLondonMidnight(new Date(Date.UTC(2026, 0, 1 + day, 15)));
      expect(londonClock(target)).toBe("00:00");
    }
  });
});
