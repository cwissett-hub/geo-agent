import { SYSTEM_PROMPT, RESULT_SCHEMA, buildUserText } from "./prompt.js";
import { textToResult } from "./providers/common.js";
import { PROVIDERS } from "./providers/index.js";

export function manualPrompt(feedbackLines) {
  return [
    SYSTEM_PROMPT,
    buildUserText(feedbackLines),
    "Reply with ONLY a JSON object matching this schema, no prose and no code fence:",
    JSON.stringify(RESULT_SCHEMA),
  ].join("\n\n");
}

export function parsePastedReply(text) {
  return textToResult(text);
}

export function manualResultEntry(result) {
  return { provider: "manual", model: "pasted", result, error: null };
}

export function providerLabel(id) {
  const p = PROVIDERS[id];
  return p ? p.label : "Manual paste";
}
