# Dance Catch-up · Implementation plan

Build a browser app with two modes. **Formation** maps a selected dancer’s start and finish from a prerecorded eight-count clip to the learner’s floor and scores the landing on count eight. **Move Drill** checks one right-arm raise when the learner steps closer. Both modes share one fixed webcam and one pose detector.

## Setup

Use React, TypeScript, Vite, MediaPipe Pose Landmarker Lite, and Chrome on localhost. Use a fixed webcam stand, tape, and a tape measure. Scaffold only if the repo has no app. Commit the npm lockfile.

```sh
npm create vite@latest . -- --template react-ts  # Empty repo only
npm install --save-exact @mediapipe/tasks-vision
mkdir -p public/models public/mediapipe/wasm
curl -fL 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task' -o public/models/pose_landmarker_lite.task
cp node_modules/@mediapipe/tasks-vision/wasm/* public/mediapipe/wasm/
npm run dev
```

## Shared contract

- `ImagePoint = { x: number; y: number }` uses normalized, unmirrored video coordinates, right and down positive. Convert clicks relative to the video content rectangle and ignore letterbox clicks.
- `FloorPoint = { x: number; y: number }` uses meters. The origin is the near-left floor corner **as seen by the camera**. Positive x goes camera-right, positive y goes away from the camera. Use this orientation in both rooms. The learner faces the camera, so camera-right is the learner’s left.
- `Calibration = { corners: [ImagePoint, ImagePoint, ImagePoint, ImagePoint]; widthM: number; depthM: number }`. Corner order is near-left, near-right, far-right, far-left.
- `PoseSample = { timeMs: number; landmarks: { x: number; y: number; visibility: number }[] }`. Use `performance.now()` for live sample timestamps. A required landmark is valid at visibility ≥ 0.6. Emit an empty landmark array when no pose is detected.

## Build checklist

- [ ] **Camera · `usePoseCamera.ts`, `CameraView.tsx`**. Start with a raw `getUserMedia` preview. Initialize one Pose Landmarker in `VIDEO` mode with `numPoses: 1`. Load WASM from `/mediapipe/wasm` and the model from `/models/pose_landmarker_lite.task`. Sample new frames at about 12 Hz. Release the frame loop, detector, and stream on unmount. **Check:** Both heels track at the farthest target. Both shoulders and the right wrist track at the close-up spot.

- [ ] **Reference · `roles.ts`, `ReferencePlayer.tsx`**. Use bundled `public/reference.mp4` and `public/arm-raise.mp4`. Film two dancers facing a fixed camera at 90 BPM with all four measured reference corners visible. On counts 5–7, the dancers travel to opposite sides. On 8, each plants both feet and holds the right arm at shoulder height for one second. Film that arm raise separately at close range. Store the reference calibration and two role records in `roles.ts`. Each record has `id`, `label`, `startHeels`, and `finishHeels`. Each heel pair contains two image points tagged by hand on counts 1 and 8. **Check:** Both clips play and each role has distinct finish coordinates.

- [ ] **Calibration · `calibration.ts`, `CalibrationView.tsx`**. Use the stored reference calibration. For practice, ask for width and depth in meters and four corner clicks on the live view. Compute one image-to-floor homography per view, mapping ordered corners to `(0,0), (W,0), (W,D), (0,D)`. Reject nonpositive dimensions, invalid corner order, and degenerate solves. Keep practice calibration in app state and expose a recalibrate action for camera or framing changes. **Check:** Project a measured interior mark in each view. Require ≤ 0.15 m error before testing live scoring.

- [ ] **Scaled targets · `formation.ts`, `FloorMap.tsx`**. For each reference checkpoint, project both heels to floor meters and average them. With reference dimensions `Wr × Dr` and practice dimensions `Wp × Dp`, compute `s = min(1, Wp/Wr, Dp/Dr)`. Map every reference floor point to `(s*x + (Wp-s*Wr)/2, s*y + (Dp-s*Dr)/2)`. Draw the practice boundary and an arrow from the selected role’s start to finish. **Check:** A 4 × 3 m reference fitted into a 3 × 3 m practice area uses scale 0.75 and depth offset 0.375 m. A 2 m move becomes 1.5 m.

- [ ] **Landing · `formation.ts`, `useRehearsal.ts`**. First verify scoring with an untimed hold. For each live sample, project heels 29 and 30 separately with the practice homography and average them. Score a stable landing within `min(0.25 m, 0.4 × distance between the two scaled finishes)` of the target using Euclidean distance. On a miss, compute target minus landing and cue its largest absolute axis. Camera-right means “Step left,” camera-left means “Step right,” toward camera means “Step forward,” and away means “Step back.” Use x to break ties. Then add a four-beat count-in at 90 BPM. Set `beatMs = 60000/90`. Count 1 starts four intervals after Start and count 8 starts seven intervals after count 1. Finalize once the sampling window closes. Collect valid heel samples 150–700 ms after count 8 starts. Compute the component-wise median and require at least three samples within 0.15 m of it. Otherwise show “Position unclear.” Lock the role during each attempt and clear samples on retry. **Check:** A held landing passes for its own role and fails for the other. A missing pose yields “Position unclear.”

- [ ] **Close-up drill · `MoveDrill.tsx`, `App.tsx`**. Show the close-up reference beside the shared live feed and ask the learner to face the camera at the drill spot. Use right wrist 16, right shoulder 12, and left shoulder 11. Convert coordinates to video pixels. The arm passes when wrist y ≤ right shoulder y + 0.15 × shoulder span in pixels. Require three consecutive samples with the same result before showing “Arm up” or “Raise your right arm.” Clear feedback and reset the streak immediately if a required joint is unclear or shoulder span is zero. Keep the camera and practice calibration mounted during mode switches. **Check:** Raise the wrist to clear the cue, then return to Formation and score a landing without recalibrating.

- [ ] **Integration · `App.tsx`, `types.ts`**. Formation shows the group clip, role picker, live view, floor map, beat count, and result. Enable a timed attempt only after camera startup and valid calibration. Cancel the active attempt when leaving Formation. **Check:** Run `npm run build` and verify both modes from a fresh tab.
