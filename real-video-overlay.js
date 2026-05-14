const video = document.querySelector("#trafficVideo");
const canvas = document.querySelector("#overlay");
const ctx = canvas.getContext("2d");
const danger = document.querySelector("#danger");
const playPause = document.querySelector("#playPause");
const restart = document.querySelector("#restart");
const startDetectorBtn = document.querySelector("#startDetectorBtn");
const calibrateBtn = document.querySelector("#calibrateBtn");
const alerts = document.querySelector("#alerts");
const videoStatus = document.querySelector("#videoStatus");
const detected = document.querySelector("#detected");
const ttcMetric = document.querySelector("#ttc");
const speedMetric = document.querySelector("#speed");
const calibrationPanel = document.querySelector("#calibrationPanel");
const alertStartInput = document.querySelector("#alertStartInput");
const alertStartLabel = document.querySelector("#alertStartLabel");
const alertEndInput = document.querySelector("#alertEndInput");
const alertEndLabel = document.querySelector("#alertEndLabel");
const setAlertStartBtn = document.querySelector("#setAlertStartBtn");
const setAlertEndBtn = document.querySelector("#setAlertEndBtn");
const overlayXInput = document.querySelector("#overlayXInput");
const overlayXLabel = document.querySelector("#overlayXLabel");
const overlayYInput = document.querySelector("#overlayYInput");
const overlayYLabel = document.querySelector("#overlayYLabel");
const overlayScaleInput = document.querySelector("#overlayScaleInput");
const overlayScaleLabel = document.querySelector("#overlayScaleLabel");

const localVideoSrc = window.location.protocol === "http:"
  ? "local-traffic.mp4"
  : "local-traffic.mp4";
const clipStart = 0;
const clipEndPadding = 20;
const detectionClasses = new Set(["car", "truck", "bus", "person", "motorcycle", "bicycle"]);
const realWidthsMeters = {
  car: 1.8,
  truck: 2.6,
  bus: 2.7,
  person: 0.55,
  motorcycle: 0.8,
  bicycle: 0.65,
};

const calibration = {
  alertStart: 0,
  alertEnd: 30,
  x: 0,
  y: 0,
  scale: 1,
  focalPixels: 850,
};

let model = null;
let nextTrackId = 1;
let tracks = [];
let lastDetections = [];
let lastDetectAt = 0;
let runningDetection = false;
let detectorStatus = "off";
let detectorMessage = "AI detector off. Click Start AI.";
let lastDetectionError = "";
let detectorRequested = false;

