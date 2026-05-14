"""
Predictive AI safety system demo.

This script creates a CCTV-style traffic scene, annotates detections, tracks
object motion, estimates speed, predicts time-to-collision, and raises a
danger alert when trajectories become unsafe.
"""

from __future__ import annotations

import argparse
import math
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

try:
    import cv2
except ImportError:  # pragma: no cover - depends on local environment
    cv2 = None


WIDTH = 1280
HEIGHT = 720
FPS = 30
PX_TO_MPH = 0.18


@dataclass
class Detection:
    track_id: int
    label: str
    x: float
    y: float
    w: int
    h: int
    vx: float
    vy: float = 0.0
    history: list[tuple[int, int]] = field(default_factory=list)
    speed_mph: float = 0.0
    ttc: float = math.inf
    risk: str = "clear"

    @property
    def center(self) -> tuple[float, float]:
        return self.x + self.w / 2, self.y + self.h / 2


CLASS_COLORS = {
    "car": (55, 225, 96),
    "bus": (255, 174, 72),
    "pedestrian": (82, 216, 255),
}


def build_tracks() -> list[Detection]:
    return [
        Detection(1, "car", 80, 510, 215, 62, 118),
        Detection(2, "pedestrian", 315, 155, 34, 84, 42),
        Detection(3, "bus", 520, 180, 190, 72, -75),
        Detection(4, "car", 1060, 120, 135, 54, -88),
        Detection(5, "car", 1040, 392, 168, 58, -132),
        Detection(6, "pedestrian", 1228, 338, 32, 82, -28),
    ]


def draw_scene_base(night: bool) -> np.ndarray:
    if cv2 is None:
        raise RuntimeError("OpenCV is not installed.")

    frame = np.zeros((HEIGHT, WIDTH, 3), dtype=np.uint8)
    if night:
        frame[:] = (33, 37, 44)
        road = (48, 52, 58)
        lane = (150, 150, 145)
    else:
        frame[:] = (128, 141, 148)
        road = (112, 118, 121)
        lane = (224, 224, 214)

    cv2.rectangle(frame, (0, 95), (WIDTH, HEIGHT), road, -1)
    cv2.rectangle(frame, (0, 0), (WIDTH, 95), (55, 64, 70), -1)
    cv2.rectangle(frame, (0, 135), (WIDTH, 182), (88, 93, 96), -1)
    cv2.rectangle(frame, (0, 500), (WIDTH, 545), (91, 95, 96), -1)

    for x in range(95, WIDTH, 128):
        cv2.line(frame, (x, 96), (x + 52, 182), lane, 3)
        cv2.line(frame, (x, 548), (x + 62, HEIGHT), lane, 3)

    for y in [250, 365, 475]:
        for x in range(0, WIDTH, 82):
            cv2.line(frame, (x, y), (x + 42, y), lane, 3)

    cv2.rectangle(frame, (0, 286), (WIDTH, 326), (92, 74, 71), -1)
    cv2.rectangle(frame, (0, 326), (WIDTH, 336), (142, 88, 80), -1)

    if night:
        overlay = frame.copy()
        for x in [115, 380, 650, 920, 1150]:
            cv2.circle(overlay, (x, 92), 145, (70, 92, 130), -1)
        frame = cv2.addWeighted(overlay, 0.22, frame, 0.78, 0)

    cv2.putText(frame, "CCTV Intersection Camera 07", (38, 42), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (235, 235, 235), 2)
    cv2.putText(frame, "Detection | Tracking | Speed | TTC", (38, 72), cv2.FONT_HERSHEY_SIMPLEX, 0.52, (230, 230, 230), 1)
    return frame


def update_tracks(tracks: list[Detection], frame_index: int) -> None:
    for item in tracks:
        item.x += item.vx / FPS
        item.y += item.vy / FPS
        item.speed_mph = abs(item.vx) * PX_TO_MPH
        item.risk = "clear"
        item.ttc = math.inf

        cx, cy = item.center
        item.history.append((int(cx), int(cy)))
        item.history[:] = item.history[-36:]

        if item.vx > 0 and item.x > WIDTH + 80:
            item.x = -240 - (frame_index % 80)
        if item.vx < 0 and item.x < -260:
            item.x = WIDTH + 120 + (frame_index % 70)


