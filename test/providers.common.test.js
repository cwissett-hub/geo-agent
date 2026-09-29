import { test } from "node:test";
import assert from "node:assert/strict";
import { ProviderError, splitDataUrl, mapHttpError, parseJsonText } from "../lib/providers/common.js";

test("splitDataUrl separates media type and payload", () => {
  assert.deepEqual(splitDataUrl("data:image/png;base64,AAAA"), { mediaType: "image/png", base64: "AAAA" });
});

test("splitDataUrl rejects non data urls", () => {
  assert.throws(() => splitDataUrl("https://x/y.png"), (e) => e instanceof ProviderError && e.code === "unparseable");
});

test("mapHttpError maps status codes", () => {
  assert.equal(mapHttpError(401, "").code, "key_rejected");
  assert.equal(mapHttpError(403, "").code, "key_rejected");
  assert.equal(mapHttpError(429, "").code, "rate_limited");
  assert.equal(mapHttpError(500, "boom").code, "server");
  assert.equal(mapHttpError(400, "bad").code, "server");
  assert.equal(mapHttpError(500, "boom").raw, "boom");
});

test("parseJsonText parses plain and fenced json", () => {
  assert.deepEqual(parseJsonText('{"a":1}'), { a: 1 });
  assert.deepEqual(parseJsonText('```json\n{"a":1}\n```'), { a: 1 });
});

test("parseJsonText throws unparseable with raw text", () => {
  assert.throws(() => parseJsonText("not json"), (e) => e.code === "unparseable" && e.raw === "not json");
});
