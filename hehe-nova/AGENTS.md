# Dance Catch-up · Agent guide

This is the single source of truth for AI agents working on this repo. It merges the product outline (`Plans/PROTOTYPE_PLAN.md`) and the technical build plan (`Plans/PLAN.md`). If those files and this one disagree, this file wins. If something here is ambiguous, ask the team rather than guessing.

Read sections 1 to 4 before writing code. Section 5 is the build order. Section 6 lists open conflicts you must not resolve on your own.

## 1. Product goal

Build a convincing role-aware dance rehearsal coach. A dancer who missed rehearsal chooses a phrase, selects the dancer they need to learn, understands that role's steps and formation path, practices in front of one webcam, receives one specific correction, and retries only the relevant section.

**Core idea.** Most dance tools compare one learner with one performer. Group choreography adds a second responsibility: each dancer follows a role-specific path and lands in a different place in the formation. The app judges both how the learner moves and where the selected role must travel and land.

**Defining reveal.** One captured landing passes for one role and fails for another. The physical attempt does not change. Only the selected role's target changes.

The prototype supports one prepared rehearsal. It does not parse arbitrary dance videos.

### Out of scope

Do not build any of these:

- public dance databases;
- automatic parsing of arbitrary rehearsal videos;
- automatic choreography descriptions without human verification;
- centimeter-level floor reconstruction;
- perfect recognition of every intermediate step;
- generated viewpoints presented as unseen ground truth;
- large ensembles or frequent occlusion;
- model training or a large training dataset.

## 2. Repo, stack, and working rules

- The app lives in `hehe-nova/` and is already scaffolded with React, TypeScript, and Vite. Do not run `npm create vite` again.
- Use MediaPipe Pose Landmarker Lite (`@mediapipe/tasks-vision`, pinned exactly). Target Chrome on localhost.
- Node 22.12 or newer. Install with `npm ci` and commit the lockfile.
- Assets are already in place, so do not re-download them unless they are missing:
  - Model: `public/models/pose_landmarker_lite.task`, loaded from `/models/pose_landmarker_lite.task`.
  - WASM: `public/mediapipe/wasm/`, loaded from `/mediapipe/wasm`. Run `npm run copyWasm` if the MediaPipe version changes.
- Commands: `npm run dev`, `npm run build`, `npm run preview`, `npm run typecheck`, `npm run lint`. Run `npm run build` and `npm run lint` before calling work done.
- Scripts must work on Windows, macOS, and Linux. Use Node for file operations in npm scripts, not `rm` or `cp`.
- Use camelCase for variables, functions, and file-local names, and PascalCase file names for components. Write comments as plain sentences with no banners or decorative styles.
- Global styles go in `src/index.css`. Each component imports only its own CSS file.

### Secrets and language models

- The OpenRouter key lives only in `.env.local` as `OPENROUTER_API_KEY`. Never commit it, never put it in a `VITE_` variable, and never put it in source files. OpenRouter disables keys that appear in a repo.
- Only server side code may read the key. How the browser reaches OpenRouter (a Vite proxy or a separate backend) has not been decided. See section 6.
- A language model may rephrase a correction the evaluator already produced. It must never decide whether an attempt passed, and the app must still work with template text when the model call fails.

## 3. Coordinate systems and data contract

Three coordinate systems have different jobs. Never substitute one for another. In particular, a body-normalized pose cannot establish where the learner landed.

| System | Units and orientation | Used for |
| --- | --- | --- |
| Video (`ImagePoint`) | Normalized 0 to 1, **unmirrored**, x right and y down | Highlighting dancers, landmark positions, calibration clicks |
| Body-relative | Pose centered and scaled to the body | Comparing posture across body sizes and camera distances |
| Floor (`FloorPoint`) | Meters on a calibrated floor plane | Formation targets and landing scoring |

### Shared types

- `ImagePoint = { x: number; y: number }`. Coordinates are normalized and unmirrored, with right and down positive. Convert clicks relative to the video content rectangle and ignore clicks in the letterbox. The webcam view may be mirrored visually, but internal coordinates never are.
- `FloorPoint = { x: number; y: number }` in meters. The origin is the near-left floor corner **as seen by the camera**. Positive x goes camera-right and positive y goes away from the camera. Use this orientation in both the reference room and the practice room. The learner faces the camera, so camera-right is the learner's left.
- `Calibration = { corners: [ImagePoint, ImagePoint, ImagePoint, ImagePoint]; widthM: number; depthM: number }`. Corner order is near-left, near-right, far-right, far-left.
- `PoseSample = { timeMs: number; landmarks: { x: number; y: number; visibility: number }[] }`. Live timestamps use `performance.now()`. A required landmark is valid at visibility ≥ 0.6. Emit an empty landmark array when no pose is detected.

