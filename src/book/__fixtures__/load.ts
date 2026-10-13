/// <reference types="vite/client" />
/** Recorded opencode 2.0.28 captures, read as text so tests parse them the way the app does. */
import askSse from "./fixture-ask.sse?raw";
import editSse from "./fixture-edit.sse?raw";
import editDiffJson from "./fixture-edit-diff.json?raw";
import editMessagesJson from "./fixture-edit-messages.json?raw";
import interruptSse from "./aux-interrupt.sse?raw";
import questionSse from "./aux-question.sse?raw";
import rejectSse from "./aux-reject.sse?raw";

export const captures = {
  edit: editSse,
  ask: askSse,
  question: questionSse,
  reject: rejectSse,
  interrupt: interruptSse,
};

/** The directory every capture's session was bound to. */
export const FIXTURE_DIRECTORY =
  "/private/tmp/claude-501/-Users-me-folio/e9197d91-01d7-4355-b22f-541229eaf5c7/scratchpad/v2/repo";

/** `GET /api/session/{id}/message`, as recorded (newest first). */
export const editMessages = (JSON.parse(editMessagesJson) as { data: unknown[] }).data;

/** `GET /api/session/{id}/diff`, as recorded. */
export const editDiff = (JSON.parse(editDiffJson) as { data: { file: string; patch: string; status: string }[] }).data;
