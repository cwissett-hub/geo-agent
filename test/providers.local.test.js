import { test } from "node:test";
import assert from "node:assert/strict";
import { local, chatUrl } from "../lib/providers/local.js";
import { JSON_REPLY_RULES } from "../lib/prompt.js";

const img = "data:image/jpeg;base64,QUJD";

test("chatUrl appends the chat path once", () => {
  assert.equal(chatUrl("http://localhost:11434/v1"), "http://localhost:11434/v1/chat/completions");
  assert.equal(chatUrl("http://localhost:1234/v1/"), "http://localhost:1234/v1/chat/completions");
  assert.equal(chatUrl("http://h/v1/chat/completions"), "http://h/v1/chat/completions");
});

test("buildRequest targets the configured server with no auth header by default", () => {
  const { url, init } = local.buildRequest({ key: "", model: "qwen2.5vl:7b", baseUrl: "http://localhost:1234/v1", imageDataUrl: img, feedbackLines: [] });
  assert.equal(url, "http://localhost:1234/v1/chat/completions");
  assert.equal(init.headers.authorization, undefined);
  const body = JSON.parse(init.body);
  assert.equal(body.model, "qwen2.5vl:7b");
  assert.equal(body.messages[1].content[0].image_url.url, img);
  assert.ok(body.messages[1].content[1].text.includes(JSON_REPLY_RULES));
  assert.equal(body.response_format.type, "json_schema");
});

test("buildRequest defaults to Ollama and sends a key when given", () => {
  const { url, init } = local.buildRequest({ key: "k", model: "m", imageDataUrl: img, feedbackLines: [], countries: ["Chile"] });
  assert.equal(url, "http://localhost:11434/v1/chat/completions");
  assert.equal(init.headers.authorization, "Bearer k");
  const body = JSON.parse(init.body);
  assert.deepEqual(body.response_format.json_schema.schema.properties.guess.properties.country.enum, ["Chile"]);
});
