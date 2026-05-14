const canvas = document.querySelector("#scene");
const ctx = canvas.getContext("2d");

const pauseBtn = document.querySelector("#pauseBtn");
const resetBtn = document.querySelector("#resetBtn");
const nightToggle = document.querySelector("#nightToggle");
const densityRange = document.querySelector("#densityRange");
const dangerBanner = document.querySelector("#dangerBanner");
const riskDot = document.querySelector("#riskDot");
const riskLabel = document.querySelector("#riskLabel");
const objectCount = document.querySelector("#objectCount");
const ttcValue = document.querySelector("#ttcValue");
const speedValue = document.querySelector("#speedValue");
const warningCount = document.querySelector("#warningCount");
const frameLabel = document.querySelector("#frameLabel");
const tracksPanel = document.querySelector("#tracks");

const classStyles = {
  car: { color: "#45d6a8", w: 74, h: 36 },
  bus: { color: "#4aa3ff", w: 112, h: 44 },
  pedestrian: { color: "#ffcf66", w: 26, h: 58 },
};

let objects = [];
let frame = 0;
let paused = false;
let lastTime = performance.now();
let warningTotal = 0;

function seededRandom(seed) {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function createObject(id, lane, type, seedOffset = 0) {
  const style = classStyles[type];
  const direction = lane < 2 ? 1 : -1;
  const y = laneY(lane);
  const startX = direction === 1
    ? -180 - seededRandom(id + seedOffset) * 850
    : canvas.width + 180 + seededRandom(id + seedOffset) * 850;

  return {
    id: `T-${String(id).padStart(3, "0")}`,
    type,
    x: startX,
    y,
    w: style.w,
    h: style.h,
    vx: direction * (74 + seededRandom(id * 3 + 7) * 72),
    vy: 0,
    history: [],
    risk: "clear",
    ttc: Infinity,
  };
}

function laneY(lane) {
  const lanes = [260, 326, 420, 492];
  return lanes[lane % lanes.length];
}

function resetSimulation() {
  const count = Number(densityRange.value);
  const types = ["car", "bus", "pedestrian", "car", "car", "bus", "pedestrian", "car"];
  objects = Array.from({ length: count }, (_, index) => {
    const lane = index % 4;
    return createObject(index + 1, lane, types[index % types.length], index * 17);
  });

  if (objects.length >= 2) {
    objects[0].x = 355;
    objects[0].vx = 126;
    objects[2 % objects.length].x = 850;
    objects[2 % objects.length].vx = -116;
  }

  frame = 0;
  warningTotal = 0;
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(900, Math.floor(rect.width * ratio));
  canvas.height = Math.max(560, Math.floor(rect.height * ratio));
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function update(dt) {
  frame += 1;
  const width = canvas.clientWidth;

  objects.forEach((object, index) => {
    object.x += object.vx * dt;
    object.y += object.vy * dt;
    object.history.push({ x: object.x, y: object.y });
    if (object.history.length > 18) object.history.shift();

    if (object.vx > 0 && object.x > width + 180) {
      Object.assign(object, createObject(index + 1, index % 4, object.type, frame + index));
    }
    if (object.vx < 0 && object.x < -220) {
      Object.assign(object, createObject(index + 1, index % 4, object.type, frame + index));
    }

    object.risk = "clear";
    object.ttc = Infinity;
  });

  predictCollisions();
}

function predictCollisions() {
  for (let i = 0; i < objects.length; i += 1) {
    for (let j = i + 1; j < objects.length; j += 1) {
      const a = objects[i];
      const b = objects[j];
      const verticalGap = Math.abs(a.y - b.y);
      if (verticalGap > 74) continue;

      const dx = (b.x + b.w / 2) - (a.x + a.w / 2);
      const relativeSpeed = a.vx - b.vx;
      if (Math.abs(relativeSpeed) < 1) continue;

      const closing = dx * relativeSpeed > 0;
      if (!closing) continue;

      const distance = Math.abs(dx) - (a.w + b.w) / 2;
      const ttc = distance / Math.abs(relativeSpeed);

      if (ttc > 0 && ttc < 5.5) {
        const level = ttc < 2.2 ? "danger" : "warn";
        applyRisk(a, b, level, ttc);
      }
    }
  }
}

function applyRisk(a, b, level, ttc) {
  [a, b].forEach((object) => {
    if (object.risk !== "danger") object.risk = level;
    object.ttc = Math.min(object.ttc, ttc);
  });

  if (level === "danger" && frame % 30 === 0) {
    warningTotal += 1;
  }
}

function draw() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  ctx.clearRect(0, 0, width, height);

  drawEnvironment(width, height);
  objects.forEach(drawTrackLine);
  objects.forEach(drawObject);
  objects.forEach(drawPrediction);
}

function drawEnvironment(width, height) {
  const night = nightToggle.checked;
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, night ? "#09111f" : "#98c9ee");
  sky.addColorStop(0.45, night ? "#172033" : "#d9f0ff");
  sky.addColorStop(0.46, night ? "#222831" : "#68717b");
  sky.addColorStop(1, night ? "#11151b" : "#2d333a");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = night ? "#15191f" : "#1f8d5a";
  ctx.fillRect(0, height * 0.45, width, height * 0.12);

  ctx.fillStyle = night ? "#242a33" : "#343b44";
  roundRect(0, height * 0.55, width, height * 0.38, 0);
  ctx.fill();

  ctx.strokeStyle = night ? "rgba(255,255,255,0.42)" : "rgba(255,255,255,0.7)";
  ctx.lineWidth = 3;
  ctx.setLineDash([34, 24]);
  [height * 0.64, height * 0.74, height * 0.84].forEach((y) => {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  });
  ctx.setLineDash([]);

  if (night) {
    for (let i = 0; i < 7; i += 1) {
      const x = 70 + i * 190;
      drawStreetLight(x, height * 0.51);
    }
  }
}

