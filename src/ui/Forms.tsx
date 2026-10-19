import { useId, useState, type ReactNode } from "react";
import { toProse } from "../book/emphasis";
import { formAnswer, type FormReply, type FormValue, type FormValues } from "../book/forms";
import type { Form, FormField } from "../book/model";

/**
 * A question from the press, set at the foot of the left page like an ask:
 * each field's title and description, then options as words to choose, a
 * line to write on, a yes or no, or boxes to tick. "Send" answers; "Skip"
 * sets the question aside.
 */
export function FormView({ form, onSend, onSkip }: { form: Form; onSend: (answer: FormReply) => void; onSkip: () => void }) {
  const [values, setValues] = useState<FormValues>({});
  const { answer, complete } = formAnswer(form, values);
  const set = (key: string, value: FormValue) => setValues((current) => ({ ...current, [key]: value }));

  return (
    <form
      className="ask-form"
      aria-label={form.title}
      onSubmit={(event) => {
        event.preventDefault();
        if (complete) onSend(answer);
      }}
    >
      {form.fields.map((field) => (
        <fieldset key={field.key} className="form-field">
          <legend>
            <Inline text={field.title} />
          </legend>
          {field.description ? (
            <p className="form-desc">
              <Inline text={field.description} />
            </p>
          ) : null}
          <FieldInput field={field} value={values[field.key]} onChange={(value) => set(field.key, value)} />
        </fieldset>
      ))}
      <p className="form-actions">
        <button type="submit" disabled={!complete}>
          Send
        </button>
        <span className="dot">·</span>
        <button type="button" className="quiet" onClick={onSkip}>
          Skip
        </button>
      </p>
    </form>
  );
}

/** The press writes Markdown: `code` and *emphasis* are set in italics, as on the page, never shown raw. */
function Inline({ text }: { text: string }) {
  const { text: plain, italics } = toProse(text);
  const out: ReactNode[] = [];
  let at = 0;
  for (const [from, to] of italics) {
    if (from > at) out.push(plain.slice(at, from));
    out.push(<em key={from}>{plain.slice(from, to)}</em>);
    at = to;
  }
  if (at < plain.length) out.push(plain.slice(at));
  return <>{out}</>;
}

function FieldInput({ field, value, onChange }: { field: FormField; value: FormValue; onChange: (value: FormValue) => void }) {
  const descBase = useId();
  // With any option described, the options stand one above another, each with its quiet line beneath.
  const described = (field.options ?? []).some((option) => option.description);
  const optionsClass = described ? "form-options described" : "form-options";
  const descId = (index: number) => `${descBase}-${index}`;
  const desc = (description: string | undefined, index: number) =>
    description ? (
      <span className="form-option-desc" id={descId(index)}>
        <Inline text={description} />
      </span>
    ) : null;
  if (field.type === "boolean") {
    return (
      <p className="form-options">
        {[true, false].map((choice) => (
          <button key={String(choice)} type="button" aria-pressed={value === choice} onClick={() => onChange(choice)}>
            {choice ? "Yes" : "No"}
          </button>
        ))}
      </p>
    );
  }
  if (field.type === "multiselect") {
    const picked = Array.isArray(value) ? value : [];
    return (
      <p className={optionsClass}>
        {(field.options ?? []).map((option, index) => (
          <span key={option.value} className="form-option">
            <label>
              <input
                type="checkbox"
                aria-describedby={option.description ? descId(index) : undefined}
                checked={picked.includes(option.value)}
                onChange={(event) =>
                  onChange(event.target.checked ? [...picked, option.value] : picked.filter((item) => item !== option.value))
                }
              />
              <Inline text={option.label} />
            </label>
            {desc(option.description, index)}
          </span>
        ))}
      </p>
    );
  }
  if (field.type === "number" || field.type === "integer") {
    return (
      <input
        className="form-line"
        type="number"
        step={field.type === "integer" ? 1 : "any"}
        min={field.min}
        max={field.max}
        aria-label={field.title}
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  if (field.type === "external") return null;
  const options = field.options ?? [];
  const chosen = options.some((option) => option.value === value);
  return (
    <>
      {options.length ? (
        <p className={optionsClass}>
          {options.map((option, index) => (
            <span key={option.value} className="form-option">
              <button
                type="button"
                aria-pressed={value === option.value}
                aria-describedby={option.description ? descId(index) : undefined}
                onClick={() => onChange(option.value)}
              >
                <Inline text={option.label} />
              </button>
              {desc(option.description, index)}
            </span>
          ))}
        </p>
      ) : null}
      {field.custom || !options.length ? (
        <input
          className="form-line"
          aria-label={options.length ? `${field.title}, in your own words` : field.title}
          placeholder={options.length ? "or in your own words" : "your answer"}
          value={typeof value === "string" && !chosen ? value : ""}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : null}
    </>
  );
}
