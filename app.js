const canvas = document.querySelector("#particleCanvas");
const ctx = canvas.getContext("2d", { alpha: false });
const video = document.querySelector("#cameraFeed");
const gestureButton = document.querySelector("#gestureButton");
const status = document.querySelector("#status");
const statusText = document.querySelector("#statusText");
const cameraToggle = document.querySelector("#cameraToggle");
const sensitivity = document.querySelector("#sensitivity");
const sensitivityValue = document.querySelector("#sensitivityValue");
const imageUpload = document.querySelector("#imageUpload");
const resetButton = document.querySelector("#resetButton");
const togglePanel = document.querySelector("#togglePanel");
const controlPanel = document.querySelector(".control-panel");
const modeButtons = [...document.querySelectorAll(".mode-button")];

const state = {
  width: 0,
  height: 0,
  dpr: 1,
  time: 0,
  mode: "form",
  targetMode: "form",
  pointerX: 0.62,
  pointerY: 0.5,
  targetX: 0.62,
  targetY: 0.5,
  openness: 0.2,
  targetOpenness: 0.2,
  sensitivity: 0.68,
  pointerDown: false,
  cameraActive: false,
  handVisible: false,
  lastVideoTime: -1,
  handLandmarker: null,
  particles: [],
  dust: [],
  waves: [],
  sparks: [],
  lastBurstAt: 0,
  sourceImage: null,
};

const palette = ["#f5f2eb", "#d8e2df", "#7ce8d5", "#ff6a7c"];
const sampleCanvas = document.createElement("canvas");
const sampleCtx = sampleCanvas.getContext("2d", { willReadFrequently: true });

function resize() {
  state.width = window.innerWidth;
  state.height = window.innerHeight;
  state.dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(state.width * state.dpr);
  canvas.height = Math.round(state.height * state.dpr);
  canvas.style.width = `${state.width}px`;
  canvas.style.height = `${state.height}px`;
  ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  state.dust = Array.from({ length: Math.min(260, Math.floor((state.width * state.height) / 5200)) }, () => ({
    x: Math.random() * state.width,
    y: Math.random() * state.height,
    z: 0.2 + Math.random() * 0.8,
    phase: Math.random() * Math.PI * 2,
  }));
  buildParticleTargets(state.sourceImage);
}

function drawDefaultFigure(targetCtx, width, height) {
  targetCtx.clearRect(0, 0, width, height);
  targetCtx.save();
  targetCtx.translate(width * 0.52, height * 0.48);
  const scale = Math.min(width, height) / 540;
  targetCtx.scale(scale, scale);
  targetCtx.fillStyle = "#fff";

  targetCtx.beginPath();
  targetCtx.ellipse(0, -132, 58, 71, -0.05, 0, Math.PI * 2);
  targetCtx.fill();

  targetCtx.beginPath();
  targetCtx.moveTo(-45, -72);
  targetCtx.bezierCurveTo(-106, -50, -121, 35, -112, 129);
  targetCtx.bezierCurveTo(-100, 220, -65, 247, -42, 152);
  targetCtx.lineTo(-18, 28);
  targetCtx.lineTo(7, 28);
  targetCtx.lineTo(44, 160);
  targetCtx.bezierCurveTo(68, 248, 104, 212, 110, 119);
  targetCtx.bezierCurveTo(118, 26, 96, -52, 43, -74);
  targetCtx.bezierCurveTo(24, -48, -25, -47, -45, -72);
  targetCtx.fill();

  targetCtx.beginPath();
  targetCtx.moveTo(-86, -26);
  targetCtx.bezierCurveTo(-165, 25, -200, 91, -171, 108);
  targetCtx.bezierCurveTo(-144, 122, -102, 53, -70, 15);
  targetCtx.fill();

  targetCtx.beginPath();
  targetCtx.moveTo(78, -24);
  targetCtx.bezierCurveTo(141, 6, 185, 61, 168, 86);
  targetCtx.bezierCurveTo(153, 106, 108, 54, 65, 13);
  targetCtx.fill();
  targetCtx.restore();
}

