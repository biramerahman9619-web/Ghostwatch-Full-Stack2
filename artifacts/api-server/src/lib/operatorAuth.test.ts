/**
 * Unit tests for operatorAuth.ts
 *
 * Covers:
 *   1. No OPERATOR_USER_IDS set → any user is an operator
 *   2. OPERATOR_USER_IDS set, user in list → is operator
 *   3. OPERATOR_USER_IDS set, user NOT in list → not operator
 *   4. Empty string env var → treated as "not set" → any user is operator
 *   5. Whitespace-padded IDs are trimmed correctly
 */

import { describe, it, expect } from "vitest";
import { checkIsOperator } from "./operatorAuth.js";

describe("checkIsOperator", () => {
  describe("when OPERATOR_USER_IDS is not configured (fail-closed)", () => {
    it("returns false when env var is undefined", () => {
      expect(checkIsOperator("user-abc", undefined)).toBe(false);
    });

    it("returns false when env var is an empty string", () => {
      expect(checkIsOperator("user-abc", "")).toBe(false);
    });

    it("returns false when env var is all whitespace", () => {
      expect(checkIsOperator("user-abc", "   ")).toBe(false);
    });
  });

  describe("when OPERATOR_USER_IDS is configured", () => {
    const env = "operator-1,operator-2";

    it("returns true for a user in the allow-list", () => {
      expect(checkIsOperator("operator-1", env)).toBe(true);
      expect(checkIsOperator("operator-2", env)).toBe(true);
    });

    it("returns false for a user NOT in the allow-list", () => {
      expect(checkIsOperator("regular-user", env)).toBe(false);
      expect(checkIsOperator("operator-3", env)).toBe(false);
    });

    it("trims whitespace from IDs in the env var", () => {
      expect(checkIsOperator("operator-1", " operator-1 , operator-2 ")).toBe(true);
      expect(checkIsOperator("operator-2", " operator-1 , operator-2 ")).toBe(true);
    });

    it("is case-sensitive", () => {
      expect(checkIsOperator("OPERATOR-1", env)).toBe(false);
    });

    it("returns false for an empty userId string", () => {
      expect(checkIsOperator("", env)).toBe(false);
    });
  });
});
