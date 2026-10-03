import assert from "node:assert/strict";
import {
  analyzeHand,
  calculatePoseMotion,
  HandModeTracker,
  OneEuroPointFilter,
  resolveHandAction,
  SwipeTracker,
} from "../gesture-logic.mjs";

function hand(type) {
  const points = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  points[0] = { x: 0.5, y: 0.82, z: 0 };
  points[5] = { x: 0.38, y: 0.58, z: 0 };
  points[17] = { x: 0.62, y: 0.58, z: 0 };
  const fingers = [[4, 3, 0.31], [8, 6, 0.4], [12, 10, 0.48], [16, 14, 0.56], [20, 18, 0.64]];

  for (const [tip, pip, x] of fingers) {
    const folded = type === "fist" || type === "closedPinch" || (type === "point" && tip !== 8);
    points[pip] = { x, y: folded ? 0.62 : 0.5, z: 0 };
    points[tip] = { x, y: folded ? 0.66 : 0.2, z: 0 };
  }
  if (type === "pinch" || type === "closedPinch") points[4] = { ...points[8], x: points[8].x + 0.025 };
  return points;
}

assert.equal(analyzeHand(hand("open")).gesture, "open");
assert.equal(analyzeHand(hand("fist")).gesture, "fist");
assert.equal(analyzeHand(hand("pinch")).gesture, "pinch");
assert.equal(analyzeHand(hand("closedPinch")).gesture, "pinch");
assert.equal(analyzeHand(hand("point")).gesture, "point");

const swipe = new SwipeTracker();
assert.equal(swipe.update(0.25, 0), 0);
assert.equal(swipe.update(0.34, 100), 0);
assert.equal(swipe.update(0.52, 190), 1);

const pinch = new HandModeTracker({ stableFrames: 1 });
assert.equal(pinch.update({ gesture: "neutral", pinchRatio: 0.34 }), "pinch");
assert.equal(pinch.update({ gesture: "neutral", pinchRatio: 0.48 }), "pinch");
assert.equal(pinch.update({ gesture: "neutral", pinchRatio: 0.56 }), "neutral");

const filter = new OneEuroPointFilter();
assert.deepEqual(filter.filter({ x: 0.2, y: 0.4 }, 0), { x: 0.2, y: 0.4 });
const filtered = filter.filter({ x: 0.8, y: 0.9 }, 16);
assert.ok(filtered.x > 0.2 && filtered.x < 0.8);

const stillPose = calculatePoseMotion([{ handX: 0.5, handY: 0.5 }], 0.5, 50);
assert.equal(stillPose.motionEnergy, 0);
const movingPose = calculatePoseMotion([
  { handX: 0.72, handY: 0.72 },
  { handX: 0.28, handY: 0.3 },
], 0.35, 50);
assert.ok(Math.abs(movingPose.legSwing) > 0.2);
assert.ok(movingPose.motionEnergy > 0.5);

assert.equal(resolveHandAction([{ mode: "open" }]), "open");
assert.equal(resolveHandAction([{ mode: "fist" }]), "fist");
assert.equal(resolveHandAction([{ mode: "point" }]), "point");
assert.equal(resolveHandAction([{ mode: "open" }, { mode: "pinch" }]), "pinch");
assert.equal(resolveHandAction([{ mode: "pinch" }, { mode: "pinch" }]), "dual-pinch");

console.log("gesture-logic: poses, priorities, pinch hysteresis, filters, swipe passed");
