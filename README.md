# Predictive AI Safety Vision Demo

A portfolio-style project that demonstrates how computer vision tasks can combine into a real-time accident-prevention workflow.

## What It Shows

- Detection and classification for cars, buses, and pedestrians.
- Frame-by-frame object tracking with motion trails.
- Speed estimation from tracked movement.
- Time-to-collision prediction using relative speed and trajectory.
- Proximity warnings and a data-driven danger alert.
- Day and night visualization to show the same safety logic under different conditions.

## Option 1: Browser Demo

Open `index.html` in a browser:

```text
predictive-safety-vision/index.html
```

No install step is required. The demo uses plain HTML, CSS, and JavaScript.

## Option 2: Real Video Browser Demo

Open `real-video-demo.html` in a browser:

```text
predictive-safety-vision/real-video-demo.html
```

This version uses your local traffic MP4 from Downloads and runs an in-browser COCO-SSD object detector with TensorFlow.js. It detects visible cars, trucks, buses, people, motorcycles, and bicycles, assigns simple track IDs, estimates distance from bounding-box width, estimates approach speed from distance changes, and calculates TTC.

The first load needs internet access because the browser downloads TensorFlow.js and the COCO-SSD model from CDN.

## Option 3: Python/OpenCV Demo

Install dependencies:

```bash
pip install -r requirements-cv.txt
```

Render the CCTV-style annotated video:

```bash
python opencv_collision_demo.py
```

Render a night-mode version:

```bash
python opencv_collision_demo.py --night --output outputs/predictive_safety_night.mp4 --preview outputs/predictive_safety_night_preview.png
```

The script exports:

- `outputs/predictive_safety_demo.mp4`
- `outputs/predictive_safety_preview.png`

If OpenCV is not installed yet, the script still writes a fallback annotated SVG preview so the project can be reviewed without a heavy dependency install.

## Option 4: Real YOLO Distance/TTC Pipeline

After freeing disk space, install the YOLO dependencies:

```bash
pip install -r requirements-yolo.txt
```

Run real object detection, tracking, distance estimation, speed estimation, and TTC calculation on your downloaded traffic video:

```bash
python yolo_distance_ttc.py
```

The annotated output is saved to:

```text
outputs/yolo_distance_ttc_output.mp4
```

## Option 5: Emergency Collision Agent

This layer watches the YOLO detections for sustained danger signals, saves an incident snapshot/report, and can notify a configured family contact. By default it runs in dry-run mode, so it prints the emergency workflow without placing real calls.

Install the agent dependencies:

```bash
pip install -r requirements-agent.txt
```

Run the agent on a traffic video:

```bash
python emergency_collision_agent.py --source local-traffic.mp4
```

The output video and incident files are saved to:

```text
outputs/emergency_agent_output.mp4
outputs/incidents/
```

To connect real family notifications, copy `.env.example` to `.env`, add Twilio credentials and phone numbers, then run:

```bash
python emergency_collision_agent.py --source local-traffic.mp4 --live-calls
```

For safety, the project does not automatically call real emergency numbers such as 911 in normal demo mode. Use a family number, test number, or approved emergency contact workflow for demonstrations.

## Project Files

- `index.html` contains the dashboard layout.
- `styles.css` handles the responsive safety-system interface.
- `app.js` runs the simulation, tracking, speed analysis, TTC prediction, and canvas rendering.
- `real-video-demo.html`, `real-video.css`, and `real-video-overlay.js` run the real-footage browser demo with TensorFlow.js object detection.
- `opencv_collision_demo.py` generates a LinkedIn-style CCTV safety video using OpenCV.
- `requirements-cv.txt` lists the Python dependencies for the OpenCV version.
- `yolo_distance_ttc.py` runs real YOLO detection/tracking and estimates distance, speed, and TTC.
- `requirements-yolo.txt` lists the YOLO pipeline dependencies.
- `emergency_collision_agent.py` adds incident detection, reporting, and optional family-contact notifications.
- `requirements-agent.txt` lists the emergency-agent dependencies.

## How TTC Is Calculated

For every pair of nearby road users, the demo compares their positions and relative velocity. If two objects are moving toward each other, it estimates:

```text
time to collision = remaining distance / relative closing speed
```

Objects below the warning threshold are highlighted. Objects below the danger threshold trigger the red alert.
