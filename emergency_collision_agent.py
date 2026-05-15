from __future__ import annotations

import argparse
import json
import math
import os
import time
from collections import deque
from dataclasses import asdict, dataclass, field
from pathlib import Path

try:
    import cv2
    from ultralytics import YOLO
except ImportError as exc:
    raise SystemExit(
        "Missing vision dependencies. Install them with:\n"
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
BLOCKED_EMERGENCY_NUMBERS = {"911", "112", "999", "000"}


@dataclass
class TrackState:
    track_id: int
    class_name: str
    box: tuple[float, float, float, float]
    distance_m: float
    speed_mps: float = 0.0
    ttc_s: float = math.inf
    history: deque[tuple[float, float]] = field(default_factory=lambda: deque(maxlen=24))


@dataclass
class Incident:
    event_type: str
    frame_index: int
    timestamp_s: float
    primary_track_id: int
    secondary_track_id: int | None
    ttc_s: float
    distance_m: float
    confidence: str
    snapshot_path: str


def estimate_distance(box_width_px: float, class_name: str, focal_px: float) -> float:
    real_width = REAL_WIDTH_METERS.get(class_name, 1.8)
    return max(0.1, (real_width * focal_px) / max(box_width_px, 1.0))


def box_iou(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> float:
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    inter_x1 = max(ax1, bx1)
    inter_y1 = max(ay1, by1)
    inter_x2 = min(ax2, bx2)
    inter_y2 = min(ay2, by2)
    inter_area = max(0.0, inter_x2 - inter_x1) * max(0.0, inter_y2 - inter_y1)
    area_a = max(0.0, ax2 - ax1) * max(0.0, ay2 - ay1)
    area_b = max(0.0, bx2 - bx1) * max(0.0, by2 - by1)
    union = area_a + area_b - inter_area
    return inter_area / union if union > 0 else 0.0


def is_blocked_emergency_number(phone_number: str) -> bool:
    digits = "".join(ch for ch in phone_number if ch.isdigit())
    return digits in BLOCKED_EMERGENCY_NUMBERS


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        clean = line.strip()
        if not clean or clean.startswith("#") or "=" not in clean:
            continue
        key, value = clean.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"'))


class EmergencyNotifier:
    def __init__(self, dry_run: bool, allow_emergency_call: bool) -> None:
        self.dry_run = dry_run
        self.allow_emergency_call = allow_emergency_call

    def notify(self, incident: Incident) -> None:
        message = (
            "Collision risk detected. "
            f"Event={incident.event_type}, TTC={incident.ttc_s:.1f}s, "
            f"distance={incident.distance_m:.1f}m, frame={incident.frame_index}. "
            f"Snapshot={incident.snapshot_path}"
        )
        print("\n=== EMERGENCY AGENT ALERT ===")
        print(message)

        family_phone = os.getenv("FAMILY_PHONE", "").strip()
        emergency_phone = os.getenv("EMERGENCY_PHONE", "").strip()
        if family_phone:
            self._twilio_call(family_phone, message, label="family")
            self._twilio_sms(family_phone, message, label="family")
        else:
            print("No FAMILY_PHONE configured. Family notification simulated.")

        if emergency_phone:
            if is_blocked_emergency_number(emergency_phone) and not self.allow_emergency_call:
                print("Emergency phone is a real emergency number. Skipping automatic call for safety.")
            else:
                self._twilio_call(emergency_phone, message, label="emergency contact")

    def _twilio_client(self):
        sid = os.getenv("TWILIO_ACCOUNT_SID", "").strip()
        token = os.getenv("TWILIO_AUTH_TOKEN", "").strip()
        if not sid or not token:
            return None
        try:
            from twilio.rest import Client
        except ImportError:
            print("Twilio is not installed. Run: pip install -r requirements-agent.txt")
            return None
        return Client(sid, token)

    def _twilio_call(self, to_number: str, message: str, label: str) -> None:
        if self.dry_run:
            print(f"[DRY RUN] Would call {label}: {to_number}")
            return
        from_number = os.getenv("TWILIO_FROM_PHONE", "").strip()
        client = self._twilio_client()
        if not client or not from_number:
            print(f"Twilio call to {label} skipped. Missing Twilio credentials or TWILIO_FROM_PHONE.")
            return
        twiml = f"<Response><Say voice='alice'>{message}</Say></Response>"
        client.calls.create(to=to_number, from_=from_number, twiml=twiml)
        print(f"Placed call to {label}: {to_number}")

    def _twilio_sms(self, to_number: str, message: str, label: str) -> None:
        if self.dry_run:
            print(f"[DRY RUN] Would text {label}: {to_number}")
            return
        from_number = os.getenv("TWILIO_FROM_PHONE", "").strip()
        client = self._twilio_client()
        if not client or not from_number:
            print(f"Twilio SMS to {label} skipped. Missing Twilio credentials or TWILIO_FROM_PHONE.")
            return
        client.messages.create(to=to_number, from_=from_number, body=message)
        print(f"Sent SMS to {label}: {to_number}")


def draw_agent_overlay(frame, incident_pending: bool, incident: Incident | None) -> None:
    height, width = frame.shape[:2]
    status = "AI AGENT: MONITORING"
    color = (35, 210, 120)
    if incident_pending:
        status = "AI AGENT: COLLISION RISK"
        color = (0, 215, 255)
    if incident:
        status = "AI AGENT: EMERGENCY NOTIFIED"
        color = (0, 0, 255)
    cv2.rectangle(frame, (0, 0), (width, 48), (0, 0, 0), -1)
    cv2.putText(frame, status, (18, 32), cv2.FONT_HERSHEY_SIMPLEX, 0.85, color, 2, cv2.LINE_AA)


def save_incident(incident_dir: Path, incident: Incident, frame) -> None:
    incident_dir.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(incident.snapshot_path, frame)
    report_path = incident_dir / f"incident_{incident.frame_index}.json"
    report_path.write_text(json.dumps(asdict(incident), indent=2), encoding="utf-8")
    print(f"Saved incident report: {report_path}")


def run_agent(
    source: Path,
    output: Path,
    model_name: str,
    focal_px: float,
    confidence: float,
    ttc_threshold: float,
    collision_iou: float,
    confirm_frames: int,
    dry_run: bool,
    allow_emergency_call: bool,
) -> None:
    model = YOLO(model_name)
    cap = cv2.VideoCapture(str(source))
    if not cap.isOpened():
        raise SystemExit(f"Could not open video: {source}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    cap.release()

    output.parent.mkdir(parents=True, exist_ok=True)
    incident_dir = output.parent / "incidents"
    writer = cv2.VideoWriter(str(output), cv2.VideoWriter_fourcc(*"mp4v"), fps, (width, height))
    notifier = EmergencyNotifier(dry_run=dry_run, allow_emergency_call=allow_emergency_call)

    tracks: dict[int, TrackState] = {}
    risk_streak = 0
    notified = False
    active_incident: Incident | None = None
    frame_index = 0

    for result in model.track(source=str(source), conf=confidence, persist=True, stream=True, verbose=False):
        frame_index += 1
        frame = result.orig_img.copy()
        visible_tracks: list[TrackState] = []
        current_risk: Incident | None = None

        if result.boxes is not None:
            for box in result.boxes:
                if box.id is None:
                    continue
                class_name = model.names[int(box.cls[0])]
                if class_name not in VEHICLE_CLASSES:
                    continue

                track_id = int(box.id[0])
                x1, y1, x2, y2 = [float(v) for v in box.xyxy[0]]
                distance_m = estimate_distance(x2 - x1, class_name, focal_px)
                previous = tracks.get(track_id)
                speed_mps = 0.0
                ttc_s = math.inf
                if previous:
                    closing_speed = max((previous.distance_m - distance_m) * fps, 0.0)
                    speed_mps = previous.speed_mps * 0.7 + closing_speed * 0.3
                    ttc_s = distance_m / speed_mps if speed_mps > 0.2 else math.inf

                state = TrackState(track_id, class_name, (x1, y1, x2, y2), distance_m, speed_mps, ttc_s)
                state.history = previous.history if previous else deque(maxlen=24)
                state.history.append(((x1 + x2) / 2, (y1 + y2) / 2))
                tracks[track_id] = state
                visible_tracks.append(state)

                color = (0, 0, 255) if ttc_s < ttc_threshold else (40, 220, 110)
                cv2.rectangle(frame, (int(x1), int(y1)), (int(x2), int(y2)), color, 2)
                speed_mph = speed_mps * 2.237
                label = f"ID {track_id} {class_name} {speed_mph:.0f}mph"
                cv2.putText(frame, label, (int(x1), max(24, int(y1) - 8)), cv2.FONT_HERSHEY_SIMPLEX, 0.55, color, 2)
                if math.isfinite(ttc_s):
                    cv2.putText(frame, f"TTC {ttc_s:.1f}s", (int(x1), int(y2) + 20), cv2.FONT_HERSHEY_SIMPLEX, 0.55, color, 2)

                if ttc_s < ttc_threshold:
                    current_risk = Incident(
                        event_type="danger_ttc",
                        frame_index=frame_index,
                        timestamp_s=frame_index / fps,
                        primary_track_id=track_id,
                        secondary_track_id=None,
                        ttc_s=ttc_s,
                        distance_m=distance_m,
                        confidence="medium",
                        snapshot_path=str(incident_dir / f"incident_{frame_index}.jpg"),
                    )

            for idx, first in enumerate(visible_tracks):
                for second in visible_tracks[idx + 1 :]:
                    overlap = box_iou(first.box, second.box)
                    if overlap >= collision_iou:
                        current_risk = Incident(
                            event_type="possible_collision",
                            frame_index=frame_index,
                            timestamp_s=frame_index / fps,
                            primary_track_id=first.track_id,
                            secondary_track_id=second.track_id,
                            ttc_s=min(first.ttc_s, second.ttc_s),
                            distance_m=min(first.distance_m, second.distance_m),
                            confidence="high",
                            snapshot_path=str(incident_dir / f"incident_{frame_index}.jpg"),
                        )

        risk_streak = risk_streak + 1 if current_risk else 0
        if current_risk and risk_streak >= confirm_frames and not notified:
            active_incident = current_risk
            save_incident(incident_dir, active_incident, frame)
            notifier.notify(active_incident)
            notified = True

        draw_agent_overlay(frame, current_risk is not None, active_incident)
        writer.write(frame)

    writer.release()
    print(f"Saved emergency-agent video to {output}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Collision detection agent with emergency/family notification workflow.")
    parser.add_argument("--source", default="local-traffic.mp4", help="Input traffic video path.")
    parser.add_argument("--output", default="outputs/emergency_agent_output.mp4", help="Annotated output video path.")
    parser.add_argument("--model", default="yolo11n.pt", help="Ultralytics YOLO model name or path.")
    parser.add_argument("--focal-px", type=float, default=850.0, help="Approximate camera focal length in pixels.")
    parser.add_argument("--conf", type=float, default=0.35, help="YOLO confidence threshold.")
    parser.add_argument("--ttc-threshold", type=float, default=2.5, help="Seconds below which the agent treats risk as dangerous.")
    parser.add_argument("--collision-iou", type=float, default=0.08, help="Bounding-box overlap threshold for possible impact.")
    parser.add_argument("--confirm-frames", type=int, default=4, help="Consecutive risky frames required before notification.")
    parser.add_argument("--env-file", default=".env", help="Optional environment file for notification settings.")
    parser.add_argument("--live-calls", action="store_true", help="Actually place Twilio calls/texts. Default is dry-run.")
    parser.add_argument(
        "--allow-emergency-call",
        action="store_true",
        help="Allow configured emergency contact calls. Real emergency numbers are blocked unless this is set.",
    )
    args = parser.parse_args()

    load_env_file(Path(args.env_file))
    run_agent(
        source=Path(args.source),
        output=Path(args.output),
        model_name=args.model,
        focal_px=args.focal_px,
        confidence=args.conf,
        ttc_threshold=args.ttc_threshold,
        collision_iou=args.collision_iou,
        confirm_frames=args.confirm_frames,
        dry_run=not args.live_calls,
        allow_emergency_call=args.allow_emergency_call,
    )


if __name__ == "__main__":
    main()
