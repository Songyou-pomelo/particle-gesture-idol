import * as THREE from "three";
import {
  analyzeHand,
  calculatePoseMotion,
  HandModeTracker,
  OneEuroPointFilter,
  resolveHandAction,
  SwipeTracker,
} from "./gesture-logic.mjs";

const canvas = document.querySelector("#particleCanvas");
const video = document.querySelector("#cameraFeed");
const gestureButton = document.querySelector("#gestureButton");
const recordButton = document.querySelector("#recordButton");
const cameraToggle = document.querySelector("#cameraToggle");
const status = document.querySelector("#status");
const statusText = document.querySelector("#statusText");
const cameraNotice = document.querySelector("#cameraNotice");
const handCursors = [document.querySelector("#handCursorA"), document.querySelector("#handCursorB")];
const imageUpload = document.querySelector("#imageUpload");
const resetButton = document.querySelector("#resetButton");
const togglePanel = document.querySelector("#togglePanel");
const controlPanel = document.querySelector(".control-panel");
const sensitivity = document.querySelector("#sensitivity");
const sensitivityValue = document.querySelector("#sensitivityValue");

const isMobile = matchMedia("(max-width: 700px)").matches;
const particleCount = isMobile ? 7000 : 14000;
const maxPixelRatio = isMobile ? 1 : 1.2;
const shapeOrder = ["form", "heart", "orbitCena", "orbitM104", "orbit4258", "orbit4725"];
const galaxyShapeNames = new Set(shapeOrder.slice(2));

function showNotice(message, isError = false) {
  cameraNotice.textContent = message;
  cameraNotice.classList.add("visible");
  cameraNotice.classList.toggle("error", isError);
}

function hideNotice() {
  cameraNotice.classList.remove("visible", "error");
  cameraNotice.textContent = "";
}

const state = {
  shape: "form",
  morphStart: performance.now(),
  morphDuration: 920,
  scatter: 0.08,
  targetScatter: 0.08,
  pointerX: 0,
  pointerY: 0,
  targetPointerX: 0,
  targetPointerY: 0,
  pointerBX: 0,
  pointerBY: 0,
  targetPointerBX: 0,
  targetPointerBY: 0,
  pointerCount: 1,
  targetPointerCount: 1,
  targetGroupX: 0,
  targetGroupY: 0,
  objectScale: 1,
  targetObjectScale: 1,
  userRotationZ: 0,
  targetUserRotationZ: 0,
  userRotationX: 0,
  userRotationY: 0,
  targetUserRotationX: 0,
  targetUserRotationY: 0,
  depthTravel: 0,
  targetDepthTravel: 0,
  pointControlActive: false,
  pointCenterSince: 0,
  lastPointX: 0.5,
  lastPointY: 0.5,
  dualGrabActive: false,
  dualGrabStartDistance: 0,
  dualGrabStartScale: 1,
  dualGrabStartAngle: 0,
  dualGrabStartRotation: 0,
  singleGrabActive: false,
  singleGrabOffsetX: 0,
  singleGrabOffsetY: 0,
  pointerDown: false,
  sensitivity: 0.68,
  targetCameraZ: 4.2,
  cameraActive: false,
  cameraStarting: false,
  handVisible: false,
  handLandmarker: null,
  lastVideoTime: -1,
  lastDetectionAt: -Infinity,
  lastInteraction: performance.now(),
  activeGesture: "neutral",
  lastDominantGesture: "neutral",
  lastShapeSwitchAt: -Infinity,
  leftHandX: -0.82,
  leftHandY: -0.08,
  rightHandX: 0.82,
  rightHandY: -0.08,
  targetLeftHandX: -0.82,
  targetLeftHandY: -0.08,
  targetRightHandX: 0.82,
  targetRightHandY: -0.08,
  poseAmount: 0,
  targetPoseAmount: 0,
  legSwing: 0,
  targetLegSwing: 0,
  bodyLean: 0,
  targetBodyLean: 0,
  motionEnergy: 0,
  targetMotionEnergy: 0,
  ambientRotationZ: 0,
  lastPoseCenterX: 0.5,
  lastPoseAt: performance.now(),
  sourceImage: null,
  recorder: null,
  recordingChunks: [],
};

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
renderer.debug.onShaderError = () => showNotice("显卡无法编译粒子效果，请刷新页面", true);
renderer.setClearColor(0x030306, 1);
renderer.setPixelRatio(Math.min(devicePixelRatio, maxPixelRatio));
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x05050a, 0.1);

const camera = new THREE.PerspectiveCamera(46, innerWidth / innerHeight, 0.1, 40);
camera.position.set(0, 0, 4.2);

const particleGroup = new THREE.Group();
scene.add(particleGroup);

