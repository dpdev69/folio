import { describe, expect, it } from "vitest";
import { followTail } from "./nav";

describe("following the tail across several spreads", () => {
  // One chapter id per laid page; two pages make a spread.
  const before = ["i", "i", "ii", "ii", "ii", "ii"];

  it("goes to the chapter's last spread when it grew by more than one spread in one layout", () => {
    const after = [...before, "ii", "ii", "ii", "ii", "ii", "ii"];
    expect(followTail(before, after, 2)).toBe(5);
  });

  it("still turns one spread when the chapter grew by one", () => {
    expect(followTail(before, [...before, "ii", "ii"], 2)).toBe(3);
  });

  it("goes to the chapter's last spread, not past it into the next chapter", () => {
    const middle = ["i", "i", "i", "ii", "ii", "ii"];
    const grown = ["i", "i", "i", "i", "i", "i", "i", "ii", "ii", "ii"];
    expect(followTail(middle, grown, 1)).toBe(3);
  });

  it("stays when the reader was not on the chapter's last spread", () => {
    expect(followTail(before, [...before, "ii", "ii", "ii", "ii"], 1)).toBeNull();
  });
});
