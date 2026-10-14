import { useState } from "react";
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
          <legend>{field.title}</legend>
          {field.description ? <p className="form-desc">{field.description}</p> : null}
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

function FieldInput({ field, value, onChange }: { field: FormField; value: FormValue; onChange: (value: FormValue) => void }) {
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
      <p className="form-options">
        {(field.options ?? []).map((option) => (
          <label key={option.value} title={option.description}>
            <input
              type="checkbox"
              checked={picked.includes(option.value)}
              onChange={(event) =>
                onChange(event.target.checked ? [...picked, option.value] : picked.filter((item) => item !== option.value))
              }
            />
            {option.label}
          </label>
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
        <p className="form-options">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              title={option.description}
              aria-pressed={value === option.value}
              onClick={() => onChange(option.value)}
            >
              {option.label}
            </button>
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