const vertexShader = `
  attribute vec3 aFrom;
  attribute vec3 aTo;
  attribute vec3 aNoise;
  attribute float aSeed;
  uniform float uTime;
  uniform float uMorph;
  uniform float uScatter;
  uniform float uBlast;
  uniform float uPointSize;
  uniform float uPixelRatio;
  uniform vec2 uPointerA;
  uniform vec2 uPointerB;
  uniform float uPointerCount;
  uniform float uShape;
  uniform vec2 uLeftHand;
  uniform vec2 uRightHand;
  uniform float uPoseAmount;
  uniform float uLegSwing;
  uniform float uBodyLean;
  uniform float uMotionEnergy;
  uniform float uDepthTravel;
  varying float vAlpha;
  varying float vHue;
  varying float vCore;

  float ease(float t) {
    return t * t * (3.0 - 2.0 * t);
  }

  mat2 rotate2d(float angle) {
    float c = cos(angle);
    float s = sin(angle);
    return mat2(c, -s, s, c);
  }

  void main() {
    float morph = ease(clamp(uMorph, 0.0, 1.0));
    vec3 base = mix(aFrom, aTo, morph);
    vec3 direction = normalize(aNoise + vec3(0.0001));
    float pulse = sin(uTime * 1.65 + aSeed * 18.0) * 0.5 + 0.5;
    float breath = 1.0 + sin(uTime * 1.08) * 0.022;
    vec3 transformed = base * breath;

    if (uShape < 0.5 && uPoseAmount > 0.001) {
      vec2 posed = transformed.xy;
      vec2 leftShoulder = vec2(-0.24, 0.48);
      vec2 rightShoulder = vec2(0.24, 0.48);
      vec2 leftRest = vec2(-0.82, -0.08);
      vec2 rightRest = vec2(0.82, -0.08);

      float leftArm = smoothstep(0.1, 0.36, -base.x) * smoothstep(-0.62, -0.22, base.y) * (1.0 - smoothstep(0.6, 0.8, base.y));
      float rightArm = smoothstep(0.1, 0.36, base.x) * smoothstep(-0.62, -0.22, base.y) * (1.0 - smoothstep(0.6, 0.8, base.y));
      float leftAngle = atan(uLeftHand.y - leftShoulder.y, uLeftHand.x - leftShoulder.x) - atan(leftRest.y - leftShoulder.y, leftRest.x - leftShoulder.x);
      float rightAngle = atan(uRightHand.y - rightShoulder.y, uRightHand.x - rightShoulder.x) - atan(rightRest.y - rightShoulder.y, rightRest.x - rightShoulder.x);
      float leftReach = clamp(length(uLeftHand - leftShoulder) / length(leftRest - leftShoulder), 0.78, 1.32);
      float rightReach = clamp(length(uRightHand - rightShoulder) / length(rightRest - rightShoulder), 0.78, 1.32);
      vec2 leftPos = leftShoulder + rotate2d(leftAngle) * (posed - leftShoulder) * leftReach;
      vec2 rightPos = rightShoulder + rotate2d(rightAngle) * (posed - rightShoulder) * rightReach;
      posed = mix(posed, leftPos, leftArm * uPoseAmount);
      posed = mix(posed, rightPos, rightArm * uPoseAmount);

      float lowerBody = smoothstep(0.16, 0.74, -base.y);
      float leftLeg = lowerBody * smoothstep(0.02, 0.2, -base.x);
      float rightLeg = lowerBody * smoothstep(0.02, 0.2, base.x);
      vec2 leftHip = vec2(-0.13, -0.23);
      vec2 rightHip = vec2(0.13, -0.23);
      vec2 leftFoot = leftHip + rotate2d(uLegSwing * 0.68) * (posed - leftHip);
      vec2 rightFoot = rightHip + rotate2d(-uLegSwing * 0.68) * (posed - rightHip);
      posed = mix(posed, leftFoot, leftLeg * uPoseAmount);
      posed = mix(posed, rightFoot, rightLeg * uPoseAmount);
      float upperBody = smoothstep(-0.5, 0.56, base.y);
      posed.x += uBodyLean * upperBody * uPoseAmount;
      posed.y += abs(sin(uTime * 7.0)) * uMotionEnergy * 0.075 * (1.0 - lowerBody * 0.55);
      float headMask = smoothstep(0.62, 0.82, base.y);
      vec2 neck = vec2(0.0, 0.58);
      vec2 headPos = neck + rotate2d(-uBodyLean * 1.9 + uLegSwing * 0.12) * (posed - neck);
      posed = mix(posed, headPos, headMask * uPoseAmount);
      transformed.xy = posed;
    }

    if (uShape > 1.5) {
      float ringLayer = floor(aSeed * 5.0);
      float depthSpin = uDepthTravel * (0.42 + ringLayer * 0.075);
      transformed.xy = rotate2d(depthSpin) * transformed.xy;
      transformed.z += (aSeed - 0.5) * 1.55 * uDepthTravel;
      transformed.xy *= 1.0 + uDepthTravel * (0.08 + fract(aSeed * 17.0) * 0.18);
    }

    float fieldAmount = smoothstep(0.16, 0.62, uScatter);
    float fieldRadius = pow(aSeed, 1.45) * (0.56 + uScatter * 2.25);
    vec3 fieldPosition = direction * fieldRadius;
    float fieldSpin = uTime * (0.18 + 0.62 / (0.28 + fieldRadius));
    fieldPosition.xy = rotate2d(fieldSpin) * fieldPosition.xy;
    fieldPosition.xy += vec2(-fieldPosition.y, fieldPosition.x) * sin(uTime * 1.8 + aSeed * 31.0) * uScatter * 0.055;
    transformed = mix(transformed, fieldPosition, fieldAmount);

    float scatterCurve = uScatter * uScatter;
    transformed += direction * scatterCurve * (0.16 + pulse * 0.22 + abs(base.z) * 0.12);
    transformed += direction * uBlast * (0.2 + fract(aSeed * 91.7)) * 2.4;
    transformed.z += sin(aSeed * 31.0 + uTime * 2.3) * (0.012 + uScatter * 0.045);

    vec2 deltaA = transformed.xy - uPointerA;
    float influenceA = smoothstep(0.8, 0.0, length(deltaA)) * step(0.5, uPointerCount);
    transformed.xy += normalize(deltaA + vec2(0.0001)) * influenceA * (0.1 + uMotionEnergy * 0.08);
    transformed.xy += vec2(-deltaA.y, deltaA.x) * influenceA * uScatter * 0.12;

    vec2 deltaB = transformed.xy - uPointerB;
    float influenceB = smoothstep(0.8, 0.0, length(deltaB)) * step(1.5, uPointerCount);
    transformed.xy += normalize(deltaB + vec2(0.0001)) * influenceB * (0.1 + uMotionEnergy * 0.08);
    transformed.xy -= vec2(-deltaB.y, deltaB.x) * influenceB * uScatter * 0.12;

    vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    float depthScale = 1.0 / max(0.5, -mvPosition.z);
    gl_PointSize = uPointSize * uPixelRatio * depthScale * (0.72 + pulse * 0.72 + min(uScatter, 0.8) * 0.22);

    vAlpha = 0.44 + pulse * 0.5;
    vHue = fract(aSeed * 3.71 + uTime * 0.07 + uShape * 0.12);
    float fieldCore = smoothstep(0.11, 0.0, aSeed) * fieldAmount;
    float galaxyCore = uShape > 1.5 ? smoothstep(0.72, 0.02, length(base.xy)) : 0.0;
    vCore = max(fieldCore, galaxyCore);
  }
`;

