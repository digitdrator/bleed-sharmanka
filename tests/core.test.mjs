import test from "node:test";
import assert from "node:assert/strict";
import {
  angleForTick,
  calculateLayout,
  getBarTicks,
  getCycleTicks,
  getGridColumns,
  lcm,
  polarPoint,
  ringRadii,
  validateGeometry
} from "../core.js";

test("LCM closes the 32nd-note herta cycle over three 4/4 bars", () => {
  assert.equal(lcm(32, 6), 96);
  assert.equal(getCycleTicks({ meter: { numerator: 4, denominator: 4 }, gridId: "sixteenth", bars: "auto" }), 96);
});

test("grid columns respect meter and triplets", () => {
  assert.equal(getBarTicks({ numerator: 4, denominator: 4 }), 96);
  assert.equal(getGridColumns({ meter: { numerator: 4, denominator: 4 }, gridId: "sixteenth", bars: 1 }), 16);
  assert.equal(getGridColumns({ meter: { numerator: 4, denominator: 4 }, gridId: "triplet", bars: 1 }), 12);
});

test("dotted grids extend to a complete shared cycle", () => {
  assert.equal(getCycleTicks({ meter: { numerator: 4, denominator: 4 }, gridId: "dotted-quarter", bars: "auto" }), 288);
  assert.equal(getGridColumns({ meter: { numerator: 4, denominator: 4 }, gridId: "dotted-quarter", bars: "auto" }), 8);
});

test("circle coordinates start at top and follow direction", () => {
  const top = polarPoint(100, 100, 50, angleForTick(0, 16, 0, "clockwise"));
  const right = polarPoint(100, 100, 50, angleForTick(4, 16, 0, "clockwise"));
  const left = polarPoint(100, 100, 50, angleForTick(4, 16, 0, "counterclockwise"));
  assert.ok(Math.abs(top.x - 100) < 1e-9 && Math.abs(top.y - 50) < 1e-9);
  assert.ok(Math.abs(right.x - 150) < 1e-9 && Math.abs(right.y - 100) < 1e-9);
  assert.ok(Math.abs(left.x - 50) < 1e-9 && Math.abs(left.y - 100) < 1e-9);
});

test("layout and ring spacing stay in millimetres", () => {
  const layout = calculateLayout({ paper: "A4", orientation: "portrait", circleDiameter: 190, margin: 10 });
  assert.equal(layout.width, 210);
  assert.equal(layout.height, 297);
  assert.equal(layout.circleFits, true);
  assert.deepEqual(ringRadii({ radius: 95, ringCount: 2, ringPitch: 8 }), [81, 73]);
});

test("center dot is validated as a smaller mark", () => {
  const valid = validateGeometry({ circleDiameter: 190, margin: 10, centerHole: 6, holeDiameter: 3, centerDotDiameter: 0.8, ringCount: 2, ringPitch: 8, paper: "A4", orientation: "portrait" });
  const invalid = validateGeometry({ circleDiameter: 190, margin: 10, centerHole: 6, holeDiameter: 3, centerDotDiameter: 3, ringCount: 2, ringPitch: 8, paper: "A4", orientation: "portrait" });
  assert.equal(valid.errors.length, 0);
  assert.match(invalid.errors.join(" "), /Center dot/);
});
