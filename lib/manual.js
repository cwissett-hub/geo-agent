import { buildSystemPrompt, buildUserText, JSON_REPLY_RULES } from "./prompt.js";
import { textToResult } from "./providers/common.js";
import { PROVIDERS } from "./providers/index.js";

// The JSON schema itself is left out on purpose: chat models tend to echo it
// back or answer in its shape. The filled-in example in JSON_REPLY_RULES works
// better, and it goes last so it is the freshest instruction.
export function manualPrompt(feedbackLines, countries) {
  return [
    buildSystemPrompt(countries),
    buildUserText(feedbackLines),
    JSON_REPLY_RULES,
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
