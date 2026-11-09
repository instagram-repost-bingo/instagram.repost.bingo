import { describe, expect, it } from "vitest";
import {
  dayOfMonth,
  entryAcceptedMessage,
  formatEntryCount,
  formatLongDate,
  formatShortDate,
  monthAbbrev,
  relativeDayLabel,
  splitCountdown,
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

  it("names the owner and explains the draw after a successful entry", () => {
    const message = entryAcceptedMessage("slashie.app");
    expect(message).toContain("@slashie.app");
    expect(message).toContain("00:00 UK time");
    expect(message).toContain("7 days");
  });

  it("splits the countdown into hours, minutes and seconds", () => {
    expect(splitCountdown((7 * 3600 + 12 * 60 + 5) * 1000 + 999)).toEqual({ hours: "07", minutes: "12", seconds: "05" });
    expect(splitCountdown(24 * 3600 * 1000)).toEqual({ hours: "24", minutes: "00", seconds: "00" });
    expect(splitCountdown(0)).toEqual({ hours: "00", minutes: "00", seconds: "00" });
    expect(splitCountdown(-5000)).toEqual({ hours: "00", minutes: "00", seconds: "00" });
  });
});