const fragmentShader = `
  varying float vAlpha;
  varying float vHue;
  varying float vCore;
  uniform float uShape;

  void main() {
    vec2 point = gl_PointCoord - 0.5;
    float distanceToCenter = length(point);
    if (distanceToCenter > 0.5) discard;
    float core = smoothstep(0.5, 0.02, distanceToCenter);
    vec3 color;
    if (uShape < 0.5) {
      color = mix(vec3(0.05, 0.68, 0.72), vec3(0.67, 1.0, 0.94), smoothstep(0.1, 0.95, vHue));
    } else if (uShape < 1.5) {
      color = mix(vec3(0.92, 0.08, 0.32), vec3(1.0, 0.72, 0.22), smoothstep(0.12, 0.9, vHue));
    } else if (uShape < 2.5) {
      vec3 dustColor = mix(vec3(0.14, 0.34, 0.92), vec3(0.9, 0.12, 0.72), smoothstep(0.08, 0.94, vHue));
      color = mix(dustColor, vec3(1.0, 0.88, 0.72), vCore);
    } else if (uShape < 3.5) {
      vec3 diskColor = mix(vec3(0.35, 0.16, 0.54), vec3(0.82, 0.72, 0.94), smoothstep(0.1, 0.9, vHue));
      color = mix(diskColor, vec3(1.0, 0.91, 0.7), vCore);
    } else if (uShape < 4.5) {
      vec3 armColor = mix(vec3(0.16, 0.42, 0.96), vec3(0.98, 0.18, 0.52), smoothstep(0.12, 0.9, vHue));
      color = mix(armColor, vec3(1.0, 0.84, 0.72), vCore);
    } else {
      vec3 armColor = mix(vec3(0.22, 0.48, 0.96), vec3(0.76, 0.22, 0.78), vHue);
      color = mix(armColor, vec3(1.0, 0.79, 0.48), vCore);
    }
    color = mix(color, vec3(1.0), core * 0.16);
    gl_FragColor = vec4(color, core * vAlpha);
  }
`;

function randomUnitVector() {
  const z = Math.random() * 2 - 1;
  const angle = Math.random() * Math.PI * 2;
  const radius = Math.sqrt(1 - z * z);
  return [radius * Math.cos(angle), radius * Math.sin(angle), z];
}

function createRaster(image = null) {
  const raster = document.createElement("canvas");
  raster.width = 440;
  raster.height = 620;
  const context = raster.getContext("2d", { willReadFrequently: true });
  context.clearRect(0, 0, raster.width, raster.height);

  if (image) {
    const scale = Math.min((raster.width * 0.88) / image.width, (raster.height * 0.92) / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    context.filter = "grayscale(1) contrast(1.45) brightness(0.88)";
    context.drawImage(image, (raster.width - width) / 2, (raster.height - height) / 2, width, height);
  } else {
    context.save();
    context.translate(raster.width / 2, raster.height * 0.46);
    context.fillStyle = "#fff";
    context.beginPath();
    context.ellipse(0, -156, 62, 76, -0.08, 0, Math.PI * 2);
    context.fill();
    context.beginPath();
    context.moveTo(-50, -95);
    context.bezierCurveTo(-102, -64, -122, 28, -110, 142);
    context.bezierCurveTo(-96, 250, -62, 272, -39, 174);
    context.lineTo(-16, 38);
    context.lineTo(14, 38);
    context.lineTo(43, 176);
    context.bezierCurveTo(67, 273, 103, 243, 110, 137);
    context.bezierCurveTo(120, 25, 99, -65, 49, -95);
    context.bezierCurveTo(20, -69, -23, -69, -50, -95);
    context.fill();
    context.beginPath();
    context.moveTo(-86, -35);
    context.bezierCurveTo(-154, 0, -206, 77, -178, 108);
    context.bezierCurveTo(-149, 137, -103, 49, -69, 6);
    context.fill();
    context.beginPath();
    context.moveTo(83, -36);
    context.bezierCurveTo(153, -2, 205, 74, 177, 107);
    context.bezierCurveTo(148, 137, 102, 50, 68, 5);
    context.fill();
    context.restore();
  }

  const pixels = context.getImageData(0, 0, raster.width, raster.height).data;
  const candidates = [];
  for (let y = 0; y < raster.height; y += 2) {
    for (let x = 0; x < raster.width; x += 2) {
      const index = (y * raster.width + x) * 4;
      const alpha = pixels[index + 3];
      const light = (pixels[index] + pixels[index + 1] + pixels[index + 2]) / 3;
      const visible = image ? alpha > 24 && light < 230 : alpha > 50;
      if (visible) candidates.push([x, y]);
    }
  }

  if (!candidates.length) return createRaster();
  const points = new Float32Array(particleCount * 3);
  for (let i = 0; i < particleCount; i += 1) {
    const source = candidates[Math.floor(Math.random() * candidates.length)];
    points[i * 3] = ((source[0] / raster.width) - 0.5) * 2.18 + (Math.random() - 0.5) * 0.012;
    points[i * 3 + 1] = (0.5 - source[1] / raster.height) * 3.05 + (Math.random() - 0.5) * 0.012;
    points[i * 3 + 2] = (Math.random() - 0.5) * 0.22;
  }
  return points;
}

function createHeart() {
  const points = new Float32Array(particleCount * 3);
  for (let i = 0; i < particleCount; i += 1) {
    const t = Math.random() * Math.PI * 2;
    const fill = Math.sqrt(Math.random());
    const x = 16 * Math.pow(Math.sin(t), 3);
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    points[i * 3] = x * 0.075 * fill;
    points[i * 3 + 1] = y * 0.075 * fill + 0.05;
    points[i * 3 + 2] = (Math.random() - 0.5) * 0.42 * (1.1 - fill * 0.45);
  }
  return points;
}

function randomNormal() {
  const a = Math.max(Math.random(), 0.00001);
  const b = Math.random();
  return Math.sqrt(-2 * Math.log(a)) * Math.cos(Math.PI * 2 * b);
}

function writeGalaxyPoint(points, index, x, y, z, rotation = 0) {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  points[index * 3] = x * cos - y * sin;
  points[index * 3 + 1] = x * sin + y * cos;
  points[index * 3 + 2] = z;
}

function createCenaGalaxy() {
  const points = new Float32Array(particleCount * 3);
  for (let i = 0; i < particleCount; i += 1) {
    const type = Math.random();
    let x = 0;
    let y = 0;
    let z = 0;
    if (type < 0.28) {
      const radius = Math.pow(Math.random(), 2.5) * 0.62;
      const angle = Math.random() * Math.PI * 2;
      x = Math.cos(angle) * radius;
      y = Math.sin(angle) * radius * 0.78;
      z = randomNormal() * (0.3 - radius * 0.24);
    } else if (type < 0.72) {
      x = randomNormal() * 0.78;
      y = randomNormal() * (0.055 + Math.abs(x) * 0.055);
      z = randomNormal() * 0.075;
    } else {
      const direction = Math.random() < 0.5 ? -1 : 1;
      const distance = 0.22 + Math.pow(Math.random(), 0.72) * 1.6;
      x = randomNormal() * (0.12 + distance * 0.13);
      y = direction * distance + randomNormal() * (0.08 + distance * 0.1);
      z = randomNormal() * (0.12 + distance * 0.12);
    }
    writeGalaxyPoint(points, i, x, y, z, 0.63);
  }
  return points;
}

function createM104Galaxy() {
  const points = new Float32Array(particleCount * 3);
  for (let i = 0; i < particleCount; i += 1) {
    const type = Math.random();
    let x;
    let y;
    let z;
    if (type < 0.36) {
      const radius = Math.pow(Math.random(), 2.4) * 0.72;
      const angle = Math.random() * Math.PI * 2;
      x = Math.cos(angle) * radius;
      y = Math.sin(angle) * radius * 0.48;
      z = randomNormal() * (0.2 - radius * 0.16);
    } else if (type < 0.93) {
      const radius = 0.24 + Math.pow(Math.random(), 0.72) * 1.55;
      const angle = Math.random() * Math.PI * 2;
      x = Math.cos(angle) * radius;
      y = Math.sin(angle) * radius * 0.1 + randomNormal() * 0.025;
      z = randomNormal() * 0.055;
    } else {
      x = randomNormal() * 1.1;
      y = randomNormal() * 0.38;
      z = randomNormal() * 0.16;
    }
    writeGalaxyPoint(points, i, x, y, z, -0.04);
  }
  return points;
}

function createSpiralGalaxy({ arms, twist, flatten, rotation, singleArm = false }) {
  const points = new Float32Array(particleCount * 3);
  for (let i = 0; i < particleCount; i += 1) {
    const type = Math.random();
    let x;
    let y;
    let z;
    if (type < 0.22) {
      const radius = Math.pow(Math.random(), 2.55) * 0.68;
      const angle = Math.random() * Math.PI * 2;
      x = Math.cos(angle) * radius;
      y = Math.sin(angle) * radius * 0.72;
      z = randomNormal() * (0.22 - radius * 0.18);
    } else if (singleArm && type < 0.36) {
      x = (Math.random() - 0.5) * 1.35;
      y = randomNormal() * 0.09;
      z = randomNormal() * 0.06;
    } else if (type < 0.93) {
      const arm = singleArm ? 0 : i % arms;
      const radius = 0.24 + Math.pow(Math.random(), 0.68) * 1.55;
      const angle = arm * Math.PI * 2 / arms + radius * twist + randomNormal() * (0.055 + radius * 0.07);
      x = Math.cos(angle) * radius * 1.08;
      y = Math.sin(angle) * radius * flatten;
      z = randomNormal() * (0.035 + radius * 0.025);
    } else {
      const radius = 0.6 + Math.random() * 1.4;
      const angle = Math.random() * Math.PI * 2;
      x = Math.cos(angle) * radius;
      y = Math.sin(angle) * radius * flatten;
      z = randomNormal() * 0.18;
    }
    writeGalaxyPoint(points, i, x, y, z, rotation);
  }
  return points;
}

let shapes = {
  form: createRaster(),
  heart: createHeart(),
  orbitCena: createCenaGalaxy(),
  orbitM104: createM104Galaxy(),
  orbit4258: createSpiralGalaxy({ arms: 2, twist: 4.4, flatten: 0.68, rotation: 0.54 }),
  orbit4725: createSpiralGalaxy({ arms: 1, twist: 4.8, flatten: 0.78, rotation: -0.22, singleArm: true }),
};

const geometry = new THREE.BufferGeometry();
const from = shapes.form.slice();
const to = shapes.form.slice();
const basePosition = new Float32Array(particleCount * 3);
const noise = new Float32Array(particleCount * 3);
const seeds = new Float32Array(particleCount);

for (let i = 0; i < particleCount; i += 1) {
  const vector = randomUnitVector();
  noise[i * 3] = vector[0];
  noise[i * 3 + 1] = vector[1];
  noise[i * 3 + 2] = vector[2];
  seeds[i] = Math.random();
}

geometry.setAttribute("position", new THREE.BufferAttribute(basePosition, 3));
geometry.setAttribute("aFrom", new THREE.BufferAttribute(from, 3));
geometry.setAttribute("aTo", new THREE.BufferAttribute(to, 3));
geometry.setAttribute("aNoise", new THREE.BufferAttribute(noise, 3));
geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 8);