function drawUploadedImage(targetCtx, image, width, height) {
  targetCtx.clearRect(0, 0, width, height);
  const maxW = width * 0.74;
  const maxH = height * 0.82;
  const scale = Math.min(maxW / image.width, maxH / image.height);
  const drawW = image.width * scale;
  const drawH = image.height * scale;
  targetCtx.save();
  targetCtx.filter = "grayscale(1) contrast(1.28)";
  targetCtx.drawImage(image, (width - drawW) / 2, (height - drawH) / 2, drawW, drawH);
  targetCtx.restore();
}

function buildParticleTargets(image = null) {
  const areaScale = Math.min(state.width / 1440, state.height / 900);
  const sampleW = Math.max(280, Math.round(520 * areaScale));
  const sampleH = Math.max(380, Math.round(700 * areaScale));
  sampleCanvas.width = sampleW;
  sampleCanvas.height = sampleH;

  if (image) drawUploadedImage(sampleCtx, image, sampleW, sampleH);
  else drawDefaultFigure(sampleCtx, sampleW, sampleH);

  const data = sampleCtx.getImageData(0, 0, sampleW, sampleH).data;
  const points = [];
  const step = state.width < 700 ? 4 : 3;

  for (let y = 0; y < sampleH; y += step) {
    for (let x = 0; x < sampleW; x += step) {
      const index = (y * sampleW + x) * 4;
      const alpha = data[index + 3];
      const luminance = (data[index] + data[index + 1] + data[index + 2]) / 3;
      const isVisible = image ? alpha > 24 && luminance < 238 : alpha > 60;
      if (isVisible && Math.random() > 0.22) {
        points.push({
          x: x - sampleW / 2,
          y: y - sampleH / 2,
          z: (Math.random() - 0.5) * 52,
        });
      }
    }
  }

  const maxParticles = state.width < 700 ? 3200 : 7200;
  const stride = Math.max(1, Math.ceil(points.length / maxParticles));
  const chosen = points.filter((_, index) => index % stride === 0).slice(0, maxParticles);
  const old = state.particles;

  state.particles = chosen.map((point, index) => {
    const previous = old[index % Math.max(old.length, 1)];
    const angle = Math.random() * Math.PI * 2;
    const radius = 180 + Math.random() * Math.max(state.width, state.height) * 0.48;
    return {
      x: previous?.x ?? state.width * 0.62 + Math.cos(angle) * radius,
      y: previous?.y ?? state.height * 0.5 + Math.sin(angle) * radius,
      px: previous?.x ?? state.width * 0.62,
      py: previous?.y ?? state.height * 0.5,
      vx: (Math.random() - 0.5) * 2,
      vy: (Math.random() - 0.5) * 2,
      tx: point.x,
      ty: point.y,
      tz: point.z,
      seed: Math.random() * Math.PI * 2,
      size: 0.6 + Math.random() * 1.55,
      color: palette[Math.random() < 0.88 ? Math.floor(Math.random() * 2) : 2 + Math.floor(Math.random() * 2)],
    };
  });
}

function setMode(mode) {
  state.targetMode = mode;
  modeButtons.forEach((button) => button.classList.toggle("active", button.dataset.mode === mode));
  if (mode === "scatter") state.targetOpenness = 1;
  burst(state.width * 0.62, state.height * 0.5, 0.75, 80);
}

function burst(x, y, power = 1, count = 110) {
  const now = performance.now();
  if (now - state.lastBurstAt < 80) return;
  state.lastBurstAt = now;
  state.waves.push({ x, y, radius: 8, alpha: 0.9, speed: 8 + power * 10 });
  for (let i = 0; i < count; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = (2 + Math.random() * 11) * power;
    state.sparks.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1,
      size: 0.7 + Math.random() * 2.6,
      color: palette[1 + Math.floor(Math.random() * 3)],
    });
  }
}

