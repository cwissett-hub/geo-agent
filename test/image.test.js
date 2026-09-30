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

import { stackLayout, STACK_GAP } from "../lib/image.js";

test("stackLayout puts one car view under the main shot at full width", () => {
  const L = stackLayout({ width: 1000, height: 500 }, [{ width: 2000, height: 1000 }]);
  assert.equal(L.width, 1000);
  assert.deepEqual(L.top, { x: 0, y: 0, w: 1000, h: 500 });
  assert.deepEqual(L.bottoms, [{ x: 0, y: 500 + STACK_GAP, w: 1000, h: 500 }]);
  assert.equal(L.height, 1000 + STACK_GAP);
});

test("stackLayout puts front and back side by side, half width each", () => {
  const L = stackLayout({ width: 1000, height: 500 }, [{ width: 1000, height: 500 }, { width: 1000, height: 500 }]);
  const [f, b] = L.bottoms;
  const cell = (1000 - STACK_GAP) / 2;
  assert.equal(f.x, 0);
  assert.equal(f.w, Math.round(cell));
  assert.equal(b.x, Math.round(cell + STACK_GAP));
  assert.equal(f.y, b.y);
  assert.ok(b.x + b.w <= L.width);
  assert.equal(L.height, Math.round(500 + STACK_GAP + cell / 2));
});

test("stackLayout fits the whole stack within the max edge", () => {
  const L = stackLayout({ width: 1600, height: 900 }, [{ width: 1600, height: 900 }], 1600);
  assert.equal(L.height, 1600);
  assert.ok(L.width < 1600);
  assert.ok(L.bottoms[0].y + L.bottoms[0].h <= L.height);
});
