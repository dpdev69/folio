import type { Form, FormField } from "./model";

/** What the reader has set in a field so far: typed text, a yes or no, or ticked boxes. */
export type FormValue = string | boolean | string[] | undefined;

export type FormValues = Record<string, FormValue>;

/** The body of `POST …/form/{id}/reply`: one value per answered field. */
export type FormReply = Record<string, string | number | boolean | string[]>;

/**
 * Shape the reader's values into the press's answer. A field that is empty or
 * does not fit (a number out of range, a fraction for an integer, too few or
 * too many boxes) is left out and the form is not complete. A field answered
 * outside Folio (`external`) is not asked for.
 */
export function formAnswer(form: Form, values: FormValues): { answer: FormReply; complete: boolean } {
  const answer: FormReply = {};
  let complete = true;
  for (const field of form.fields) {
    if (field.type === "external") continue;
    const value = fieldValue(field, values[field.key]);
    if (value === undefined) complete = false;
    else answer[field.key] = value;
  }
  return { answer, complete };
}

function fieldValue(field: FormField, raw: FormValue): FormReply[string] | undefined {
  switch (field.type) {
    case "boolean":
      return typeof raw === "boolean" ? raw : undefined;
    case "multiselect": {
      const picked = Array.isArray(raw) ? raw : [];
      if (picked.length < (field.min ?? 0) || picked.length > (field.max ?? Infinity)) return undefined;
      return picked;
    }
    case "number":
    case "integer": {
      const text = typeof raw === "string" ? raw.trim() : "";
      const n = text ? Number(text) : NaN;
      if (!Number.isFinite(n) || (field.type === "integer" && !Number.isInteger(n))) return undefined;
      if (n < (field.min ?? -Infinity) || n > (field.max ?? Infinity)) return undefined;
      return n;
    }
    default: {
      const text = typeof raw === "string" ? raw.trim() : "";
      return text || undefined;
    }
  }
}