const uniforms = {
  uTime: { value: 0 },
  uMorph: { value: 1 },
  uScatter: { value: state.scatter },
  uBlast: { value: 0 },
  uPointSize: { value: isMobile ? 8.6 : 7.2 },
  uPixelRatio: { value: renderer.getPixelRatio() },
  uPointerA: { value: new THREE.Vector2(0, 0) },
  uPointerB: { value: new THREE.Vector2(0, 0) },
  uPointerCount: { value: 1 },
  uLeftHand: { value: new THREE.Vector2(-0.82, -0.08) },
  uRightHand: { value: new THREE.Vector2(0.82, -0.08) },
  uPoseAmount: { value: 0 },
  uLegSwing: { value: 0 },
  uBodyLean: { value: 0 },
  uMotionEnergy: { value: 0 },
  uDepthTravel: { value: 0 },
  uShape: { value: 0 },
};

const material = new THREE.ShaderMaterial({
  uniforms,
  vertexShader,
  fragmentShader,
  transparent: true,
  depthWrite: false,
  blending: THREE.NormalBlending,
});

const particles = new THREE.Points(geometry, material);
particles.frustumCulled = false;
particleGroup.add(particles);

function createStars() {
  const count = isMobile ? 320 : 720;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const radius = 4 + Math.random() * 10;
    const vector = randomUnitVector();
    positions[i * 3] = vector[0] * radius;
    positions[i * 3 + 1] = vector[1] * radius;
    positions[i * 3 + 2] = vector[2] * radius;
  }
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const starMaterial = new THREE.PointsMaterial({
    color: 0x9fc5cf,
    size: 0.012,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });
  const stars = new THREE.Points(starGeometry, starMaterial);
  scene.add(stars);
  return stars;
}

const stars = createStars();

