# Run The YOLO Distance/TTC Demo In Google Colab

This is the easiest path when the local machine does not have enough disk space for YOLO, OpenCV, and model files.

## Steps

1. Open Google Colab:

   ```text
   https://colab.research.google.com/
   ```

2. Create a new notebook.

3. In Colab, go to:

   ```text
   Runtime -> Change runtime type -> Hardware accelerator -> T4 GPU
   ```

4. Upload your traffic video when the notebook asks for it.

5. Run the notebook cells from top to bottom.

6. Download the output file:

   ```text
   yolo_distance_ttc_output.mp4
   ```

## Notes

- The first run installs `ultralytics` and `opencv-python`.
- YOLO downloads the model automatically on first use.
- Distance is estimated from bounding-box width, so it is an approximation unless the camera is calibrated.
- TTC is calculated from estimated distance change over time.