function updateParticles() {
  state.pointerX += (state.targetX - state.pointerX) * 0.07;
  state.pointerY += (state.targetY - state.pointerY) * 0.07;
  const desiredOpen = state.targetMode === "scatter" ? 1 : state.targetOpenness;
  state.openness += (desiredOpen - state.openness) * 0.075;
  const centerX = state.width * (state.width < 760 ? 0.52 : 0.56);
  const centerY = state.height * 0.52;
  const rotation = (state.pointerX - 0.5) * 0.72;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const pointerPx = state.pointerX * state.width;
  const pointerPy = state.pointerY * state.height;
  const forceRadius = 120 + state.sensitivity * 170;
  const scatterStrength = state.openness * state.sensitivity;

  state.particles.forEach((particle, index) => {
    particle.px = particle.x;
    particle.py = particle.y;
    let targetX;
    let targetY;

    if (state.targetMode === "orbit") {
      const ringAngle = particle.seed + state.time * 0.00038 + index * 0.0015;
      const ringRadius = 120 + (index % 180) * 1.45;
      targetX = centerX + Math.cos(ringAngle) * ringRadius;
      targetY = centerY + Math.sin(ringAngle) * ringRadius * (0.32 + Math.sin(state.time * 0.0002) * 0.16) + Math.sin(particle.seed * 3) * 34;
    } else {
      const depthScale = 1 + (particle.tz / 260) * Math.sin(rotation);
      const breath = 1 + Math.sin(state.time * 0.0013) * 0.024;
      targetX = centerX + (particle.tx * cos - particle.tz * sin) * depthScale * breath;
      targetY = centerY + particle.ty * breath + Math.sin(state.time * 0.002 + particle.seed * 4) * 3.5;
    }

    const dxPointer = particle.x - pointerPx;
    const dyPointer = particle.y - pointerPy;
    const distance = Math.hypot(dxPointer, dyPointer) || 1;
    if (distance < forceRadius) {
      const push = (1 - distance / forceRadius) * scatterStrength * 16;
      particle.vx += (dxPointer / distance) * push;
      particle.vy += (dyPointer / distance) * push;
    }

    if (state.targetMode === "scatter") {
      const angle = particle.seed + index * 0.012;
      targetX += Math.cos(angle) * (120 + scatterStrength * 440);
      targetY += Math.sin(angle) * (90 + scatterStrength * 330);
    } else if (state.targetMode === "form") {
      targetX += (particle.tx / 140) * scatterStrength * 34;
      targetY += Math.sin(particle.seed * 8) * scatterStrength * 22;
    }

    particle.vx += (targetX - particle.x) * (state.targetMode === "scatter" ? 0.004 : 0.018);
    particle.vy += (targetY - particle.y) * (state.targetMode === "scatter" ? 0.004 : 0.018);
    particle.vx *= 0.89;
    particle.vy *= 0.89;
    particle.x += particle.vx;
    particle.y += particle.vy;
  });

  state.waves.forEach((wave) => {
    wave.radius += wave.speed;
    wave.alpha *= 0.946;
  });
  state.waves = state.waves.filter((wave) => wave.alpha > 0.025);
  state.sparks.forEach((spark) => {
    spark.vx *= 0.974;
    spark.vy = spark.vy * 0.974 + 0.01;
    spark.x += spark.vx;
    spark.y += spark.vy;
    spark.life *= 0.952;
  });
  state.sparks = state.sparks.filter((spark) => spark.life > 0.03);
}