def predict_ttc(tracks: list[Detection]) -> None:
    for i, a in enumerate(tracks):
        for b in tracks[i + 1 :]:
            if abs(a.center[1] - b.center[1]) > 115:
                continue

            dx = b.center[0] - a.center[0]
            relative_speed = a.vx - b.vx
            if abs(relative_speed) < 1:
                continue

            moving_toward_each_other = dx * relative_speed > 0
            if not moving_toward_each_other:
                continue

            remaining_distance = abs(dx) - (a.w + b.w) / 2
            ttc = remaining_distance / abs(relative_speed)
            if 0 < ttc < 5.8:
                risk = "danger" if ttc < 2.4 else "warning"
                for item in [a, b]:
                    item.ttc = min(item.ttc, ttc)
                    if item.risk != "danger":
                        item.risk = risk


def draw_annotations(frame: np.ndarray, tracks: list[Detection]) -> bool:
    danger = any(item.risk == "danger" for item in tracks)

    for item in tracks:
        x1, y1 = int(item.x), int(item.y)
        x2, y2 = x1 + item.w, y1 + item.h
        color = (0, 0, 255) if item.risk == "danger" else (0, 215, 255) if item.risk == "warning" else CLASS_COLORS[item.label]

        cv2.rectangle(frame, (x1, y1), (x2, y2), color, 3)
        label = f"ID:{item.track_id} {item.label.title()} {item.speed_mph:.0f}mph"
        cv2.putText(frame, label, (x1, max(22, y1 - 9)), cv2.FONT_HERSHEY_SIMPLEX, 0.52, color, 2)

        if math.isfinite(item.ttc):
            cv2.putText(frame, f"TTC {item.ttc:.1f}s", (x1, y2 + 22), cv2.FONT_HERSHEY_SIMPLEX, 0.55, color, 2)

        if len(item.history) > 1:
            for p1, p2 in zip(item.history, item.history[1:]):
                cv2.line(frame, p1, p2, color, 2)

        cx, cy = item.center
        projection = (int(cx + item.vx * min(item.ttc if math.isfinite(item.ttc) else 1.5, 3.0)), int(cy))
        cv2.arrowedLine(frame, (int(cx), int(cy)), projection, color, 2, tipLength=0.18)

    risky = [item for item in tracks if math.isfinite(item.ttc)]
    for i, a in enumerate(risky):
        for b in risky[i + 1 :]:
            if abs(a.ttc - b.ttc) < 0.05 and a.risk == b.risk:
                cv2.line(frame, tuple(map(int, a.center)), tuple(map(int, b.center)), (0, 0, 255), 2)

    if danger:
        cv2.rectangle(frame, (0, 302), (WIDTH, 350), (0, 0, 160), -1)
        cv2.addWeighted(frame, 0.82, np.full_like(frame, (0, 0, 40)), 0.18, 0, frame)
        cv2.putText(frame, "!! DANGER ALERT !!", (500, 334), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (255, 255, 255), 3)

    return danger


def render_demo(output: Path, preview: Path, frames: int, night: bool) -> bool:
    if cv2 is None:
        fallback = preview.with_suffix(".svg")
        write_fallback_svg(fallback, night)
        print("OpenCV is not installed, so the MP4 render was skipped.")
        print("Install it with: pip install -r requirements-cv.txt")
        print(f"Fallback preview saved to {fallback}")
        return False

    tracks = build_tracks()
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(str(output), fourcc, FPS, (WIDTH, HEIGHT))

    preview_frame = None
    for frame_index in range(frames):
        frame = draw_scene_base(night)
        update_tracks(tracks, frame_index)
        predict_ttc(tracks)
        danger = draw_annotations(frame, tracks)

        if danger and preview_frame is None:
            preview_frame = frame.copy()
        writer.write(frame)

    writer.release()
    if preview_frame is None:
        preview_frame = frame
    cv2.imwrite(str(preview), preview_frame)
    return True