function resize() {
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.floor(rect.width * ratio);
  canvas.height = Math.floor(rect.height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function getVideoRect(width, height) {
  const videoWidth = video.videoWidth || 720;
  const videoHeight = video.videoHeight || 1280;
  const videoRatio = videoWidth / videoHeight;
  const containerRatio = width / height;

  if (videoRatio > containerRatio) {
    const renderedHeight = width / videoRatio;
    return { x: 0, y: (height - renderedHeight) / 2, width, height: renderedHeight };
  }

  const renderedWidth = height * videoRatio;
  return { x: (width - renderedWidth) / 2, y: 0, width: renderedWidth, height };
}

function mapDetectionToCanvas(det, rect) {
  const [x, y, w, h] = det.bbox;
  const sx = rect.width / video.videoWidth;
  const sy = rect.height / video.videoHeight;
  const scaledW = w * sx * calibration.scale;
  const scaledH = h * sy * calibration.scale;
  const centerX = rect.x + x * sx + (w * sx) / 2 + calibration.x * rect.width;
  const centerY = rect.y + y * sy + (h * sy) / 2 + calibration.y * rect.height;
  return {
    x: centerX - scaledW / 2,
    y: centerY - scaledH / 2,
    w: scaledW,
    h: scaledH,
  };
}

function center(box) {
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

function estimateDistanceMeters(det) {
  const widthMeters = realWidthsMeters[det.class] || 1.8;
  return Math.max(1, (widthMeters * calibration.focalPixels) / Math.max(det.bbox[2], 1));
}

function matchTracks(detections, now) {
  const assigned = new Set();

  detections.forEach((det) => {
    const detCenter = {
      x: det.bbox[0] + det.bbox[2] / 2,
      y: det.bbox[1] + det.bbox[3] / 2,
    };

    let bestTrack = null;
    let bestDistance = Infinity;
    tracks.forEach((track) => {
      if (assigned.has(track.id) || track.class !== det.class) return;
      const dx = track.center.x - detCenter.x;
      const dy = track.center.y - detCenter.y;
      const distance = Math.hypot(dx, dy);
      if (distance < bestDistance && distance < 120) {
        bestDistance = distance;
        bestTrack = track;
      }
    });

    const distanceMeters = estimateDistanceMeters(det);
    if (!bestTrack) {
      bestTrack = {
        id: nextTrackId,
        class: det.class,
        center: detCenter,
        distanceMeters,
        speedMph: 0,
        ttc: Infinity,
        lastSeen: now,
        lastDistanceMeters: distanceMeters,
      };
      nextTrackId += 1;
      tracks.push(bestTrack);
    }

    const dt = Math.max((now - bestTrack.lastSeen) / 1000, 0.001);
    const closingMps = Math.max((bestTrack.lastDistanceMeters - distanceMeters) / dt, 0);
    const rawSpeedMph = closingMps * 2.237;
    bestTrack.speedMph = bestTrack.speedMph * 0.7 + rawSpeedMph * 0.3;
    bestTrack.ttc = closingMps > 0.2 ? distanceMeters / closingMps : Infinity;
    bestTrack.center = detCenter;
    bestTrack.distanceMeters = distanceMeters;
    bestTrack.lastDistanceMeters = distanceMeters;
    bestTrack.lastSeen = now;
    bestTrack.det = det;
    assigned.add(bestTrack.id);
  });

  tracks = tracks.filter((track) => now - track.lastSeen < 1200);
}

async function detectFrame() {
  if (!detectorRequested || !model || runningDetection || video.paused || video.readyState < 2) return;
  runningDetection = true;
  try {
    const predictions = await model.detect(video);
    const now = performance.now();
    lastDetections = predictions
      .filter((prediction) => detectionClasses.has(prediction.class))
      .filter((prediction) => prediction.score >= 0.25);
    matchTracks(lastDetections, now);
    lastDetectAt = now;
    detectorStatus = "ready";
    detectorMessage = lastDetections.length
      ? `Detector active: ${lastDetections.length} objects`
      : "Detector active: scanning for vehicles";
    lastDetectionError = "";
  } catch (error) {
    detectorStatus = "error";
    lastDetectionError = error && error.message ? error.message : String(error);
    detectorMessage = "Detector error";
  } finally {
    runningDetection = false;
  }
}

function draw() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  ctx.clearRect(0, 0, width, height);

  if (!video.readyState || !video.videoWidth || !video.videoHeight) {
    requestAnimationFrame(draw);
    return;
  }

  const rect = getVideoRect(width, height);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
  ctx.lineWidth = 2;
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
  drawDetectorStatus(rect);

  const activeTracks = tracks
    .filter((track) => track.det)
    .filter((track) => performance.now() - track.lastSeen < 900);

  const dangerous = activeTracks.filter((track) => alerts.checked && track.ttc < 3.0 && track.distanceMeters < 45);
  dangerous.sort((a, b) => a.ttc - b.ttc);
  const primaryDanger = dangerous[0];

  activeTracks.forEach((track) => drawTrack(track, rect, track === primaryDanger));
  if (primaryDanger) drawDangerPath(primaryDanger, rect);

  danger.hidden = !primaryDanger;
  detected.textContent = String(activeTracks.length);
  ttcMetric.textContent = primaryDanger ? `${primaryDanger.ttc.toFixed(1)}s` : "--";
  speedMetric.textContent = activeTracks.length ? `${Math.round(Math.max(...activeTracks.map((track) => track.speedMph)))} mph` : "--";

  if (performance.now() - lastDetectAt > 140) detectFrame();
  requestAnimationFrame(draw);
}

function drawTrack(track, rect, dangerous) {
  const box = mapDetectionToCanvas(track.det, rect);
  const color = dangerous ? "#ff3131" : track.ttc < 5 ? "#ffd447" : "#28e27c";

  ctx.strokeStyle = color;
  ctx.lineWidth = dangerous ? 4 : 2;
  ctx.strokeRect(box.x, box.y, box.w, box.h);

  drawInBoxLabel(box, `ID ${track.id}  ${Math.round(track.speedMph)}mph`, color);
  if (dangerous || track.ttc < 5) {
    drawSmallText(box.x + 4, box.y + box.h + 4, `TTC ${Number.isFinite(track.ttc) ? track.ttc.toFixed(1) : "--"}s`, color, rect);
  }
}

function drawDetectorStatus(rect) {
  const text = detectorStatus === "error"
    ? `Detector error: ${lastDetectionError.slice(0, 58)}`
    : detectorMessage;
  const color = detectorStatus === "error" ? "#ff3131" : detectorStatus === "ready" ? "#28e27c" : "#ffd447";

  ctx.font = "800 13px Arial, sans-serif";
  const labelWidth = Math.min(Math.max(ctx.measureText(text).width + 18, 190), rect.width - 16);
  const x = rect.x + 8;
  const y = rect.y + 8;

  ctx.fillStyle = "rgba(0, 0, 0, 0.72)";
  ctx.fillRect(x, y, labelWidth, 26);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, labelWidth, 26);
  ctx.fillStyle = color;
  ctx.fillText(text, x + 9, y + 18, labelWidth - 16);
}

function drawDangerPath(track, rect) {
  const box = mapDetectionToCanvas(track.det, rect);
  const point = center(box);
  const impactY = Math.min(rect.y + rect.height - 40, point.y + rect.height * 0.18);

  ctx.strokeStyle = "#ff3131";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(point.x, point.y);
  ctx.lineTo(point.x, impactY);
  ctx.stroke();

  ctx.fillStyle = "rgba(255, 49, 49, 0.25)";
  ctx.strokeStyle = "#ff3131";
  ctx.beginPath();
  ctx.arc(point.x, impactY, Math.max(15, rect.width * 0.035), 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function drawInBoxLabel(box, text, color) {
  ctx.font = "800 13px Arial, sans-serif";
  const labelWidth = Math.min(Math.max(ctx.measureText(text).width + 12, 72), Math.max(box.w - 8, 72));
  const x = box.x + 4;
  const y = box.y + 4;

  ctx.fillStyle = "rgba(0, 0, 0, 0.72)";
  ctx.fillRect(x, y, labelWidth, 20);
  ctx.fillStyle = color;
  ctx.fillText(text, x + 6, y + 14, labelWidth - 10);
}

function drawSmallText(x, y, text, color, rect) {
  const safeX = Math.min(Math.max(x, rect.x + 4), rect.x + rect.width - 90);
  const safeY = Math.min(Math.max(y, rect.y + 4), rect.y + rect.height - 18);
  ctx.font = "800 13px Arial, sans-serif";
  ctx.fillStyle = color;
  ctx.fillText(text, safeX, safeY + 13);
}

async function loadDetector() {
  if (model || detectorStatus === "loading") return;
  detectorRequested = true;
  detectorStatus = "loading";
  detectorMessage = "Loading object detector...";
  startDetectorBtn.disabled = true;
  videoStatus.hidden = false;
  videoStatus.textContent = "Loading object detection model...";
  try {
    await loadFirstWorkingScript([
      "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js",
      "https://unpkg.com/@tensorflow/tfjs@4.22.0/dist/tf.min.js",
    ]);
    await loadFirstWorkingScript([
      "https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js",
      "https://unpkg.com/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js",
      "https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.2/dist/coco-ssd.min.js",
    ]);
    if (!window.tf) {
      throw new Error("TensorFlow.js library did not load");
    }
    if (!window.cocoSsd) {
      throw new Error("COCO-SSD library did not load");
    }
    model = await cocoSsd.load();
    detectorStatus = "ready";
    detectorMessage = "Detector ready: scanning for vehicles";
    videoStatus.textContent = "Detector ready. Playing local video...";
    window.setTimeout(() => {
      videoStatus.hidden = true;
    }, 1200);
    startDetectorBtn.textContent = "AI On";
  } catch (error) {
    detectorStatus = "error";
    lastDetectionError = error && error.message ? error.message : String(error);
    detectorMessage = "Could not load detector";
    videoStatus.textContent = `Could not load detector: ${lastDetectionError}. Check internet access for TensorFlow.js model files.`;
    startDetectorBtn.disabled = false;
    startDetectorBtn.textContent = "Retry AI";
  }
}

async function loadFirstWorkingScript(urls) {
  let lastError = null;
  for (const url of urls) {
    try {
      await loadScript(url);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("No script URLs were available");
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

playPause.addEventListener("click", () => {
  if (video.paused) {
    video.play();
    playPause.textContent = "Pause";
  } else {
    video.pause();
    playPause.textContent = "Play";
  }
});

restart.addEventListener("click", () => {
  video.currentTime = clipStart;
  tracks = [];
  nextTrackId = 1;
  video.play();
  playPause.textContent = "Pause";
});

startDetectorBtn.addEventListener("click", loadDetector);

video.addEventListener("loadedmetadata", () => {
  video.currentTime = clipStart;
});

video.addEventListener("timeupdate", () => {
  const clipEnd = Math.min(video.duration || calibration.alertEnd + clipEndPadding, calibration.alertEnd + clipEndPadding);
  if (video.currentTime >= clipEnd) {
    video.currentTime = clipStart;
    tracks = [];
    nextTrackId = 1;
    video.play();
  }
});

video.addEventListener("error", () => {
  videoStatus.hidden = false;
  videoStatus.textContent = "The local MP4 could not load. Open the MP4 directly once, then refresh this page.";
});

calibrateBtn.addEventListener("click", () => {
  const willOpen = calibrationPanel.hidden;
  calibrationPanel.hidden = !willOpen;
  calibrateBtn.setAttribute("aria-pressed", String(willOpen));
});

function updateCalibration() {
  calibration.alertStart = Number(alertStartInput.value);
  calibration.alertEnd = Math.max(Number(alertEndInput.value), calibration.alertStart + 0.1);
  calibration.x = Number(overlayXInput.value) / 100;
  calibration.y = Number(overlayYInput.value) / 100;
  calibration.scale = Number(overlayScaleInput.value) / 100;

  alertStartLabel.textContent = `${calibration.alertStart.toFixed(1)}s`;
  alertEndLabel.textContent = `${calibration.alertEnd.toFixed(1)}s`;
  overlayXLabel.textContent = `${overlayXInput.value}%`;
  overlayYLabel.textContent = `${overlayYInput.value}%`;
  overlayScaleLabel.textContent = `${overlayScaleInput.value}%`;
}

[alertStartInput, alertEndInput, overlayXInput, overlayYInput, overlayScaleInput].forEach((input) => {
  input.addEventListener("input", updateCalibration);
});

setAlertStartBtn.addEventListener("click", () => {
  alertStartInput.value = Math.min(Math.max(video.currentTime || 0, 0), Number(alertStartInput.max)).toFixed(1);
  updateCalibration();
});

setAlertEndBtn.addEventListener("click", () => {
  alertEndInput.value = Math.min(Math.max(video.currentTime || 0, 0), Number(alertEndInput.max)).toFixed(1);
  updateCalibration();
});

window.addEventListener("resize", resize);
video.src = localVideoSrc;
video.load();
updateCalibration();
resize();
draw();
