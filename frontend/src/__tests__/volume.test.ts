import { describe, it, expect } from "vitest";
import { clampVolume, stepVolume } from "../lib/volume";

// ── clampVolume ────────────────────────────────────────────────────────────

describe("clampVolume", () => {
  it("clamps values below 0 to 0", () => {
    expect(clampVolume(-0.5)).toBe(0);
  });

  it("clamps values above 1 to 1", () => {
    expect(clampVolume(1.5)).toBe(1);
  });

  it("passes in-range values through unchanged", () => {
    expect(clampVolume(0)).toBe(0);
    expect(clampVolume(0.5)).toBe(0.5);
    expect(clampVolume(1)).toBe(1);
  });

  it("treats NaN as 0", () => {
    expect(clampVolume(Number.NaN)).toBe(0);
  });
});

// ── stepVolume ─────────────────────────────────────────────────────────────

describe("stepVolume", () => {
  it("steps up by 0.05", () => {
    expect(stepVolume(0.5, 1)).toBe(0.55);
  });

  it("steps down by 0.05", () => {
    expect(stepVolume(0.5, -1)).toBe(0.45);
  });

  it("stays at 0 when stepping down from the lower boundary", () => {
    expect(stepVolume(0, -1)).toBe(0);
  });

  it("stays at 1 when stepping up from the upper boundary", () => {
    expect(stepVolume(1, 1)).toBe(1);
  });

  it("lands exactly on 0 and 1 after repeated steps without float drift", () => {
    let v = 0;
    for (let i = 0; i < 20; i++) v = stepVolume(v, 1);
    expect(v).toBe(1);
    for (let i = 0; i < 20; i++) v = stepVolume(v, -1);
    expect(v).toBe(0);
  });
});