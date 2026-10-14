import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  FOOT_LEADING,
  FOOT_LINE,
  FOOT_NOTE_GAP,
  FOOT_OVERHEAD,
  FOOT_RULE,
  FOOT_RULE_MARGIN,
  FOOT_RULE_PAD,
  FOOT_SIZE,
  HINT_FONT,
  HINT_GAP,
  HINT_LINE,
  ORNAMENT_ABOVE,
  ORNAMENT_BELOW,
  ORNAMENT_HEIGHT,
  QUILL_FONT,
  QUILL_HEIGHT,
  QUILL_LEADING,
  QUILL_PAD,
  QUILL_ROWS,
  QUILL_TOP,
  STACKED_WIDTH,
  DESK_OVERHEAD,
  DESK_SIDES,
  BOOK_MAX_WIDTH,
  FOLIO_LINE,
  FOLIO_PAD,
  GAP_LINE,
  INK_LEADING,
  RUNNING_GAP,
  SHEET_PAD_BOTTOM,
  SHEET_PAD_TOP,
  SHEET_RATIO,
  SLIP_AFTER_NOTES,
  SLIP_ALONE,
} from "../src/ui/scales.ts";

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");

/** The declarations of the first rule with exactly this selector. */
function rule(css, selector) {
  const escaped = selector.replace(/[.]/g, "\\.");
  const match = css.match(new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`));
  expect(match, selector).not.toBeNull();
  return match[1];
}

// scales.ts counts a page's prose lines from these pixels; a change to the CSS must change them too.
describe("the page's pixels in scales.ts", () => {
  const css = read("src/styles.css");

  it("keep the running head and the hint to one line, as the page counts them", () => {
    expect(rule(css, ".running")).toContain("white-space: nowrap; overflow: hidden; text-overflow: ellipsis;");
    // The hint's words give way to an ellipsis; the stop link beside them never does.
    expect(rule(css, ".hint")).toContain("display: flex; justify-content: center;");
    expect(rule(css, ".hint-text")).toContain("min-width: 0; white-space: pre; overflow: hidden; text-overflow: ellipsis;");
    expect(rule(css, ".hint-button")).toContain("flex: none;");
  });

  it("lay asks and questions over the prose, just above the folio", () => {
    const over = css.match(/\.foot:has\(\.ask, \.ask-form\) \{([^}]*)\}/);
    expect(over).not.toBeNull();
    expect(over[1]).toContain(`bottom: ${SHEET_PAD_BOTTOM + FOLIO_PAD + FOLIO_LINE}px;`);
    expect(over[1]).toContain("position: absolute;");
    expect(css).toContain(".foot:has(.ask-form) { max-height: 62%; overflow: auto; }");
  });

  it("match the sheet's padding, the running head's margin and the folio's padding", () => {
    expect(rule(css, ".sheet")).toContain(`padding: ${SHEET_PAD_TOP}px var(--margin-x) ${SHEET_PAD_BOTTOM}px;`);
    expect(rule(css, ".running")).toContain(`margin: 0 0 ${RUNNING_GAP}px;`);
    expect(rule(css, ".running")).toContain("font-size: 12.5px;");
    expect(rule(css, ".folio-num")).toContain(`padding-top: ${FOLIO_PAD}px;`);
    expect(rule(css, ".folio-num")).toContain("font-size: 14px;");
  });

  it("match the book's height rule", () => {
    expect(rule(css, ".book")).toContain(
      `height: min(calc(100vh - ${DESK_OVERHEAD}px), calc(min(${BOOK_MAX_WIDTH}px, 100vw - ${DESK_SIDES}px) / 2 * ${SHEET_RATIO}));`,
    );
    expect(rule(css, ".book")).toContain(`width: min(${BOOK_MAX_WIDTH}px, calc(100vw - ${DESK_SIDES}px));`);
  });

  it("match the slip, alone and below footnotes", () => {
    expect(SLIP_ALONE).toBeCloseTo(8 + 6 + 1 + 15 * 1.35);
    expect(SLIP_AFTER_NOTES).toBeCloseTo(3 + 15 * 1.35);
    expect(rule(css, ".slip")).toContain("margin: 8px 0 0; padding: 6px 0 0; border-top: 1px solid var(--rule);");
    expect(rule(css, ".slip")).toContain("font-size: 15px; line-height: 1.35;");
    expect(css).toContain(".footnotes + .slip { margin-top: 3px; padding-top: 0; border-top: 0; }");
  });

  it("match the ink line, the paragraph gap and the quill", () => {
    expect(css).toContain(`.line.ink { font-size: var(--ink-fs); height: auto; line-height: ${INK_LEADING};`);
    // The ink is drawn at the size it is measured at: the scale's inkSize.
    expect(read("src/ui/App.tsx")).toContain('["--ink-fs" as string]: `${folio.scale.inkSize}px`');
    expect(css).toContain(`.line.gap { height: calc(var(--lh) * ${GAP_LINE}); }`);
    expect(rule(css, ".quill")).toContain(`font-size: ${QUILL_FONT}px; line-height: ${QUILL_LEADING}; min-height: 72px;`);
    expect(rule(css, ".quill-block")).toContain(`margin-top: ${QUILL_TOP}px;`);
    expect(rule(css, ".ornament")).toContain(`height: ${ORNAMENT_HEIGHT}px; margin: ${ORNAMENT_ABOVE}px auto ${ORNAMENT_BELOW}px;`);
    expect(rule(css, ".hint")).toContain(`margin: ${HINT_GAP}px 0 0;`);
    expect(rule(css, ".hint")).toContain(`font-size: ${HINT_FONT}px;`);
    // The quill's height is its rows, not its min-height.
    expect(read("src/ui/Page.tsx")).toContain(`rows={${QUILL_ROWS}}`);
    expect(QUILL_HEIGHT).toBeCloseTo(
      QUILL_TOP + ORNAMENT_ABOVE + ORNAMENT_HEIGHT + ORNAMENT_BELOW + QUILL_ROWS * QUILL_FONT * QUILL_LEADING + QUILL_PAD + HINT_GAP + HINT_LINE,
    );
  });

  it("match the footnotes' rule, type and spacing", () => {
    expect(rule(css, ".footnotes")).toContain(
      `margin: ${FOOT_RULE_MARGIN}px 0 0; padding: ${FOOT_RULE_PAD}px 0 0;\n  border-top: ${FOOT_RULE}px solid var(--rule);`,
    );
    expect(rule(css, ".footnotes")).toContain(`font-size: ${FOOT_SIZE}px; line-height: ${FOOT_LEADING};`);
    expect(rule(css, ".footnotes li")).toContain(`margin: ${FOOT_NOTE_GAP}px 0;`);
    expect(FOOT_OVERHEAD).toBe(FOOT_RULE_MARGIN + FOOT_RULE_PAD + FOOT_RULE);
    expect(FOOT_LINE).toBeCloseTo(FOOT_SIZE * FOOT_LEADING);
  });

  it("match the width where the spread stacks", () => {
    expect(css).toContain(`@media (max-width: ${STACKED_WIDTH}px) {`);
    expect(css).toContain(`@media (min-width: ${STACKED_WIDTH + 1}px) {`);
  });
});