function drawParticles() {
  ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  ctx.fillStyle = "rgba(5, 5, 7, 0.18)";
  ctx.fillRect(0, 0, state.width, state.height);

  const halo = ctx.createRadialGradient(state.width * 0.56, state.height * 0.5, 10, state.width * 0.56, state.height * 0.5, Math.max(state.width, state.height) * 0.62);
  halo.addColorStop(0, `rgba(22, 27, 38, ${0.25 + state.openness * 0.12})`);
  halo.addColorStop(0.5, "rgba(8, 9, 13, 0.08)");
  halo.addColorStop(1, "rgba(5, 5, 7, 0.5)");
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, state.width, state.height);

  for (const dust of state.dust) {
    const x = (dust.x + state.time * 0.006 * dust.z) % state.width;
    const alpha = (0.045 + Math.sin(state.time * 0.001 + dust.phase) * 0.025) * dust.z;
    ctx.fillStyle = `rgba(210,225,232,${alpha})`;
    ctx.fillRect(x, dust.y, dust.z * 1.5, dust.z * 1.5);
  }
  ctx.globalCompositeOperation = "lighter";

  for (let index = 0; index < state.particles.length; index += 1) {
    const particle = state.particles[index];
    const pulse = 0.74 + Math.sin(state.time * 0.002 + particle.seed) * 0.26;
    const speed = Math.min(1, Math.hypot(particle.vx, particle.vy) / 11);
    if (speed > 0.18 && index % 2 === 0) {
      ctx.strokeStyle = `rgba(124,232,213,${speed * 0.14})`;
      ctx.lineWidth = Math.max(0.35, particle.size * 0.45);
      ctx.beginPath();
      ctx.moveTo(particle.px, particle.py);
      ctx.lineTo(particle.x, particle.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.26 + pulse * 0.58;
    ctx.fillStyle = particle.color;
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, particle.size * pulse, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalAlpha = 1;
  for (const spark of state.sparks) {
    ctx.fillStyle = spark.color;
    ctx.globalAlpha = spark.life;
    ctx.beginPath();
    ctx.arc(spark.x, spark.y, spark.size * spark.life, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const wave of state.waves) {
    ctx.globalAlpha = wave.alpha;
    ctx.strokeStyle = "#7ce8d5";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(wave.x, wave.y, wave.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = wave.alpha * 0.28;
    ctx.strokeStyle = "#ff4f64";
    ctx.beginPath();
    ctx.arc(wave.x, wave.y, wave.radius * 0.74, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
}

function animate(time) {
  state.time = time;
  updateParticles();
  drawParticles();
  if (state.cameraActive) detectHands(time);
  requestAnimationFrame(animate);
}

function normalizedPointer(event) {
  const point = event.touches?.[0] ?? event;
  return {
    x: Math.min(1, Math.max(0, point.clientX / state.width)),
    y: Math.min(1, Math.max(0, point.clientY / state.height)),
  };
}

function onPointerMove(event) {
  if (state.cameraActive && state.handVisible) return;
  const point = normalizedPointer(event);
  state.targetX = point.x;
  state.targetY = point.y;
  state.targetOpenness = state.pointerDown ? 1 : Math.max(0.12, Math.abs(point.x - 0.5) * 0.55);
}

canvas.addEventListener("pointermove", onPointerMove);
canvas.addEventListener("pointerdown", (event) => {
  state.pointerDown = true;
  state.targetOpenness = 1;
  canvas.setPointerCapture(event.pointerId);
  burst(event.clientX, event.clientY, 1, 140);
});
canvas.addEventListener("pointerup", () => {
  state.pointerDown = false;
  state.targetOpenness = 0.18;
  if (state.targetMode === "scatter") setMode("form");
});
canvas.addEventListener("pointerleave", () => {
  if (!state.pointerDown) state.targetOpenness = 0.15;
});

sensitivity.addEventListener("input", () => {
  sensitivityValue.value = sensitivity.value;
  state.sensitivity = Number(sensitivity.value) / 100;
});

modeButtons.forEach((button) => button.addEventListener("click", () => setMode(button.dataset.mode)));

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
    buildParticleTargets(image);
    burst(state.width * 0.56, state.height * 0.5, 0.9, 120);
    statusText.textContent = "自定义轮廓已粒子化";
    URL.revokeObjectURL(image.src);
  };
  image.src = URL.createObjectURL(file);
});

resetButton.addEventListener("click", () => {
  state.sourceImage = null;
  imageUpload.value = "";
  buildParticleTargets();
  statusText.textContent = state.cameraActive ? "等待手势" : "鼠标模式";
});

function handOpenness(landmarks) {
  const wrist = landmarks[0];
  const palmWidth = Math.hypot(landmarks[5].x - landmarks[17].x, landmarks[5].y - landmarks[17].y) || 0.1;
  const tips = [4, 8, 12, 16, 20];
  const average = tips.reduce((sum, index) => {
    return sum + Math.hypot(landmarks[index].x - wrist.x, landmarks[index].y - wrist.y);
  }, 0) / tips.length;
  return Math.min(1, Math.max(0, (average / palmWidth - 1.35) / 1.35));
}

async function loadHandTracking() {
  statusText.textContent = "正在加载手势模型";
  try {
    const vision = await import("./vendor/tasks-vision/vision_bundle.mjs");
    const fileset = await vision.FilesetResolver.forVisionTasks(
      "./vendor/tasks-vision/wasm",
    );
    state.handLandmarker = await vision.HandLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: "./vendor/hand_landmarker.task",
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numHands: 1,
      minHandDetectionConfidence: 0.55,
      minTrackingConfidence: 0.5,
    });
    return true;
  } catch (error) {
    console.error(error);
    statusText.textContent = "模型加载失败，已回到鼠标模式";
    return false;
  }
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("当前浏览器不支持摄像头访问");
  if (!state.handLandmarker && !(await loadHandTracking())) throw new Error("手势模型加载失败");
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
  state.cameraActive = true;
  state.lastVideoTime = -1;
  video.classList.add("visible");
  status.classList.add("camera-ready");
  gestureButton.classList.remove("loading");
  gestureButton.classList.add("active");
  gestureButton.setAttribute("aria-label", "关闭手势控制");
  gestureButton.title = "关闭手势控制";
  statusText.textContent = "等待手势";
}

function stopCamera() {
  state.cameraActive = false;
  state.handVisible = false;
  video.srcObject?.getTracks().forEach((track) => track.stop());
  video.srcObject = null;
  video.classList.remove("visible");
  status.classList.remove("camera-ready");
  gestureButton.classList.remove("loading", "active");
  gestureButton.setAttribute("aria-label", "开启手势控制");
  gestureButton.title = "开启手势控制";
  statusText.textContent = "鼠标模式";
  state.targetOpenness = 0.2;
}

cameraToggle.addEventListener("change", async () => {
  if (!cameraToggle.checked) {
    stopCamera();
    return;
  }
  try {
    await startCamera();
  } catch (error) {
    console.error(error);
    cameraToggle.checked = false;
    stopCamera();
    statusText.textContent = "摄像头不可用，已回到鼠标模式";
  }
});

gestureButton.addEventListener("click", () => {
  cameraToggle.checked = !cameraToggle.checked;
  gestureButton.classList.toggle("loading", cameraToggle.checked);
  cameraToggle.dispatchEvent(new Event("change"));
});

function detectHands(time) {
  if (!state.handLandmarker || video.readyState < 2 || video.currentTime === state.lastVideoTime) return;
  state.lastVideoTime = video.currentTime;
  const result = state.handLandmarker.detectForVideo(video, time);
  const landmarks = result.landmarks?.[0];

  if (!landmarks) {
    state.handVisible = false;
    statusText.textContent = "等待手势";
    return;
  }

  state.handVisible = true;
  const palm = landmarks[9];
  state.targetX = 1 - palm.x;
  state.targetY = palm.y;
  state.targetOpenness = handOpenness(landmarks);
  if (state.targetOpenness > 0.72 && state.openness < 0.56) {
    burst(state.targetX * state.width, state.targetY * state.height, 1.15, 160);
  }
  statusText.textContent = state.targetOpenness > 0.64 ? "张手 · 爆散" : state.targetOpenness < 0.28 ? "握拳 · 聚合" : "手势已捕获";
}

window.addEventListener("resize", resize);
window.addEventListener("beforeunload", stopCamera);

resize();
ctx.fillStyle = "#080808";
ctx.fillRect(0, 0, state.width, state.height);
requestAnimationFrame(animate);