function drawStreetLight(x, y) {
  ctx.strokeStyle = "rgba(220, 230, 240, 0.55)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y - 120);
  ctx.lineTo(x + 44, y - 120);
  ctx.stroke();

  const glow = ctx.createRadialGradient(x + 46, y - 108, 0, x + 46, y - 92, 105);
  glow.addColorStop(0, "rgba(255, 210, 105, 0.45)");
  glow.addColorStop(1, "rgba(255, 210, 105, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(x - 70, y - 170, 230, 210);
}

function drawTrackLine(object) {
  if (object.history.length < 2) return;
  ctx.strokeStyle = classStyles[object.type].color;
  ctx.globalAlpha = 0.34;
  ctx.lineWidth = 2;
  ctx.beginPath();
  object.history.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x + object.w / 2, point.y + object.h / 2);
    else ctx.lineTo(point.x + object.w / 2, point.y + object.h / 2);
  });
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawObject(object) {
  const style = classStyles[object.type];
  ctx.save();
  ctx.translate(object.x, object.y);

  ctx.fillStyle = object.type === "pedestrian" ? "#1c232d" : "#111820";
  roundRect(0, 0, object.w, object.h, object.type === "pedestrian" ? 12 : 8);
  ctx.fill();

  ctx.fillStyle = style.color;
  if (object.type === "pedestrian") {
    ctx.beginPath();
    ctx.arc(object.w / 2, 11, 9, 0, Math.PI * 2);
    ctx.fill();
    roundRect(7, 22, object.w - 14, object.h - 24, 8);
    ctx.fill();
  } else {
    roundRect(8, 7, object.w - 16, object.h - 14, 7);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.fillRect(object.w * 0.22, 9, object.w * 0.18, 9);
    ctx.fillRect(object.w * 0.56, 9, object.w * 0.18, 9);
  }

  drawDetectionBox(object, style.color);
  ctx.restore();
}

