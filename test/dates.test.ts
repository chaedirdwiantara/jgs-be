import { describe, expect, it } from "vitest";

import {
  addDays,
  calendarDateInJakarta,
  formatDateID,
  formatRupiah,
  rentalEndDate,
} from "../src/domain/shared/dates.js";

describe("dates", () => {
  it("adds days across month and year boundaries", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("counts the rental's last day inclusively", () => {
    expect(rentalEndDate("2026-09-01", 1)).toBe("2026-09-01");
    expect(rentalEndDate("2026-09-01", 4)).toBe("2026-09-04");
  });

  it("converts an instant to a Jakarta calendar date", () => {
    expect(calendarDateInJakarta("2026-09-15T16:59:59.000Z")).toBe("2026-09-15");
    expect(calendarDateInJakarta("2026-09-15T17:00:00.000Z")).toBe("2026-09-16");
  });

  it("formats for a chat message", () => {
    expect(formatDateID("2026-09-17")).toBe("Kamis, 17 Sep 2026");
    expect(formatRupiah(1_200_000)).toBe("Rp 1.200.000");
    expect(formatRupiah(750)).toBe("Rp 750");
  });
});
