import { buildSystemPrompt, buildSchema, buildUserText } from "../prompt.js";
import { ProviderError, textToResult } from "./common.js";

export const openai = {
  id: "openai",
  label: "GPT (OpenAI)",
  defaultModel: "gpt-5",
  keyHint: "sk-...",
  // OpenAI reasoning models take reasoning_effort; shown in Settings as "Effort".
  effortOptions: ["minimal", "low", "medium", "high"],
  defaultEffort: "medium",

  buildRequest({ key, model, imageDataUrl, feedbackLines, effort, countries }) {
    const body = {
      model,
      ...(effort ? { reasoning_effort: effort } : {}),
      // GPT-5 models take verbosity; low keeps the JSON strings short, which
      // is most of the wait. Other models would reject the parameter.
      ...(/^gpt-5/.test(model) ? { verbosity: "low" } : {}),
      messages: [
        { role: "system", content: buildSystemPrompt(countries) },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: imageDataUrl } },
            { type: "text", text: buildUserText(feedbackLines) },
          ],
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "round_result", strict: true, schema: buildSchema(countries) },
      },
      max_completion_tokens: 16000,
    };
    return {
      url: "https://api.openai.com/v1/chat/completions",
      init: {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
      },
    };
  },

  parseResponse(json) {
    const choice = json.choices && json.choices[0];
    if (!choice || !choice.message) {
      throw new ProviderError("unparseable", "No choices in response", { raw: JSON.stringify(json) });
    }
    if (choice.message.refusal) {
      throw new ProviderError("refusal", `Model declined: ${choice.message.refusal}`);
    }
    return textToResult(choice.message.content);
  },
};
