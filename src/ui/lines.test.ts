import { describe, expect, it } from "vitest";
import { markLabel } from "./lines";

describe("footnote marks on a line", () => {
  it("never let a run read as one number", () => {
    expect(markLabel([4])).toBe("4");
    expect(markLabel([1, 2])).toBe("1,2");
    expect(markLabel([3, 4, 5, 6, 7])).toBe("3–7");
    expect(markLabel([12, 8, 9, 10])).toBe("8–10,12");
    expect(markLabel([12, 13])).toBe("12,13");
  });
});
