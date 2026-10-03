function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));
}

function fingerExtended(landmarks, tipIndex, pipIndex) {
  const wrist = landmarks[0];
  return distance(landmarks[tipIndex], wrist) > distance(landmarks[pipIndex], wrist) * 1.16;
}

export function analyzeHand(landmarks) {
  if (!landmarks || landmarks.length < 21) {
    return { gesture: "none", openness: 0, pinchRatio: 1, palmWidth: 0, extendedCount: 0 };
  }

  const palmWidth = distance(landmarks[5], landmarks[17]) || 0.1;
  const extended = [
    distance(landmarks[4], landmarks[0]) > distance(landmarks[3], landmarks[0]) * 1.08,
    fingerExtended(landmarks, 8, 6),
    fingerExtended(landmarks, 12, 10),
    fingerExtended(landmarks, 16, 14),
    fingerExtended(landmarks, 20, 18),
  ];
  const extendedCount = extended.filter(Boolean).length;
  const coreExtendedCount = extended.slice(1).filter(Boolean).length;
  const pinchRatio = distance(landmarks[4], landmarks[8]) / palmWidth;
  const openness = extendedCount / 5;
  const pointing = extended[1] && !extended[2] && !extended[3] && !extended[4];

  let gesture = "neutral";
  if (pinchRatio < 0.34) gesture = "pinch";
  else if (coreExtendedCount === 0) gesture = "fist";
  else if (pointing) gesture = "point";
  else if (extendedCount >= 4) gesture = "open";

  return { gesture, openness, pinchRatio, palmWidth, extendedCount, coreExtendedCount, pointing };
}

export class HandModeTracker {
  constructor({ pinchOn = 0.36, pinchOff = 0.54, stableFrames = 2 } = {}) {
    this.pinchOn = pinchOn;
    this.pinchOff = pinchOff;
    this.stableFrames = stableFrames;
    this.pinching = false;
    this.current = "neutral";
    this.candidate = "neutral";
    this.candidateFrames = 0;
  }

  update(metrics) {
    if (metrics.gesture === "fist") {
      this.pinching = false;
      this.current = "fist";
      return "fist";
    }
    this.pinching = this.pinching ? metrics.pinchRatio < this.pinchOff : metrics.pinchRatio < this.pinchOn;
    if (this.pinching) {
      this.current = "pinch";
      return "pinch";
    }
    const next = metrics.gesture === "pinch" ? "neutral" : metrics.gesture;
    if (next !== this.candidate) {
      this.candidate = next;
      this.candidateFrames = 1;
    } else {
      this.candidateFrames += 1;
    }
    if (this.candidateFrames >= this.stableFrames) this.current = next;
    return this.current;
  }

  reset() {
    this.pinching = false;
    this.current = "neutral";
    this.candidate = "neutral";
    this.candidateFrames = 0;
  }
}

class OneEuroValue {
  constructor({ minCutoff = 1.1, beta = 0.018, derivativeCutoff = 1 } = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.derivativeCutoff = derivativeCutoff;
    this.value = null;
    this.derivative = 0;
    this.time = null;
  }

  alpha(cutoff, deltaSeconds) {
    const tau = 1 / (Math.PI * 2 * cutoff);
    return 1 / (1 + tau / deltaSeconds);
  }

  filter(value, time) {
    if (this.value === null || this.time === null) {
      this.value = value;
      this.time = time;
      return value;
    }
    const deltaSeconds = Math.min(0.1, Math.max(1 / 240, (time - this.time) / 1000));
    const rawDerivative = (value - this.value) / deltaSeconds;
    const derivativeAlpha = this.alpha(this.derivativeCutoff, deltaSeconds);
    this.derivative += (rawDerivative - this.derivative) * derivativeAlpha;
    const cutoff = this.minCutoff + this.beta * Math.abs(this.derivative);
    this.value += (value - this.value) * this.alpha(cutoff, deltaSeconds);
    this.time = time;
    return this.value;
  }

  reset() {
    this.value = null;
    this.derivative = 0;
    this.time = null;
  }
}

export class OneEuroPointFilter {
  constructor(options) {
    this.x = new OneEuroValue(options);
    this.y = new OneEuroValue(options);
  }

  filter(point, time) {
    return { x: this.x.filter(point.x, time), y: this.y.filter(point.y, time) };
  }

  reset() {
    this.x.reset();
    this.y.reset();
  }
}

export function calculatePoseMotion(observations, lastCenterX, elapsedMs) {
  if (!observations.length) {
    return { centerX: 0.5, centerY: 0.5, legSwing: 0, bodyLean: 0, motionEnergy: 0 };
  }
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const centerX = observations.reduce((sum, hand) => sum + hand.handX, 0) / observations.length;
  const centerY = observations.reduce((sum, hand) => sum + hand.handY, 0) / observations.length;
  const elapsedSeconds = Math.max(1 / 120, elapsedMs / 1000);
  const horizontalVelocity = clamp((centerX - lastCenterX) / elapsedSeconds, -2.4, 2.4);
  const ordered = [...observations].sort((a, b) => a.handX - b.handX);
  const heightDifference = ordered.length > 1 ? ordered[0].handY - ordered.at(-1).handY : 0;
  return {
    centerX,
    centerY,
    legSwing: clamp(horizontalVelocity * 0.42 + heightDifference * 1.05, -1, 1),
    bodyLean: clamp((centerX - 0.5) * 0.68 + horizontalVelocity * 0.08, -0.42, 0.42),
    motionEnergy: clamp(Math.abs(horizontalVelocity) * 0.7 + Math.abs(heightDifference) * 0.8, 0, 1),
  };
}

export function resolveHandAction(observations) {
  const pinchCount = observations.filter((item) => item.mode === "pinch").length;
  if (pinchCount > 1) return "dual-pinch";
  if (pinchCount === 1) return "pinch";
  if (observations.some((item) => item.mode === "point")) return "point";
  if (observations.some((item) => item.mode === "open")) return "open";
  if (observations.some((item) => item.mode === "fist")) return "fist";
  return observations.length ? "pose" : "neutral";
}

export class SwipeTracker {
  constructor({ windowMs = 260, threshold = 0.18, cooldownMs = 850 } = {}) {
    this.windowMs = windowMs;
    this.threshold = threshold;
    this.cooldownMs = cooldownMs;
    this.samples = [];
    this.lastSwipeAt = -Infinity;
  }

  update(x, time) {
    this.samples.push({ x, time });
    this.samples = this.samples.filter((sample) => time - sample.time <= this.windowMs);
    if (time - this.lastSwipeAt < this.cooldownMs || this.samples.length < 3) return 0;
    const delta = x - this.samples[0].x;
    if (Math.abs(delta) < this.threshold) return 0;
    this.lastSwipeAt = time;
    this.samples = [{ x, time }];
    return delta > 0 ? 1 : -1;
  }

  reset() {
    this.samples = [];
  }
}
