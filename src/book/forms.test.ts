import { describe, expect, it } from "vitest";
import { applyEvent, type Frame } from "./events";
import { formAnswer } from "./forms";
import type { Book, Form } from "./model";
import { pushSse, unwrapEvent } from "../engine/sse";
import { captures, FIXTURE_DIRECTORY } from "./__fixtures__/load";

/** The form the question capture sets out: one string field, two options, custom allowed. */
function recorded(): Form {
  const shelf: Book = { id: "repo", title: "repo", directory: FIXTURE_DIRECTORY, sample: false, chapters: [] };
  let book = shelf;
  for (const frame of pushSse("", captures.question).events.map(unwrapEvent) as Frame[]) {
    book = applyEvent(book, frame);
    if (frame.type === "form.created") break;
  }
  return book.chapters[0].forms[0];
}

const form = (fields: Form["fields"]): Form => ({ id: "frm_1", title: "Questions", fields });

describe("formAnswer", () => {
  it("answers the recorded question with a chosen option or the reader's own words", () => {
    const question = recorded();
    expect(formAnswer(question, { q0: "French" })).toEqual({ answer: { q0: "French" }, complete: true });
    expect(formAnswer(question, { q0: "  Spanish " })).toEqual({ answer: { q0: "Spanish" }, complete: true });
    expect(formAnswer(question, {})).toEqual({ answer: {}, complete: false });
    expect(formAnswer(question, { q0: "   " }).complete).toBe(false);
  });

  it("reads numbers from the field's text and holds back one that does not fit", () => {
    const fields = form([
      { key: "n", title: "Retries", type: "number", min: 0, max: 10 },
      { key: "i", title: "Workers", type: "integer" },
    ]);
    expect(formAnswer(fields, { n: "2.5", i: "4" })).toEqual({ answer: { n: 2.5, i: 4 }, complete: true });
    expect(formAnswer(fields, { n: "11", i: "4" }).complete).toBe(false);
    expect(formAnswer(fields, { n: "1", i: "2.5" })).toEqual({ answer: { n: 1 }, complete: false });
    expect(formAnswer(fields, { n: "many", i: "" }).complete).toBe(false);
  });

  it("keeps a no as an answer", () => {
    const fields = form([{ key: "b", title: "Keep the old name?", type: "boolean" }]);
    expect(formAnswer(fields, { b: false })).toEqual({ answer: { b: false }, complete: true });
    expect(formAnswer(fields, {}).complete).toBe(false);
  });

  it("answers a multiselect with the boxes ticked, within its bounds", () => {
    const options = ["a", "b", "c"].map((value) => ({ value, label: value.toUpperCase() }));
    const fields = form([{ key: "m", title: "Which files?", type: "multiselect", options, min: 1, max: 2 }]);
    expect(formAnswer(fields, { m: ["a", "c"] })).toEqual({ answer: { m: ["a", "c"] }, complete: true });
    expect(formAnswer(fields, { m: [] }).complete).toBe(false);
    expect(formAnswer(fields, { m: ["a", "b", "c"] }).complete).toBe(false);
    const open = form([{ key: "m", title: "Any?", type: "multiselect", options }]);
    expect(formAnswer(open, {})).toEqual({ answer: { m: [] }, complete: true });
  });

  it("leaves out a field answered elsewhere", () => {
    const fields = form([
      { key: "x", title: "Sign in at the provider", type: "external" },
      { key: "s", title: "Name", type: "string" },
    ]);
    expect(formAnswer(fields, { s: "Ada" })).toEqual({ answer: { s: "Ada" }, complete: true });
  });
});
