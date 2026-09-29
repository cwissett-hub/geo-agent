import { test } from "node:test";
import assert from "node:assert/strict";
import { fitWithin, MAX_EDGE } from "../lib/image.js";

test("MAX_EDGE is 1600", () => {
  assert.equal(MAX_EDGE, 1600);
});

test("image within the limit is unchanged", () => {
  assert.deepEqual(fitWithin(1200, 800), { width: 1200, height: 800, scale: 1 });
});

test("4K landscape capture is scaled to 1600 wide", () => {
  assert.deepEqual(fitWithin(3840, 2160), { width: 1600, height: 900, scale: 1600 / 3840 });
});

test("portrait capture is scaled on its long edge", () => {
  const r = fitWithin(1000, 3200);
  assert.equal(r.height, 1600);
  assert.equal(r.width, 500);
});

test("custom max edge is honoured and dimensions are integers", () => {
  const r = fitWithin(2560, 1440, 1000);
  assert.equal(r.width, 1000);
  assert.equal(r.height, 563);
  assert.ok(Number.isInteger(r.height));
});