def write_fallback_svg(path: Path, night: bool) -> None:
    bg = "#22262d" if night else "#848d92"
    road = "#343a40" if night else "#70767a"
    lane = "#d7d7cf" if not night else "#9fa6ad"
    tint = "#7a342f" if not night else "#562f35"
    overlay = "#b7252e"
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <rect width="1280" height="720" fill="{bg}"/>
  <rect y="96" width="1280" height="624" fill="{road}"/>
  <rect y="132" width="1280" height="48" fill="#5d6368"/>
  <rect y="286" width="1280" height="48" fill="{tint}" opacity="0.9"/>
  <rect y="500" width="1280" height="45" fill="#5b6064"/>
  <g stroke="{lane}" stroke-width="4" stroke-dasharray="46 34" opacity="0.9">
    <line x1="0" y1="250" x2="1280" y2="250"/>
    <line x1="0" y1="365" x2="1280" y2="365"/>
    <line x1="0" y1="475" x2="1280" y2="475"/>
    <line x1="120" y1="96" x2="520" y2="720"/>
    <line x1="420" y1="96" x2="820" y2="720"/>
    <line x1="720" y1="96" x2="1120" y2="720"/>
  </g>
  <text x="38" y="42" fill="#f5f5f5" font-family="Arial" font-size="22" font-weight="700">CCTV Intersection Camera 07</text>
  <text x="38" y="72" fill="#f1f1f1" font-family="Arial" font-size="16">Detection | Tracking | Speed | TTC</text>
  <g fill="none" stroke-width="4">
    <rect x="80" y="510" width="215" height="62" stroke="#ff2f2f"/>
    <rect x="315" y="155" width="34" height="84" stroke="#52d8ff"/>
    <rect x="520" y="180" width="190" height="72" stroke="#ffae48"/>
    <rect x="1060" y="120" width="135" height="54" stroke="#37e160"/>
    <rect x="1040" y="392" width="168" height="58" stroke="#ff2f2f"/>
    <rect x="1228" y="338" width="32" height="82" stroke="#52d8ff"/>
    <line x1="188" y1="541" x2="1124" y2="421" stroke="#ff2f2f"/>
    <line x1="332" y1="197" x2="615" y2="216" stroke="#ffd54d"/>
    <line x1="1124" y1="421" x2="188" y2="541" stroke="#ff2f2f" opacity="0.65"/>
  </g>
  <g font-family="Arial" font-size="17" font-weight="700">
    <text x="82" y="500" fill="#ff2f2f">ID:1 Car 21mph</text>
    <text x="315" y="145" fill="#52d8ff">ID:2 Pedestrian 8mph</text>
    <text x="520" y="170" fill="#ffae48">ID:3 Bus 14mph</text>
    <text x="1060" y="110" fill="#37e160">ID:4 Car 16mph</text>
    <text x="1040" y="382" fill="#ff2f2f">ID:5 Car 24mph</text>
    <text x="958" y="472" fill="#ff2f2f">TTC 1.9s</text>
  </g>
  <rect x="0" y="302" width="1280" height="48" fill="{overlay}" opacity="0.78"/>
  <text x="500" y="334" fill="#ffffff" font-family="Arial" font-size="30" font-weight="900">!! DANGER ALERT !!</text>
</svg>
"""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(svg, encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate a predictive road safety OpenCV demo.")
    parser.add_argument("--output", default="outputs/predictive_safety_demo.mp4", help="Output MP4 path.")
    parser.add_argument("--preview", default="outputs/predictive_safety_preview.png", help="Preview PNG path.")
    parser.add_argument("--frames", type=int, default=210, help="Number of frames to render.")
    parser.add_argument("--night", action="store_true", help="Render the scene in night mode.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    output = Path(args.output)
    preview = Path(args.preview)
    output.parent.mkdir(parents=True, exist_ok=True)
    preview.parent.mkdir(parents=True, exist_ok=True)
    rendered_video = render_demo(output, preview, args.frames, args.night)
    if rendered_video:
        print(f"Video saved to {output}")
        print(f"Preview saved to {preview}")


if __name__ == "__main__":
    main()
