import { describe, expect, it } from "vitest";
import {
  ENTRY_ACCEPTED_MESSAGE,
  dayOfMonth,
  formatEntryCount,
  formatLongDate,
  formatShortDate,
  monthAbbrev,
  relativeDayLabel,
} from "@/lib/format";

describe("format helpers", () => {
  it("formats date keys without shifting the day", () => {
    expect(formatShortDate("2026-11-09")).toBe("Mon 9 Nov");
    expect(formatLongDate("2026-11-09")).toBe("Monday 9 November");
    expect(dayOfMonth("2026-11-09")).toBe("09");
    expect(monthAbbrev("2026-11-09")).toBe("NOV");
  });

  it("labels today and yesterday", () => {
    expect(relativeDayLabel("2026-11-09", "2026-11-09")).toBe("Today");
    expect(relativeDayLabel("2026-11-08", "2026-11-09")).toBe("Yesterday");
    expect(relativeDayLabel("2026-11-01", "2026-11-09")).toBeNull();
  });

  it("pluralises entry counts", () => {
    expect(formatEntryCount(0)).toBe("0 entries");
    expect(formatEntryCount(1)).toBe("1 entry");
    expect(formatEntryCount(1234)).toBe("1,234 entries");
  });

  it("explains the draw after a successful entry", () => {
    expect(ENTRY_ACCEPTED_MESSAGE).toContain("12:00 UK time");
    expect(ENTRY_ACCEPTED_MESSAGE).toContain("7 days");
  });
});