function ease(value) {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function wrapAngle(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function resetOrientation() {
  state.userRotationX = wrapAngle(state.userRotationX);
  state.userRotationY = wrapAngle(state.userRotationY);
  state.userRotationZ = wrapAngle(state.userRotationZ);
  particleGroup.rotation.x = wrapAngle(particleGroup.rotation.x);
  particleGroup.rotation.y = wrapAngle(particleGroup.rotation.y);
  particleGroup.rotation.z = wrapAngle(particleGroup.rotation.z);
  state.targetUserRotationX = 0;
  state.targetUserRotationY = 0;
  state.targetUserRotationZ = 0;
  state.ambientRotationZ = 0;
  state.targetGroupX = 0;
  state.targetGroupY = 0;
}

function switchShape(name) {
  if (!shapes[name] || name === state.shape) return;
  const progress = ease(uniforms.uMorph.value);
  const fromArray = geometry.getAttribute("aFrom").array;
  const toArray = geometry.getAttribute("aTo").array;
  const target = shapes[name];
  for (let i = 0; i < fromArray.length; i += 1) {
    fromArray[i] = THREE.MathUtils.lerp(fromArray[i], toArray[i], progress);
    toArray[i] = target[i];
  }
  geometry.getAttribute("aFrom").needsUpdate = true;
  geometry.getAttribute("aTo").needsUpdate = true;
  uniforms.uMorph.value = 0;
  state.morphStart = performance.now();
  state.shape = name;
  state.targetGroupX = 0;
  state.targetGroupY = 0;
  particleGroup.position.x = 0;
  particleGroup.position.y = 0;
  state.objectScale = 1;
  state.targetObjectScale = 1;
  state.userRotationZ = 0;
  state.targetUserRotationZ = 0;
  state.userRotationX = 0;
  state.userRotationY = 0;
  state.targetUserRotationX = 0;
  state.targetUserRotationY = 0;
  state.depthTravel = 0;
  state.targetDepthTravel = 0;
  state.pointControlActive = false;
  state.pointCenterSince = 0;
  state.dualGrabActive = false;
  state.singleGrabActive = false;
  if (name !== "form") state.targetPoseAmount = 0;
  uniforms.uShape.value = shapeOrder.indexOf(name);
  uniforms.uBlast.value = 0.52;
  state.lastInteraction = performance.now();
}

function nextShape(direction = 1) {
  const index = shapeOrder.indexOf(state.shape);
  switchShape(shapeOrder[(index + direction + shapeOrder.length) % shapeOrder.length]);
}

function onPointerMove(event) {
  if (state.cameraActive && state.handVisible) return;
  state.targetPointerX = (event.clientX / innerWidth) * 2 - 1;
  state.targetPointerY = 1 - (event.clientY / innerHeight) * 2;
  state.targetPointerCount = 1;
  state.lastInteraction = performance.now();
}

canvas.addEventListener("pointermove", onPointerMove);
canvas.addEventListener("pointerdown", (event) => {
  state.pointerDown = true;
  state.targetScatter = 1;
  uniforms.uBlast.value = 1;
  state.lastInteraction = performance.now();
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener("pointerup", () => {
  state.pointerDown = false;
  state.targetScatter = 0.08;
});
canvas.addEventListener("dblclick", () => nextShape(1));

sensitivity.addEventListener("input", () => {
  sensitivityValue.value = sensitivity.value;
  state.sensitivity = Number(sensitivity.value) / 100;
});

togglePanel.addEventListener("click", () => {
  const collapsed = controlPanel.classList.toggle("collapsed");
  togglePanel.textContent = collapsed ? "+" : "−";
  togglePanel.setAttribute("aria-label", collapsed ? "展开控制面板" : "收起控制面板");
});

imageUpload.addEventListener("change", () => {
  const file = imageUpload.files?.[0];
  if (!file) return;
  const image = new Image();
  image.onload = () => {
    state.sourceImage = image;
    shapes.form = createRaster(image);
    if (state.shape === "form") {
      const previousShape = state.shape;
      state.shape = "heart";
      switchShape(previousShape);
    } else {
      switchShape("form");
    }
    URL.revokeObjectURL(image.src);
  };
  image.src = URL.createObjectURL(file);
});

resetButton.addEventListener("click", () => {
  state.sourceImage = null;
  imageUpload.value = "";
  shapes.form = createRaster();
  if (state.shape === "form") state.shape = "heart";
  switchShape("form");
});

const handModeTrackers = new Map();
const palmFilters = new Map();
const tipFilters = new Map();
const grabFilters = new Map();
const swipeTrackers = new Map();

class FastPointFilter extends OneEuroPointFilter {
  constructor() {
    super({ minCutoff: 1.7, beta: 0.065, derivativeCutoff: 1.2 });
  }
}

function getTracked(map, key, Factory) {
  if (!map.has(key)) map.set(key, new Factory());
  return map.get(key);
}

async function loadHandTracking() {
  statusText.textContent = "正在加载手势模型";
  const vision = await import("./vendor/tasks-vision/vision_bundle.mjs");
  const fileset = await vision.FilesetResolver.forVisionTasks("./vendor/tasks-vision/wasm");
  const options = {
    baseOptions: { modelAssetPath: "./vendor/hand_landmarker.task", delegate: "GPU" },
    runningMode: "VIDEO",
    numHands: 2,
    minHandDetectionConfidence: 0.48,
    minHandPresenceConfidence: 0.45,
    minTrackingConfidence: 0.45,
  };
  try {
    state.handLandmarker = await vision.HandLandmarker.createFromOptions(fileset, options);
  } catch (error) {
    console.warn("GPU hand tracking unavailable, falling back to CPU.", error);
    options.baseOptions = { modelAssetPath: "./vendor/hand_landmarker.task" };
    state.handLandmarker = await vision.HandLandmarker.createFromOptions(fileset, options);
  }
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera unavailable");
  gestureButton.classList.add("loading");
  showNotice("正在启动摄像头与手势识别");
  if (!state.handLandmarker) await loadHandTracking();
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 24, max: 30 }, facingMode: "user" },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
  state.cameraActive = true;
  state.lastVideoTime = -1;
  state.lastDetectionAt = -Infinity;
  video.classList.add("visible");
  status.classList.add("camera-ready");
  gestureButton.classList.remove("loading");
  gestureButton.classList.add("active");
  gestureButton.dataset.gesture = "none";
  gestureButton.setAttribute("aria-label", "关闭手势控制");
  gestureButton.title = "关闭手势控制";
  statusText.textContent = "等待手势";
  hideNotice();
}

function stopCamera() {
  state.cameraActive = false;
  state.handVisible = false;
  video.srcObject?.getTracks().forEach((track) => track.stop());
  video.srcObject = null;
  video.classList.remove("visible");
  status.classList.remove("camera-ready");
  gestureButton.classList.remove("loading", "active");
  delete gestureButton.dataset.gesture;
  gestureButton.setAttribute("aria-label", "开启手势控制");
  gestureButton.title = "开启手势控制";
  statusText.textContent = "鼠标模式";
  state.targetScatter = 0.08;
  state.targetCameraZ = 4.2;
  state.targetPointerCount = 1;
  state.targetGroupX = 0;
  state.targetGroupY = 0;
  state.activeGesture = "neutral";
  state.lastDominantGesture = "neutral";
  state.targetPoseAmount = 0;
  state.targetLegSwing = 0;
  state.targetBodyLean = 0;
  state.targetMotionEnergy = 0;
  state.targetDepthTravel = 0;
  state.pointControlActive = false;
  state.dualGrabActive = false;
  state.singleGrabActive = false;
  handCursors.forEach((cursor) => cursor.classList.remove("visible", "pinching"));
  handModeTrackers.forEach((tracker) => tracker.reset());
  palmFilters.forEach((filter) => filter.reset());
  tipFilters.forEach((filter) => filter.reset());
  grabFilters.forEach((filter) => filter.reset());
  swipeTrackers.forEach((tracker) => tracker.reset());
}

async function toggleCamera(enabled) {
  if (state.cameraStarting) return;
  cameraToggle.checked = enabled;
  if (!enabled) {
    stopCamera();
    return;
  }
  state.cameraStarting = true;
  try {
    await startCamera();
  } catch (error) {
    console.error(error);
    cameraToggle.checked = false;
    stopCamera();
    statusText.textContent = "摄像头不可用";
    const message = error?.name === "NotAllowedError"
      ? "摄像头权限被拒绝，请在地址栏中重新允许"
      : error?.name === "NotFoundError"
        ? "没有检测到可用摄像头"
        : `手势启动失败：${error?.message || "未知错误"}`;
    showNotice(message, true);
  } finally {
    state.cameraStarting = false;
  }
}

gestureButton.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  event.stopPropagation();
  toggleCamera(!state.cameraActive);
});
gestureButton.addEventListener("click", (event) => {
  if (event.detail === 0) toggleCamera(!state.cameraActive);
});
cameraToggle.addEventListener("change", () => toggleCamera(cameraToggle.checked));

