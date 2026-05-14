const video = document.querySelector("#claimVideo");
const canvas = document.querySelector("#claimOverlay");
const ctx = canvas.getContext("2d");
const playPause = document.querySelector("#playPause");
const jumpImpact = document.querySelector("#jumpImpact");
const exportReport = document.querySelector("#exportReport");
const videoTime = document.querySelector("#videoTime");
const markers = document.querySelectorAll(".marker");

const impactTime = 7.8;
const objects = [
  { id: 1, type: "Truck", speed: 43, risk: "danger", points: [[1.2, 0.42, 0.18, 0.23, 0.18], [4, 0.40, 0.25, 0.25, 0.20], [8, 0.37, 0.37, 0.29, 0.24], [12.8, 0.34, 0.51, 0.32, 0.28]] },
  { id: 2, type: "Car", speed: 18, risk: "danger", points: [[0.4, 0.42, 0.61, 0.18, 0.12], [4, 0.42, 0.61, 0.19, 0.12], [8, 0.42, 0.61, 0.20, 0.13], [13.4, 0.42, 0.61, 0.20, 0.13]] },
  { id: 3, type: "Car", speed: 31, risk: "clear", points: [[2.6, 0.17, 0.42, 0.17, 0.12], [5, 0.15, 0.48, 0.18, 0.13], [10, 0.13, 0.55, 0.19, 0.14], [13.2, 0.12, 0.60, 0.20, 0.15]] },
];

function resize() {
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.floor(rect.width * ratio);
  canvas.height = Math.floor(rect.height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function videoRect() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const vw = video.videoWidth || 720;
  const vh = video.videoHeight || 1280;
  const videoRatio = vw / vh;
  const boxRatio = width / height;
  if (videoRatio > boxRatio) {
    const renderedHeight = width / videoRatio;
    return { x: 0, y: (height - renderedHeight) / 2, width, height: renderedHeight };
  }
  const renderedWidth = height * videoRatio;
  return { x: (width - renderedWidth) / 2, y: 0, width: renderedWidth, height };
}

function position(track, time) {
  if (time < track.points[0][0] || time > track.points.at(-1)[0]) return null;
  let start = track.points[0];
  let end = track.points.at(-1);
  for (let i = 0; i < track.points.length - 1; i += 1) {
    if (time >= track.points[i][0] && time <= track.points[i + 1][0]) {
      start = track.points[i];
      end = track.points[i + 1];
      break;
    }
  }
  const alpha = (time - start[0]) / Math.max(end[0] - start[0], 0.001);
  return {
    x: start[1] + (end[1] - start[1]) * alpha,
    y: start[2] + (end[2] - start[2]) * alpha,
    w: start[3] + (end[3] - start[3]) * alpha,
    h: start[4] + (end[4] - start[4]) * alpha,
  };
}

function mapBox(box, rect) {
  return {
    x: rect.x + box.x * rect.width,
    y: rect.y + box.y * rect.height,
    w: box.w * rect.width,
    h: box.h * rect.height,
  };
}

function draw() {
  const rect = videoRect();
  const time = video.currentTime || 0;
  ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 2;
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);

  const visible = objects.map((object) => ({ ...object, box: position(object, time) })).filter((object) => object.box);
  visible.forEach((object) => drawObject(object, rect, Math.abs(time - impactTime) < 3 && object.risk === "danger"));

  if (Math.abs(time - impactTime) < 3) drawImpact(visible, rect);

  videoTime.textContent = formatTime(time);
  requestAnimationFrame(draw);
}

function drawObject(object, rect, danger) {
  const box = mapBox(object.box, rect);
  const color = danger ? "#ff3131" : object.risk === "clear" ? "#28a766" : "#c58a00";
  ctx.strokeStyle = color;
  ctx.lineWidth = danger ? 4 : 2;
  ctx.strokeRect(box.x, box.y, box.w, box.h);
  ctx.fillStyle = "rgba(0,0,0,0.75)";
  ctx.fillRect(box.x + 4, box.y + 4, Math.min(box.w - 8, 120), 22);
  ctx.fillStyle = color;
  ctx.font = "800 13px Arial, sans-serif";
  ctx.fillText(`ID ${object.id} ${object.speed}mph`, box.x + 10, box.y + 19);
}

function drawImpact(visible, rect) {
  const truck = visible.find((object) => object.id === 1);
  const car = visible.find((object) => object.id === 2);
  if (!truck || !car) return;
  const a = center(mapBox(truck.box, rect));
  const b = center(mapBox(car.box, rect));
  ctx.strokeStyle = "#ff3131";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function center(box) {
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

function formatTime(value) {
  const seconds = Math.floor(value % 60).toString().padStart(2, "0");
  return `00:${seconds}`;
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

jumpImpact.addEventListener("click", () => {
  video.currentTime = impactTime;
  video.play();
});

exportReport.addEventListener("click", () => {
  const report = [
    "AI Insurance Claim Review",
    "Claim #AIC-2026-0513",
    "Preliminary finding: likely rear-end collision risk.",
    "Evidence: low TTC, closing trajectory, detected truck/car objects.",
    "Suggested reserve: $5,440",
  ].join("\n");
  const blob = new Blob([report], { type: "text/plain" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "claim-ai-summary.txt";
  link.click();
  URL.revokeObjectURL(link.href);
});

markers.forEach((marker) => {
  marker.addEventListener("click", () => {
    video.currentTime = Number(marker.dataset.time);
    video.play();
  });
});

window.addEventListener("resize", resize);
resize();
draw();