### MediaPipe landmark indices used

| Index | Landmark |
| --- | --- |
| 11 | Left shoulder |
| 12 | Right shoulder |
| 16 | Right wrist |
| 29 | Left heel |
| 30 | Right heel |

### Choreography metadata

The team supplies this by hand, and the app treats it as the source of truth. Automated extraction is not part of the first slice.

- phrase names, start times, and end times;
- timestamps for counts 1 through 8;
- role names and display colors;
- the selected dancer's screen location through each phrase;
- formation positions at the start and end of each phrase;
- important foot plants and travel directions;
- facing direction at important counts;
- reference body poses at judged counts;
- one short teaching instruction per learning chunk.

The minimum role record for milestone A is `{ id, label, startHeels, finishHeels }`. Each heel pair is two `ImagePoint`s tagged by hand on counts 1 and 8 of the reference clip. Store the reference calibration and the role records in `src/roles.ts`.

## 4. User experience

1. **Choose what to review.** Phrase cards, each with a short preview, its count range, and a small formation-change diagram. The learner can open a phrase, a smaller count range, the last attempted phrase, or a phrase marked weak.
2. **Choose a role.** The reference player highlights the selected dancer with a persistent color, outline, marker, or spotlight and de-emphasizes the others. Changing roles updates the highlight, formation path, target landing, key poses, teaching notes, and scoring target together.
3. **Learn the phrase.** Normal and slow playback, looping, a visible count indicator, a floor path, footsteps and facing changes, the final body shape, and an alternate angle when available. Teach in short chunks such as counts 1 to 2 or 1 to 4. Each chunk says which foot starts, where the dancer travels, when, and what shape ends it.
4. **Practice and retry.** Confirm the webcam sees the full body and enough floor, then calibrate. After a count-in, the learner performs and the app records pose samples. It evaluates, in this order: visibility and tracking confidence, timing, foot placement and travel direction, formation position, facing and weight transfer, and whole-body posture and final shape.
5. **One correction.** Show the single highest-priority issue the learner can act on right away. The learner can replay the relevant counts and retry without redoing role selection or calibration.

### Feedback rules

- Keep timing, formation, and posture results visible separately. A combined score is optional and can never be the only explanation.
- Pick the one correction by physical dependency:
  1. body or feet not visible;
  2. wrong timing;
  3. wrong foot or movement direction;
  4. wrong travel path or formation landing;
  5. wrong facing or weight transfer;
  6. posture or finishing detail.
- Build corrections from measured errors and describe observable differences, for example "Start traveling on count three," "Plant the left foot on count six," "Settle by count eight instead of passing through," or "The formation is correct; finish the left arm higher."
- Keep directional language consistent. The UI must state whether left and right refer to the camera, the learner, the stage, or the selected dancer.
- When the feet are unreliable, return an inconclusive result such as "Position unclear." Never fabricate a score.

## 5. Build plan

Work in two milestones. **Milestone A** is the concrete technical build, with exact numbers. **Milestone B** extends it toward the full first vertical slice. Every stage reuses the same data and evaluation path. Do not add demo-only code paths.

### Milestone A: Formation and Move Drill

The app has two modes that share one fixed webcam and one pose detector.

- **Formation** maps the selected dancer's start and finish from a prerecorded eight-count clip onto the learner's floor and scores the landing on count eight.
- **Move Drill** checks one right-arm raise when the learner steps closer to the camera.

Physical setup: a fixed webcam stand, tape for floor corners, and a tape measure.

- [ ] **A1. Camera** (`usePoseCamera.ts`, `CameraView.tsx`)
  - Start with a raw `getUserMedia` preview.
  - Initialize one Pose Landmarker in `VIDEO` mode with `numPoses: 1`. Load the WASM and model from the local paths in section 2.
  - Sample new frames only, at about 12 Hz.
  - Release the frame loop, detector, and stream on unmount.
  - Design the input so a prerecorded video element can replace the webcam later without changing the sample format (see B4).
  - **Check:** both heels track at the farthest target, and both shoulders and the right wrist track at the close-up spot.

