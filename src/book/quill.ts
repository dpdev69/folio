/** Double Return submits. A single Return stays on the page as a line break. */
export function quillKey(value: string, key: string): { value: string; submit: string | null } {
  if (key !== "Enter") return { value, submit: null };
  if (value.endsWith("\n")) {
    const submit = value.replace(/\n+$/g, "").trim();
    if (!submit) return { value: "", submit: null };
    return { value: "", submit };
  }
  return { value: `${value}\n`, submit: null };
}