function drawDetectionBox(object, color) {
  const riskColor = object.risk === "danger" ? "#ff4d4f" : object.risk === "warn" ? "#ffc857" : color;
  ctx.strokeStyle = riskColor;
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 5]);
  ctx.strokeRect(-5, -5, object.w + 10, object.h + 10);
  ctx.setLineDash([]);

  ctx.fillStyle = riskColor;
  ctx.font = "700 12px Inter, sans-serif";
  ctx.fillText(`${object.type.toUpperCase()} ${object.id}`, -4, -12);
}

function drawPrediction(object) {
  if (object.risk === "clear") return;
  const centerX = object.x + object.w / 2;
  const centerY = object.y + object.h / 2;
  const projectedX = centerX + object.vx * Math.min(object.ttc, 3.5);

  ctx.strokeStyle = object.risk === "danger" ? "#ff4d4f" : "#ffc857";
  ctx.lineWidth = object.risk === "danger" ? 4 : 3;
  ctx.setLineDash([10, 8]);
  ctx.beginPath();
  ctx.moveTo(centerX, centerY);
  ctx.lineTo(projectedX, centerY);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.beginPath();
  ctx.arc(projectedX, centerY, object.risk === "danger" ? 18 : 13, 0, Math.PI * 2);
  ctx.stroke();
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function renderTelemetry() {
  const risks = objects.map((object) => object.risk);
  const worstRisk = risks.includes("danger") ? "danger" : risks.includes("warn") ? "warn" : "clear";
  const ttcValues = objects.map((object) => object.ttc).filter(Number.isFinite);
  const closestTtc = ttcValues.length ? Math.min(...ttcValues) : Infinity;
  const avgSpeed = objects.reduce((sum, object) => sum + Math.abs(object.vx), 0) / Math.max(objects.length, 1);

  dangerBanner.hidden = worstRisk !== "danger";
  riskDot.className = `status-dot ${worstRisk === "clear" ? "" : worstRisk}`;
  riskLabel.textContent = worstRisk === "danger" ? "Danger Alert" : worstRisk === "warn" ? "Proximity Warning" : "Monitoring";
  objectCount.textContent = String(objects.length);
  ttcValue.textContent = Number.isFinite(closestTtc) ? `${closestTtc.toFixed(1)}s` : "--";
  speedValue.textContent = `${Math.round(avgSpeed * 0.22)} mph`;
  warningCount.textContent = String(warningTotal);
  frameLabel.textContent = `Frame ${String(frame).padStart(4, "0")}`;

  tracksPanel.innerHTML = objects
    .slice()
    .sort((a, b) => riskRank(b.risk) - riskRank(a.risk))
    .map((object) => {
      const speed = Math.round(Math.abs(object.vx) * 0.22);
      const ttc = Number.isFinite(object.ttc) ? `${object.ttc.toFixed(1)}s TTC` : "No conflict";
      return `
        <article class="track ${object.risk}">
          <b>${object.id} ${object.type}</b>
          <span>${object.risk.toUpperCase()}</span>
          <span>${speed} mph</span>
          <span>${ttc}</span>
        </article>
      `;
    })
    .join("");
}

function riskRank(risk) {
  return risk === "danger" ? 2 : risk === "warn" ? 1 : 0;
}

function loop(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.04);
  lastTime = now;

  if (!paused) update(dt);
  draw();
  renderTelemetry();
  requestAnimationFrame(loop);
}

pauseBtn.addEventListener("click", () => {
  paused = !paused;
  pauseBtn.textContent = paused ? "Resume" : "Pause";
  pauseBtn.setAttribute("aria-pressed", String(paused));
});

resetBtn.addEventListener("click", resetSimulation);
densityRange.addEventListener("input", resetSimulation);
window.addEventListener("resize", () => {
  resizeCanvas();
  resetSimulation();
});

resizeCanvas();
resetSimulation();
requestAnimationFrame(loop);
