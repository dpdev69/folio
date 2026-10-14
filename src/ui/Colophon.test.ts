import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import pkg from "../../package.json";
import { BUNDLED_PRESS_VERSION, FOLIO_VERSION } from "../version";
import { Colophon } from "./Colophon";

const page = (press?: string) => renderToStaticMarkup(createElement(Colophon, { onClose: () => {}, press }));

describe("Colophon", () => {
  it("keeps the credit, the licence, the edition and the bundled press", () => {
    const html = page();
    expect(html).toContain("Powered by opencode.");
    expect(html).toContain("MIT licensed");
    expect(html).toContain(`Edition ${pkg.version}`);
    expect(html).toContain(`opencode ${pkg.opencode.version}`);
    expect(html).not.toContain("This reading is set on");
    expect(html).not.toContain("!");
  });

  it("names the press in use when it is given", () => {
    expect(page("opencode 2.0.28 · OpenCode Zen, cat-jam-free")).toContain(
      "This reading is set on opencode 2.0.28 · OpenCode Zen, cat-jam-free.",
    );
  });

  it("reads its versions from package.json", () => {
    expect(FOLIO_VERSION).toBe(pkg.version);
    expect(BUNDLED_PRESS_VERSION).toBe(pkg.opencode.version);
  });
});
