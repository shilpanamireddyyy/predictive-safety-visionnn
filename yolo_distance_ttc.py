from __future__ import annotations

import argparse
import math
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path

try:
    import cv2
    from ultralytics import YOLO
except ImportError as exc:
    raise SystemExit(
        "Missing dependencies. Free disk space first, then run:\n"
        "  pip install -r requirements-yolo.txt\n"
    ) from exc


VEHICLE_CLASSES = {"car", "truck", "bus", "motorcycle", "bicycle"}
REAL_WIDTH_METERS = {
    "car": 1.8,
    "truck": 2.6,
    "bus": 2.7,
    "motorcycle": 0.8,
    "bicycle": 0.65,
}


@dataclass
class TrackState:
    track_id: int
    class_name: str
    distance_m: float
    speed_mps: float = 0.0
    ttc_s: float = math.inf
    history: deque[tuple[float, float]] = field(default_factory=lambda: deque(maxlen=24))


def estimate_distance(box_width_px: float, class_name: str, focal_px: float) -> float:
    real_width = REAL_WIDTH_METERS.get(class_name, 1.8)
    return max(0.1, (real_width * focal_px) / max(box_width_px, 1.0))


def color_for(track: TrackState) -> tuple[int, int, int]:
    if track.ttc_s < 2.5:
        return (0, 0, 255)
    if track.ttc_s < 5.0:
        return (0, 215, 255)
    return (40, 220, 110)


def draw_label(frame, text: str, x: int, y: int, color: tuple[int, int, int]) -> None:
    font = cv2.FONT_HERSHEY_SIMPLEX
    scale = 0.55
    thickness = 2
    (w, h), _ = cv2.getTextSize(text, font, scale, thickness)
    y = max(h + 8, y)
    cv2.rectangle(frame, (x, y - h - 8), (x + w + 10, y + 4), (0, 0, 0), -1)
    cv2.putText(frame, text, (x + 5, y - 3), font, scale, color, thickness, cv2.LINE_AA)


def process_video(source: Path, output: Path, model_name: str, focal_px: float, confidence: float) -> None:
    model = YOLO(model_name)
    cap = cv2.VideoCapture(str(source))
    if not cap.isOpened():
        raise SystemExit(f"Could not open video: {source}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    output.parent.mkdir(parents=True, exist_ok=True)
    writer = cv2.VideoWriter(str(output), cv2.VideoWriter_fourcc(*"mp4v"), fps, (width, height))

    tracks: dict[int, TrackState] = {}
    frame_index = 0

    for result in model.track(
        source=str(source),
        conf=confidence,
        persist=True,
        stream=True,
        verbose=False,
        classes=None,
    ):
        frame = result.orig_img.copy()
        frame_index += 1

        if result.boxes is None:
            writer.write(frame)
            continue

        danger_active = False
        for box in result.boxes:
            if box.id is None:
                continue

            class_id = int(box.cls[0])
            class_name = model.names[class_id]
            if class_name not in VEHICLE_CLASSES:
                continue

            track_id = int(box.id[0])
            x1, y1, x2, y2 = [float(v) for v in box.xyxy[0]]
            box_width = x2 - x1
            distance_m = estimate_distance(box_width, class_name, focal_px)

            previous = tracks.get(track_id)
            speed_mps = 0.0
            ttc_s = math.inf
            if previous:
                closing_speed = max((previous.distance_m - distance_m) * fps, 0.0)
                speed_mps = previous.speed_mps * 0.7 + closing_speed * 0.3
                ttc_s = distance_m / speed_mps if speed_mps > 0.2 else math.inf

            state = TrackState(track_id, class_name, distance_m, speed_mps, ttc_s)
            state.history = previous.history if previous else deque(maxlen=24)
            state.history.append(((x1 + x2) / 2, (y1 + y2) / 2))
            tracks[track_id] = state

            color = color_for(state)
            danger_active = danger_active or state.ttc_s < 2.5
            cv2.rectangle(frame, (int(x1), int(y1)), (int(x2), int(y2)), color, 2)
            speed_mph = speed_mps * 2.237
            label = f"ID {track_id} {class_name} {speed_mph:.0f}mph"
            draw_label(frame, label, int(x1), int(y1) - 8, color)
            if math.isfinite(ttc_s) and ttc_s < 5:
                draw_label(frame, f"TTC {ttc_s:.1f}s | {distance_m:.0f}m", int(x1), int(y2) + 22, color)

            if len(state.history) > 1:
                points = list(state.history)
                for p1, p2 in zip(points, points[1:]):
                    cv2.line(frame, tuple(map(int, p1)), tuple(map(int, p2)), color, 2)

        if danger_active:
            cv2.rectangle(frame, (0, height // 2 - 24), (width, height // 2 + 24), (0, 0, 180), -1)
            cv2.putText(
                frame,
                "!! DANGER ALERT !!",
                (width // 2 - 180, height // 2 + 10),
                cv2.FONT_HERSHEY_SIMPLEX,
                1.0,
                (255, 255, 255),
                3,
                cv2.LINE_AA,
            )

        writer.write(frame)

    cap.release()
    writer.release()
    print(f"Saved annotated video to {output}")


def main() -> None:
    parser = argparse.ArgumentParser(description="YOLO vehicle detection + distance/speed/TTC video annotator.")
    parser.add_argument(
        "--source",
        default="local-traffic.mp4",
        help="Input video path.",
    )
    parser.add_argument("--output", default="outputs/yolo_distance_ttc_output.mp4", help="Output video path.")
    parser.add_argument("--model", default="yolo11n.pt", help="Ultralytics YOLO model name or path.")
    parser.add_argument("--focal-px", type=float, default=850.0, help="Approximate camera focal length in pixels.")
    parser.add_argument("--conf", type=float, default=0.35, help="Detection confidence threshold.")
    args = parser.parse_args()

    process_video(Path(args.source), Path(args.output), args.model, args.focal_px, args.conf)


if __name__ == "__main__":
    main()