- [ ] **A2. Reference** (`roles.ts`, `ReferencePlayer.tsx`)
  - Use the bundled clips `public/reference.mp4` (group) and `public/arm-raise.mp4` (close-up).
  - The group clip shows two dancers facing a fixed camera at 90 BPM, with all four measured reference corners visible. On counts 5 to 7 they travel to opposite sides. On count 8 each plants both feet and holds the right arm at shoulder height for one second. The arm raise is filmed separately at close range.
  - Store the reference calibration and two role records in `roles.ts` (format in section 3).
  - **Check:** both clips play, and each role has distinct finish coordinates.

- [ ] **A3. Calibration** (`calibration.ts`, `CalibrationView.tsx`)
  - Use the stored reference calibration for the reference view.
  - For practice, ask for width and depth in meters, then four corner clicks on the live view.
  - Compute one image-to-floor homography per view, mapping the ordered corners to `(0,0), (W,0), (W,D), (0,D)`.
  - Reject nonpositive dimensions, invalid corner order, and degenerate solves.
  - Keep practice calibration in app state and provide a recalibrate action for when the camera or framing changes.
  - **Check:** project a measured interior mark in each view. Error must be ≤ 0.15 m before live scoring is tested.

- [ ] **A4. Scaled targets** (`formation.ts`, `FloorMap.tsx`)
  - For each reference checkpoint, project both heels to floor meters and average them.
  - With reference dimensions `Wr × Dr` and practice dimensions `Wp × Dp`, compute `s = min(1, Wp/Wr, Dp/Dr)`.
  - Map every reference floor point to `(s*x + (Wp - s*Wr)/2, s*y + (Dp - s*Dr)/2)`. This scales and centers the formation without changing the relationships between roles.
  - Draw the practice boundary and an arrow from the selected role's start to its finish.
  - **Check:** a 4 × 3 m reference fitted into a 3 × 3 m practice area uses scale 0.75 and depth offset 0.375 m, and a 2 m move becomes 1.5 m.

- [ ] **A5. Landing** (`formation.ts`, `useRehearsal.ts`)
  - First verify scoring with an untimed hold.
  - For each live sample, project heels 29 and 30 separately with the practice homography, then average them.
  - A landing passes when it is stable and within `min(0.25 m, 0.4 × distance between the two scaled finishes)` of the target, using Euclidean distance.
  - On a miss, compute target minus landing and cue its largest absolute axis, using x to break ties. Camera-right means "Step left," camera-left means "Step right," toward the camera means "Step forward," and away means "Step back." These cues are learner-relative, so label them that way in the UI.
  - Then add a four-beat count-in at 90 BPM, with `beatMs = 60000 / 90`. Count 1 starts four intervals after Start, and count 8 starts seven intervals after count 1.
  - Collect valid heel samples from 150 to 700 ms after count 8 starts. Finalize once that window closes. Take the component-wise median, and require at least three samples within 0.15 m of it. Otherwise show "Position unclear."
  - Lock the role during an attempt, and clear samples on retry.
  - **Check:** a held landing passes for its own role and fails for the other, and a missing pose gives "Position unclear."

- [ ] **A6. Close-up drill** (`MoveDrill.tsx`, `App.tsx`)
  - Show the close-up reference beside the shared live feed, and ask the learner to face the camera at the drill spot.
  - Use right wrist 16, right shoulder 12, and left shoulder 11, converted to video pixels.
  - The arm passes when wrist y ≤ right shoulder y + 0.15 × shoulder span in pixels.
  - Require three consecutive samples with the same result before showing "Arm up" or "Raise your right arm."
  - If a required joint is unclear or the shoulder span is zero, clear the feedback and reset the streak immediately.
  - Keep the camera and practice calibration mounted while switching modes.
  - **Check:** raising the wrist clears the cue, and you can then return to Formation and score a landing without recalibrating.

- [ ] **A7. Integration** (`App.tsx`, `types.ts`)
  - Formation shows the group clip, role picker, live view, floor map, beat count, and result.
  - Enable a timed attempt only after the camera has started and calibration is valid.
  - Cancel the active attempt when leaving Formation.
  - **Check:** `npm run build` passes, and both modes work from a fresh tab.