function detectHands(time) {
  if (!state.handLandmarker || video.readyState < 2 || video.currentTime === state.lastVideoTime || time - state.lastDetectionAt < 33) return;
  state.lastDetectionAt = time;
  state.lastVideoTime = video.currentTime;
  const result = state.handLandmarker.detectForVideo(video, time);
  const landmarkSets = result.landmarks || [];
  const handednessSets = result.handednesses || result.handedness || [];
  if (!landmarkSets.length) {
    state.handVisible = false;
    state.targetPointerCount = 0;
    state.targetGroupX = 0;
    state.targetGroupY = 0;
    state.targetScatter = 0.08;
    state.targetCameraZ = 4.2;
    state.activeGesture = "neutral";
    state.lastDominantGesture = "neutral";
    state.targetPoseAmount = 0;
    state.targetLegSwing = 0;
    state.targetBodyLean = 0;
    state.targetMotionEnergy = 0;
    state.pointControlActive = false;
    state.pointCenterSince = 0;
    state.dualGrabActive = false;
    state.singleGrabActive = false;
    handCursors.forEach((cursor) => cursor.classList.remove("visible", "pinching"));
    gestureButton.dataset.gesture = "none";
    statusText.textContent = "等待手势";
    return;
  }

  state.handVisible = true;
  const observations = landmarkSets.slice(0, 2).map((landmarks, index) => {
    const palm = landmarks[9];
    const indexTip = landmarks[8];
    const thumbTip = landmarks[4];
    const category = handednessSets[index]?.[0];
    const handedness = category?.categoryName || category?.displayName || "Unknown";
    const key = handedness === "Left" || handedness === "Right" ? handedness : `Unknown${index}`;
    const metrics = analyzeHand(landmarks);
    const mode = getTracked(handModeTrackers, key, HandModeTracker).update(metrics);
    const filteredPalm = getTracked(palmFilters, key, OneEuroPointFilter).filter({ x: 1 - palm.x, y: palm.y }, time);
    const filteredTip = getTracked(tipFilters, key, FastPointFilter).filter({ x: 1 - indexTip.x, y: indexTip.y }, time);
    const filteredGrab = getTracked(grabFilters, key, FastPointFilter).filter({
      x: 1 - (thumbTip.x + indexTip.x) * 0.5,
      y: (thumbTip.y + indexTip.y) * 0.5,
    }, time);
    return {
      handedness,
      key,
      landmarks,
      palm,
      handX: filteredPalm.x,
      handY: 1 - filteredPalm.y,
      tip: filteredTip,
      grab: filteredGrab,
      metrics,
      mode,
    };
  });

  handCursors.forEach((cursor, index) => {
    const hand = observations[index];
    if (!hand) {
      cursor.classList.remove("visible", "pinching");
      return;
    }
    const point = hand.mode === "pinch" ? hand.grab : hand.tip;
    cursor.style.left = `${point.x * innerWidth}px`;
    cursor.style.top = `${point.y * innerHeight}px`;
    cursor.classList.add("visible");
    cursor.classList.toggle("pinching", hand.mode === "pinch");
  });

  const pinchHands = observations.filter((item) => item.mode === "pinch");
  const pinchTool = pinchHands.find((item) => item.handedness === "Right") || pinchHands[0] || null;
  const activeGesture = resolveHandAction(observations);

  state.targetPointerX = observations[0].tip.x * 2 - 1;
  state.targetPointerY = 1 - observations[0].tip.y * 2;
  if (observations[1]) {
    state.targetPointerBX = observations[1].tip.x * 2 - 1;
    state.targetPointerBY = 1 - observations[1].tip.y * 2;
  }
  state.targetPointerCount = pinchHands.length ? 0 : observations.length;
  state.lastInteraction = time;

  state.activeGesture = activeGesture;
  if (activeGesture === "open") {
    state.targetScatter = 1.08;
    if (state.lastDominantGesture !== "open") uniforms.uBlast.value = Math.max(uniforms.uBlast.value, 0.68);
  } else if (activeGesture === "fist") {
    state.targetScatter = 0.004;
    uniforms.uBlast.value = 0;
    state.scatter *= 0.58;
    state.targetDepthTravel = 0;
    state.targetObjectScale = 1;
    state.targetCameraZ = 4.2;
    resetOrientation();
  } else {
    state.targetScatter = 0.035;
    uniforms.uBlast.value *= 0.45;
  }
  state.lastDominantGesture = activeGesture;
  state.targetCameraZ = 4.2;

  const screenOrderedHands = [...observations].sort((a, b) => a.handX - b.handX);
  const leftHand = observations.length > 1 ? screenOrderedHands[0] : observations[0].handX < 0.5 ? observations[0] : null;
  const rightHand = observations.length > 1 ? screenOrderedHands.at(-1) : observations[0].handX >= 0.5 ? observations[0] : null;
  const toPoseX = (hand) => THREE.MathUtils.clamp((hand.handX * 2 - 1) * 1.16, -1.16, 1.16);
  const toPoseY = (hand) => THREE.MathUtils.clamp((hand.handY * 2 - 1) * 1.08, -0.72, 1.12);

  state.targetLeftHandX = leftHand ? toPoseX(leftHand) : -0.82;
  state.targetLeftHandY = leftHand ? toPoseY(leftHand) : -0.08;
  state.targetRightHandX = rightHand ? toPoseX(rightHand) : 0.82;
  state.targetRightHandY = rightHand ? toPoseY(rightHand) : -0.08;
  state.targetPoseAmount = state.shape === "form" && activeGesture !== "fist" ? 1 : 0;

  const poseMotion = calculatePoseMotion(observations, state.lastPoseCenterX, time - state.lastPoseAt);
  state.targetLegSwing = poseMotion.legSwing;
  state.targetBodyLean = poseMotion.bodyLean;
  state.targetMotionEnergy = poseMotion.motionEnergy;
  state.lastPoseCenterX = poseMotion.centerX;
  state.lastPoseAt = time;

  const pointingHand = observations.find((item) => item.mode === "point");
  if (pointingHand && !pinchTool) {
    let movement = 0;
    if (!state.pointControlActive) {
      state.pointControlActive = true;
      state.lastPointX = pointingHand.tip.x;
      state.lastPointY = pointingHand.tip.y;
    } else {
      const deltaX = pointingHand.tip.x - state.lastPointX;
      const deltaY = pointingHand.tip.y - state.lastPointY;
      movement = Math.hypot(deltaX, deltaY);
      state.targetUserRotationY += deltaX * 8.5;
      state.targetUserRotationX += deltaY * 6.2;
      state.lastPointX = pointingHand.tip.x;
      state.lastPointY = pointingHand.tip.y;
    }
    const proximity = THREE.MathUtils.clamp((pointingHand.metrics.palmWidth - 0.1) / 0.22, 0, 1);
    state.targetDepthTravel = THREE.MathUtils.clamp(
      Math.max(state.targetDepthTravel + movement * 1.35, proximity),
      0,
      1,
    );
    state.targetObjectScale = 1 + state.targetDepthTravel * 0.92;
    state.targetCameraZ = 4.2 - state.targetDepthTravel * 1.28;
    const centered = Math.hypot(pointingHand.tip.x - 0.5, pointingHand.tip.y - 0.5) < 0.085;
    if (centered && movement < 0.008) {
      if (!state.pointCenterSince) state.pointCenterSince = time;
      if (time - state.pointCenterSince > 480) resetOrientation();
    } else {
      state.pointCenterSince = 0;
    }
  } else {
    state.pointControlActive = false;
    state.pointCenterSince = 0;
  }

  if (pinchHands.length >= 2) {
    const [first, second] = [...pinchHands].sort((a, b) => a.grab.x - b.grab.x);
    const dx = second.grab.x - first.grab.x;
    const dy = second.grab.y - first.grab.y;
    const distance = Math.max(Math.hypot(dx, dy), 0.04);
    const angle = Math.atan2(dy, dx);

    if (!state.dualGrabActive) {
      state.dualGrabActive = true;
      state.dualGrabStartDistance = distance;
      state.dualGrabStartScale = state.objectScale;
      state.dualGrabStartAngle = angle;
      state.dualGrabStartRotation = state.userRotationZ;
    }
    state.singleGrabActive = false;

    const centerX = (first.grab.x + second.grab.x) * 0.5;
    const centerY = (first.grab.y + second.grab.y) * 0.5;
    state.targetGroupX = (centerX * 2 - 1) * 1.08;
    state.targetGroupY = (1 - centerY * 2) * 0.7;
    state.targetObjectScale = THREE.MathUtils.clamp(
      state.dualGrabStartScale * (distance / state.dualGrabStartDistance),
      0.55,
      1.85,
    );
    state.targetUserRotationZ = state.dualGrabStartRotation + angle - state.dualGrabStartAngle;
  } else if (pinchTool) {
    state.dualGrabActive = false;
    const grabX = (pinchTool.grab.x * 2 - 1) * 1.08;
    const grabY = (1 - pinchTool.grab.y * 2) * 0.7;
    if (!state.singleGrabActive) {
      state.singleGrabActive = true;
      state.singleGrabOffsetX = state.targetGroupX - grabX;
      state.singleGrabOffsetY = state.targetGroupY - grabY;
    }
    state.targetGroupX = grabX + state.singleGrabOffsetX;
    state.targetGroupY = grabY + state.singleGrabOffsetY;
  } else if (state.shape === "form" && activeGesture !== "fist") {
    state.dualGrabActive = false;
    state.singleGrabActive = false;
    state.targetGroupX = (poseMotion.centerX - 0.5) * 0.52;
    state.targetGroupY = (poseMotion.centerY - 0.5) * 0.22;
  } else {
    state.dualGrabActive = false;
    state.singleGrabActive = false;
  }

  if (!pinchTool) {
    for (const observation of observations.filter((item) => item.mode === "open")) {
      const tracker = getTracked(swipeTrackers, observation.key, SwipeTracker);
      const direction = tracker.update(observation.handX, time);
      if (direction && time - state.lastShapeSwitchAt > 680) {
        nextShape(direction);
        state.lastShapeSwitchAt = time;
        uniforms.uBlast.value = Math.max(uniforms.uBlast.value, 0.42);
        state.targetUserRotationZ += direction * 0.18;
        break;
      }
    }
  }

  gestureButton.dataset.gesture = activeGesture === "dual-pinch" ? "pinch" : activeGesture;
  statusText.textContent = pinchHands.length > 1
    ? "双手缩放旋转"
    : pinchTool
      ? "捏合抓取"
      : activeGesture === "open"
        ? "张手爆散"
        : activeGesture === "fist"
          ? "握拳聚合"
          : activeGesture === "point"
            ? "食指旋转深入"
            : "挥手切换";
}

