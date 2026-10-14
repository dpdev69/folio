import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Form } from "../book/model";
import { FormView } from "./Forms";

const render = (form: Form) => renderToStaticMarkup(createElement(FormView, { form, onSend: () => {}, onSkip: () => {} }));

// The shape of the replay press's question (src/book/__fixtures__/aux-question.sse).
const question: Form = {
  id: "frm",
  title: "Questions",
  fields: [
    {
      key: "q0",
      title: "Greet language",
      description: "Which language should greet() use?",
      type: "string",
      custom: true,
      options: [
        { value: "English", label: "English", description: "Greet in English" },
        { value: "French", label: "French", description: "Greet in French" },
        { value: "Latin", label: "Latin" },
      ],
    },
  ],
};

describe("FormView", () => {
  it("sets each option's description as a quiet line beneath it", () => {
    const html = render(question);
    expect(html).toContain('class="form-options described"');
    expect(html.match(/class="form-option-desc"/g)).toHaveLength(2);
    expect(html).toMatch(/English<\/button><span class="form-option-desc" id="[^"]+">Greet in English<\/span>/);
    expect(html).toMatch(/Latin<\/button><\/span>/);
    expect(html).not.toContain("title=");
  });

  it("ties a described option to its line for assistive reading", () => {
    const html = render(question);
    const id = html.match(/<span class="form-option-desc" id="([^"]+)">Greet in French/)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`aria-describedby="${id}"`);
  });

  it("describes ticked options too", () => {
    const html = render({
      ...question,
      fields: [{ ...question.fields[0], type: "multiselect", custom: false }],
    });
    expect(html).toContain('type="checkbox"');
    expect(html).toMatch(/French<\/label><span class="form-option-desc" id="[^"]+">Greet in French<\/span>/);
  });

  it("keeps options without descriptions in one centred row", () => {
    const html = render({
      ...question,
      fields: [{ ...question.fields[0], options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] }],
    });
    expect(html).toContain('class="form-options"');
    expect(html).not.toContain("described");
    expect(html).not.toContain("form-option-desc");
  });
});