### Milestone B: First vertical slice

The first complete slice supports one reference rehearsal, at least two eight-count phrases, two selectable roles, prerecorded attempts, and a live webcam. It is complete only when this path works end to end:

1. Open the rehearsal and select a phrase.
2. Select a role and see the correct dancer highlighted.
3. Review the loop, counts, teaching note, and formation path.
4. Choose a prerecorded learner attempt or the live webcam.
5. Calibrate the practice floor, or load the saved calibration that belongs to the prerecorded attempt.
6. Run the attempt through the shared pose pipeline.
7. Evaluate timing, formation landing, and final body shape separately.
8. Display one measured correction.
9. Replay the relevant counts and retry.
10. Save the phrase result as passed or weak.
11. Re-evaluate the same captured landing against the second role and get a different formation judgment.

A polished end-to-end slice is the priority. Features that do not serve this path wait.

- [ ] **B1. Validate the data contract.** Represent a rehearsal as phrases, each phrase as a count range, and each phrase as a set of role-specific targets. Represent prerecorded attempts separately, each linked to a phrase, a practice calibration, and an expected outcome. On startup, check that phrases fit within the reference video, count timestamps are ordered and inside their phrase, every role has a highlight, path, and landing target, every judged key pose has its required landmarks, every attempt refers to an existing phrase and role, and coordinates use the declared orientation and units. **Check:** incomplete metadata gives a precise error before the learning UI opens.
- [ ] **B2. Phrase and role navigation.** Phrase cards, role controls, playback, looping, speed control, and a count indicator, all kept in sync across the reference player, formation map, and teaching text. Dancer highlights may be hand-authored paths or keyframed regions; automatic multi-person tracking is not required. **Check:** switching phrases or roles updates every dependent view with no stale targets, and a selected count range loops without leaving its bounds.
- [ ] **B3. Reference teaching views.** Show the selected role's start, travel path, and finish on the floor diagram, plus verified footsteps, facing, and key poses for the active counts. Sync an alternate angle to the same counts when one exists. The front recording is authoritative for coordinates, and other angles are teaching aids only. **Check:** someone unfamiliar with the routine can tell who to follow, which way to travel, and where to finish without scrubbing the whole video.
- [ ] **B4. One shared pose pipeline.** Accept frames from either a prerecorded attempt or the webcam, and run the same detector to produce the same `PoseSample` stream and visibility status. Keep coordinates unmirrored, sample only new frames, keep confidence values, and report missing poses explicitly. A result that only works through a special prerecorded path does not prove live feedback works. **Check:** the evaluator switches between a learner video and the webcam without changing its input format or scoring code.
- [ ] **B5. Calibration and formation across phrases.** Generalize A3 to A5 to every phrase. Use the midpoint between the heels as the landing. If the feet are unreliable, use a documented fallback or return an inconclusive result. A passing landing must settle near the target rather than pass through it. **Check:** the correct prerecorded landing passes its role and fails the other, and an occluded-foot attempt returns "unable to judge."
- [ ] **B6. Timing and whole-body evaluation.** Align each attempt with the reference counts. Start with a small verified set of events: when travel begins, one important foot plant or direction change, arrival and stability on count 8, and the final whole-body shape. Compare body shape in body-relative coordinates, and keep posture and formation results separate. **Check:** the late attempt fails timing but can pass posture, the wrong-position attempt passes posture but fails formation, and the wrong-shape attempt passes formation but fails posture.
- [ ] **B7. Prioritized feedback and retry.** Choose one correction using the dependency order in section 4. Store results by phrase and role, mark failed phrases as weak, and link straight back to the relevant counts. **Check:** every prepared attempt gets its expected primary correction, and retrying never repeats setup.
- [ ] **B8. Judging reveal and demo rehearsal.** Keep one completed attempt and allow its landing to be scored against another role without rerunning pose detection. Show that the captured body and floor position stay the same while the target changes. Tune thresholds in the final room with the final laptop, webcam, and presenters, against every prepared attempt rather than one good run. **Check:** the full demo works from a fresh browser session with no developer controls or manual data edits.

### Final demo story

1. A teammate has missed rehearsal.
2. They choose the phrase they missed and select their role.
3. The app highlights the correct dancer and explains the role's steps and travel.
4. They watch a short loop and perform the phrase.
5. The first attempt gets one visible, physically correct correction.
6. They review only the relevant counts and retry.
7. The second attempt improves or passes.
8. The captured landing is evaluated against another role and gives a different result.