function preferredRecorderType() {
  return ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function startRecording() {
  if (!canvas.captureStream || !window.MediaRecorder) return;
  state.recordingChunks = [];
  const stream = canvas.captureStream(60);
  const mimeType = preferredRecorderType();
  const options = mimeType ? { mimeType, videoBitsPerSecond: 9_000_000 } : { videoBitsPerSecond: 9_000_000 };
  state.recorder = new MediaRecorder(stream, options);
  state.recorder.ondataavailable = (event) => {
    if (event.data.size) state.recordingChunks.push(event.data);
  };
  state.recorder.onstop = () => {
    const blob = new Blob(state.recordingChunks, { type: state.recorder.mimeType || "video/webm" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `particle-portrait-${Date.now()}.webm`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  state.recorder.start(250);
  recordButton.classList.add("active");
  recordButton.setAttribute("aria-label", "停止录制");
  recordButton.title = "停止录制";
}

function stopRecording() {
  if (state.recorder?.state === "recording") state.recorder.stop();
  recordButton.classList.remove("active");
  recordButton.setAttribute("aria-label", "开始录制");
  recordButton.title = "开始录制";
}

recordButton.addEventListener("click", () => {
  if (state.recorder?.state === "recording") stopRecording();
  else startRecording();
});

window.addEventListener("keydown", (event) => {
  if (event.key === "1") switchShape("form");
  if (event.key === "2") switchShape("heart");
  if (event.key === "3") switchShape("orbitCena");
  if (event.key === "4") switchShape("orbitM104");
  if (event.key === "5") switchShape("orbit4258");
  if (event.key === "6") switchShape("orbit4725");
  if (event.code === "Space") {
    event.preventDefault();
    uniforms.uBlast.value = 1;
    state.targetScatter = 1;
    setTimeout(() => { state.targetScatter = 0.08; }, 260);
  }
  if (event.key.toLowerCase() === "c") toggleCamera(!state.cameraActive);
  if (event.key.toLowerCase() === "r") {
    if (state.recorder?.state === "recording") stopRecording();
    else startRecording();
  }
});

function resize() {
  const width = innerWidth;
  const height = innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(devicePixelRatio, maxPixelRatio));
  renderer.setSize(width, height, false);
  uniforms.uPixelRatio.value = renderer.getPixelRatio();
}

window.addEventListener("resize", resize);
window.addEventListener("beforeunload", () => {
  stopCamera();
  stopRecording();
});

const clock = new THREE.Clock();

function animate(now) {
  requestAnimationFrame(animate);
  const elapsed = clock.getElapsedTime();
  uniforms.uTime.value = elapsed;
  uniforms.uMorph.value = Math.min(1, (now - state.morphStart) / state.morphDuration);
  uniforms.uBlast.value *= 0.92;
  const scatterResponse = state.activeGesture === "fist" ? 0.3 : state.activeGesture === "open" ? 0.17 : 0.1;
  state.scatter += (state.targetScatter * state.sensitivity - state.scatter) * scatterResponse;
  uniforms.uScatter.value = state.scatter;
  state.pointerX += (state.targetPointerX - state.pointerX) * 0.08;
  state.pointerY += (state.targetPointerY - state.pointerY) * 0.08;
  state.pointerBX += (state.targetPointerBX - state.pointerBX) * 0.08;
  state.pointerBY += (state.targetPointerBY - state.pointerBY) * 0.08;
  state.pointerCount += (state.targetPointerCount - state.pointerCount) * 0.22;
  uniforms.uPointerA.value.set(state.pointerX * 1.25, state.pointerY * 0.82);
  uniforms.uPointerB.value.set(state.pointerBX * 1.25, state.pointerBY * 0.82);
  uniforms.uPointerCount.value = state.targetPointerCount === 0 ? 0 : state.pointerCount;

  state.leftHandX += (state.targetLeftHandX - state.leftHandX) * 0.18;
  state.leftHandY += (state.targetLeftHandY - state.leftHandY) * 0.18;
  state.rightHandX += (state.targetRightHandX - state.rightHandX) * 0.18;
  state.rightHandY += (state.targetRightHandY - state.rightHandY) * 0.18;
  state.poseAmount += (state.targetPoseAmount - state.poseAmount) * 0.14;
  state.legSwing += (state.targetLegSwing - state.legSwing) * 0.16;
  state.bodyLean += (state.targetBodyLean - state.bodyLean) * 0.14;
  state.motionEnergy += (state.targetMotionEnergy - state.motionEnergy) * 0.18;
  uniforms.uLeftHand.value.set(state.leftHandX, state.leftHandY);
  uniforms.uRightHand.value.set(state.rightHandX, state.rightHandY);
  uniforms.uPoseAmount.value = state.poseAmount;
  uniforms.uLegSwing.value = state.legSwing;
  uniforms.uBodyLean.value = state.bodyLean;
  uniforms.uMotionEnergy.value = state.motionEnergy;
  state.depthTravel += (state.targetDepthTravel - state.depthTravel) * 0.09;
  uniforms.uDepthTravel.value = state.depthTravel;

  const transformLocked = state.activeGesture === "pinch" || state.activeGesture === "dual-pinch";
  const rotationX = transformLocked ? 0 : state.pointerX;
  const rotationY = transformLocked ? 0 : state.pointerY;
  state.userRotationX += (state.targetUserRotationX - state.userRotationX) * 0.11;
  state.userRotationY += (state.targetUserRotationY - state.userRotationY) * 0.11;
  particleGroup.rotation.y += ((rotationX * 0.36 + state.userRotationY) - particleGroup.rotation.y) * 0.07;
  particleGroup.rotation.x += ((-rotationY * 0.15 + state.userRotationX) - particleGroup.rotation.x) * 0.07;
  state.objectScale += (state.targetObjectScale - state.objectScale) * 0.14;
  state.userRotationZ += (state.targetUserRotationZ - state.userRotationZ) * 0.14;
  particleGroup.scale.setScalar(state.objectScale);
  if (galaxyShapeNames.has(state.shape) && state.activeGesture !== "fist") {
    state.ambientRotationZ += 0.00125;
  } else {
    state.ambientRotationZ += (0 - state.ambientRotationZ) * 0.14;
  }
  const idleSway = galaxyShapeNames.has(state.shape) ? state.ambientRotationZ : Math.sin(elapsed * 0.16) * 0.025;
  const targetRotationZ = idleSway + state.userRotationZ;
  particleGroup.rotation.z += (targetRotationZ - particleGroup.rotation.z) * 0.025;
  particleGroup.position.x += (state.targetGroupX - particleGroup.position.x) * 0.11;
  particleGroup.position.y += (state.targetGroupY - particleGroup.position.y) * 0.11;
  stars.rotation.y = elapsed * 0.012;
  stars.rotation.x = Math.sin(elapsed * 0.05) * 0.08;
  stars.scale.setScalar(1 + state.depthTravel * 0.38);
  camera.position.z += (state.targetCameraZ - camera.position.z) * 0.065;
  if (state.cameraActive) detectHands(now);
  renderer.render(scene, camera);
}

resize();
requestAnimationFrame(animate);
window.__particleAppReady = true;
