import { describe, expect, it } from "vitest";

import { normalisePhone, submitApplicationSchema } from "../src/http/schemas.js";

/** A submission with only the four required documents attached. */
function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    email: "budi@example.com",
    fullName: "Budi Santoso",
    address: "Jl. Catur No. 10, Menteng Dalam, Jakarta Selatan",
    whatsapp: "0811803090",
    gsmNumber: "081380001111",
    emergencyNumber: "081290002222",
    socialPlatform: "instagram",
    socialAccount: "budi.santoso",
    purpose: "Perjalanan keluarga",
    usageLocation: "Jakarta - Bandung",
    startDate: "2026-09-25",
    startTime: "09:00",
    durationDays: 3,
    vehicleChoice: "byd-seal",
    vehicleLabel: "BYD Seal",
    vehicleOther: null,
    withDriver: false,
    referralSource: "ig",
    referralSourceOther: null,
    documentKeys: {
      ktp: "uploads/a1/ktp.jpg",
      selfieKtp: "uploads/a2/selfieKtp.jpg",
      sim: "uploads/a3/sim.jpg",
      kartuKeluarga: "uploads/a4/kartuKeluarga.jpg",
    },
    documentNames: { ktp: "ktp.jpg" },
    ...overrides,
  };
}

describe("submitApplicationSchema", () => {
  it("accepts a submission that skips the two optional documents", () => {
    /*
     * Regression: `z.record()` keyed by an enum is exhaustive in Zod 4, so an
     * earlier version demanded `tokenListrik` and `riwayatAkun` and rejected
     * every real submission. `z.partialRecord()` is what makes them optional.
     */
    const result = submitApplicationSchema.safeParse(validPayload());

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.documentKeys.tokenListrik).toBeUndefined();
      expect(Object.keys(result.data.documentKeys)).toHaveLength(4);
    }
  });

  it("accepts all six documents", () => {
    const payload = validPayload();
    const result = submitApplicationSchema.safeParse({
      ...payload,
      documentKeys: {
        ...payload.documentKeys,
        tokenListrik: "uploads/a5/tokenListrik.jpg",
        riwayatAkun: "uploads/a6/riwayatAkun.jpg",
      },
    });

    expect(result.success).toBe(true);
  });

  it("still accepts the retired sosialMedia key from an older build", () => {
    /*
     * The static site is cached at the edge, so a browser can submit against
     * the previous bundle for a while after a deploy. Rejecting the key it
     * uploads would fail those submissions outright.
     */
    const payload = validPayload();
    const result = submitApplicationSchema.safeParse({
      ...payload,
      documentKeys: { ...payload.documentKeys, sosialMedia: "uploads/a7/sosialMedia.jpg" },
    });

    expect(result.success).toBe(true);
  });

  it("normalises every phone number to 62…", () => {
    const result = submitApplicationSchema.safeParse(validPayload());

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.whatsapp).toBe("62811803090");
      expect(result.data.gsmNumber).toBe("6281380001111");
    }
  });

  it("lets a tripped honeypot through so the route can decide", () => {
    // Rejecting here would answer the bot with a 422 naming the field, which
    // is the one piece of feedback that teaches it to skip the field.
    const result = submitApplicationSchema.safeParse(
      validPayload({ website: "http://spam.example" }),
    );

    expect(result.success).toBe(true);
  });

  it("demands the free-text unit when the renter picks 'lainnya'", () => {
    const result = submitApplicationSchema.safeParse(
      validPayload({ vehicleChoice: "lainnya", vehicleOther: "" }),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path.join("."))).toContain("vehicleOther");
    }
  });

  it("rejects a date that does not exist", () => {
    const result = submitApplicationSchema.safeParse(validPayload({ startDate: "2026-02-31" }));
    expect(result.success).toBe(false);
  });

  it("rejects a malformed phone number", () => {
    const result = submitApplicationSchema.safeParse(validPayload({ whatsapp: "12" }));
    expect(result.success).toBe(false);
  });

  it("accepts a pasted profile link as the social account", () => {
    const result = submitApplicationSchema.safeParse(
      validPayload({ socialAccount: "https://www.tiktok.com/@budisantoso", socialPlatform: "tiktok" }),
    );

    expect(result.success).toBe(true);
  });

  it("rejects a social platform outside the list", () => {
    const result = submitApplicationSchema.safeParse(validPayload({ socialPlatform: "myspace" }));
    expect(result.success).toBe(false);
  });

  it.each([
    ["kosong", ""],
    ["berisi spasi", "budi santoso"],
    ["skema berbahaya", "javascript:alert(1)"],
  ])("rejects a social account yang %s", (_label, socialAccount) => {
    const result = submitApplicationSchema.safeParse(validPayload({ socialAccount }));

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path.join("."))).toContain("socialAccount");
    }
  });
});

describe("normalisePhone", () => {
  it.each([
    ["0811803090", "62811803090"],
    ["+62811803090", "62811803090"],
    ["62811803090", "62811803090"],
    ["0811-8030-90", "62811803090"],
  ])("%s -> %s", (input, expected) => {
    expect(normalisePhone(input)).toBe(expected);
  });
});
