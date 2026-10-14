import { describe, expect, it } from "vitest";
import { curlFrames, freeEdgeSpan, lift } from "./curl";

describe("the page curl", () => {
  it("turns the leaf a half turn, starting and ending flat", () => {
    const forward = curlFrames(true);
    expect(forward.leaf[0].transform).toContain("rotateY(0deg)");
    expect(forward.leaf.at(-1)!.transform).toBe("translateY(0px) rotateZ(0deg) rotateY(-180deg)");
    expect(curlFrames(false).leaf.at(-1)!.transform).toBe("translateY(0px) rotateZ(0deg) rotateY(180deg)");
  });

  it("mirrors the back turn exactly", () => {
    const f = curlFrames(true);
    const b = curlFrames(false);
    const flip = (t: string) => t.replace(/-?\d+(\.\d+)?(?=(deg|%))/g, (n) => String(-Number(n) || 0));
    f.leaf.forEach((frame, i) => {
      const [fy] = /translateY\([^)]*\)/.exec(String(frame.transform))!;
      expect(String(b.leaf[i].transform)).toContain(fy);
      expect(String(b.leaf[i].transform).replace(/translateY\([^)]*\) /, "")).toBe(
        flip(String(frame.transform).replace(/translateY\([^)]*\) /, "")),
      );
      expect(b.near[i].opacity).toBe(f.near[i].opacity);
      expect(b.far[i].opacity).toBe(f.far[i].opacity);
      expect(String(b.near[i].transform)).toBe(flip(String(f.near[i].transform)));
    });
  });

  it("casts no shadow at rest, and lifts only in flight", () => {
    for (const forward of [true, false]) {
      const frames = curlFrames(forward);
      for (const track of [frames.near, frames.far]) {
        expect(track[0].opacity).toBe(0);
        expect(track.at(-1)!.opacity).toBe(0);
      }
      expect(frames.backLight.at(-1)!.opacity).toBe(0);
      expect(frames.frontLight[0].opacity).toBe(0);
    }
    expect(lift(0)).toBe(0);
    expect(lift(1)).toBe(0);
    expect(lift(0.3)).toBeGreaterThan(0.9);
  });

  it("keeps every frame ordered on one timeline", () => {
    const frames = curlFrames(true);
    const offsets = frames.leaf.map((f) => f.offset as number);
    expect(offsets[0]).toBe(0);
    expect(offsets.at(-1)).toBe(1);
    for (let i = 1; i < offsets.length; i++) expect(offsets[i]).toBeGreaterThan(offsets[i - 1]);
    for (const track of Object.values(frames)) expect(track.map((f: Keyframe) => f.offset)).toEqual(offsets);
  });

  it("lifts the sheet without swelling it: the free edge stays within 3.5% of the book's height", () => {
    // The largest book (1080 × 700) and a short window's (1080 × 530); the swell grows with the half width.
    for (const [half, height] of [
      [540, 700],
      [540, 530],
    ]) {
      for (const forward of [true, false]) {
        let worst = 0;
        for (let i = 0; i <= 200; i++) {
          const { top, bottom } = freeEdgeSpan(i / 200, forward, half, height);
          worst = Math.max(worst, (Math.max(0, -top) + Math.max(0, bottom - height)) / height);
        }
        expect(worst, `${forward ? "forward" : "back"} ${half}×${height}`).toBeLessThanOrEqual(0.035);
        expect(worst).toBeGreaterThan(0); // it does still lift
      }
    }
  });

  it("would swell visibly at the old perspective, so the check has teeth", () => {
    const { top, bottom } = freeEdgeSpan(0.5, true, 540, 700, 3200);
    expect((bottom - top) / 700).toBeGreaterThan(1.15);
  });
});