The demo succeeds when the audience can see the cause of each judgment without relying on an opaque score.

## 6. Open conflicts between the source plans

These come from differences between `PLAN.md` and `PROTOTYPE_PLAN.md`. Do not pick an answer yourself. Follow milestone A as written and ask the team before building anything that depends on these.

1. **Posture check.** Milestone A judges one right-arm raise in video pixels in a separate close-up mode. Milestone B judges the final whole-body shape in body-relative coordinates within the same attempt. It is undecided whether Move Drill stays, merges into the posture evaluator, or is replaced.
2. **Scope of the reference.** Milestone A uses one group clip (`reference.mp4`) with two roles and one phrase. Milestone B needs at least two phrases plus phrase metadata, isolated per-role clips, and an optional second angle. File names and the metadata format for multiple phrases are not defined yet.
3. **Direction wording.** A5 gives learner-relative cues ("Step left" for a camera-right error). The prototype examples use camera-relative wording ("Land farther to camera-right"). Pick one convention and label it in the UI.
4. **Coach text and backend.** Whether OpenRouter rephrasing is used at all, and whether it goes through a Vite proxy or a separate backend, is undecided.

## 7. Recording protocol

The team must create this footage and metadata before final threshold tuning. Agents should not invent it. Use placeholders and report what is missing.

1. **Choreography.** Two or three eight-count phrases for two or three dancers, learnable after one short review. Include clear weight changes and foot plants, at least one lateral or diagonal travel, distinct role paths, two different count-8 destinations, one recognizable final shape, one formation change, and at most one crossing where every dancer stays visible. Design one landing to be correct for Role A and clearly wrong for Role B.
2. **Room and cameras.** A well-lit room with a visible, uncluttered floor. Tape the usable area's corners and center, and measure its width and depth. Put the front camera on a fixed, level support, centered on the formation, in landscape, far enough back to show every full body and all floor marks. Fix the resolution and frame rate, and do not move, zoom, or reframe after calibration footage. An optional second camera at a diagonal or side angle stays fixed, with a sync clap visible and audible in both recordings.
3. **Roles.** Give each dancer a stable role name and color, distinct solid-colored tops, and no loose clothing hiding hips, knees, or ankles. Record role order and clothing colors.
4. **Calibration footage.** Film the empty floor and tape marks for several seconds, then one dancer standing still on each corner and at center long enough to see both feet. Record dimensions, camera position, resolution, frame rate, and orientation.
5. **Reference choreography.** Per take: start cameras, sync clap if two cameras, announce the take, give an audible eight-count lead-in at tempo, perform all phrases without stopping, hold each phrase's final pose for at least one second, and hold the final formation for several seconds. Record at least three takes and choose the one with the clearest timing and visibility.
6. **Teaching material.** Each role performing each phrase alone from the front at the same tempo and marks, plus a slow demonstration if normal speed hides footwork, plus a short side or diagonal clip for anything unclear from the front. These are teaching aids, not scoring references.
7. **Annotation.** For each phrase, mark start and end times, counts 1 to 8, each dancer's identity, start and end foot positions, the path between them, the active foot and travel direction at important counts, facing at judged counts, the final reference pose per role, and one teaching instruction per chunk. A second teammate verifies annotations before they become scoring targets.
8. **Learner attempts.** Same webcam placement and floor marks as development. Separate files for: a correct attempt per role; correct final pose at the wrong position; correct position with a wrong arm or torso shape; a correct movement one count late; a wrong-foot or wrong-direction attempt; one that passes through the target without settling; one with a foot or both feet out of frame; and the shared landing that passes Role A and fails Role B. Start each from the same ready position with the same count-in, and hold the final position for at least one second unless instability is the point. For each file, write down the phrase, intended role, expected pass and fail categories, and expected primary correction. These are the acceptance cases.
9. **Package check.** Before implementation depends on the recordings, confirm that every video opens in the browser with stable timestamps, the front reference shows all dancers and floor marks throughout, count timestamps agree across reference and attempts, every role has a distinct path and target, the same-landing case is unambiguous, expected outcomes are written before thresholds are tuned, and no file depends on an unrecorded camera position or missing measurement. Tune thresholds only after this check.
