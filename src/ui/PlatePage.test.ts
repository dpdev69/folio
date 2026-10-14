import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Plate } from "../book/model";
import { PlatePage, plateCaptionOnly, plateWaiting } from "./PlatePage";

const plate = (over: Partial<Plate> = {}): Plate => ({
  id: "plate-a",
  n: 2,
  file: "src/a.ts",
  title: "A small change",
  caption: "Fig. 2. The change to src/a.ts.",
  lines: [],
  additions: 0,
  deletions: 0,
  status: "open",
  folded: false,
  ...over,
});

const larger = "The change is part of a larger edit to src/a.ts; see Plate I.";
const noop = () => {};
const page = (p: Plate) =>
  renderToStaticMarkup(
    createElement(PlatePage, {
      plate: p,
      bookTitle: "A book",
      number: 3,
      onAccept: noop,
      onRevise: noop,
      onReject: noop,
      onFold: noop,
    }),
  );

describe("plateWaiting", () => {
  it("is true for an open plate whose lines are still arriving", () => {
    expect(plateWaiting(plate())).toBe(true);
    expect(plateCaptionOnly(plate())).toBe(false);
  });

  it("is false for a plate that is part of a larger edit", () => {
    expect(plateWaiting(plate({ caption: larger }))).toBe(false);
    expect(plateCaptionOnly(plate({ caption: larger }))).toBe(true);
    expect(plateCaptionOnly(plate({ caption: "The change is part of a larger edit to src/a.ts." }))).toBe(true);
  });

  it("is false once the plate has lines", () => {
    expect(plateWaiting(plate({ lines: [{ kind: "add", text: "x", newNo: 1 }] }))).toBe(false);
  });
});

describe("PlatePage", () => {
  it("shows the caption alone for a plate that is part of a larger edit", () => {
    const html = page(plate({ caption: larger }));
    expect(html).toContain(larger);
    expect(html).not.toContain("still being set");
    expect(html).not.toContain("plate-frame");
  });

  it("keeps the waiting line for a plate still arriving", () => {
    const html = page(plate());
    expect(html).toContain("The plate is still being set.");
    expect(html).toContain("plate-frame");
  });

  it("sets the lines of a plate that has them", () => {
    const html = page(plate({ lines: [{ kind: "add", text: "const a = 1;", newNo: 1 }], additions: 1 }));
    expect(html).toContain("const a = 1;");
    expect(html).not.toContain("still being set");
  });
});
