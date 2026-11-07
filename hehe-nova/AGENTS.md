# Dance Catch-up · Agent guide

This file is the single source of truth for agents working in this repository. It contains the product scope, input contract, architecture, algorithms, build order, and completion checks needed to implement the prototype. Do not require `Plans/PLAN.md` or `Plans/PROTOTYPE_PLAN.md` to understand the task. If either plan disagrees with this file, follow this file.

## 1. Outcome

Build a convincing role-aware dance rehearsal coach.

A dancer who missed rehearsal should be able to:

1. choose the phrase or eight-count they need to review;
2. select the dancer whose role they need to learn;
3. see that dancer highlighted in the reference choreography;
4. understand the role's steps, timing, path, and final formation position;
5. practice the phrase in front of one webcam;
6. receive one specific correction based on measured movement;
7. review only the relevant counts and retry.

Most dance-learning tools compare one learner with one performer. This product also understands that each dancer follows a role-specific path and owns a different position in the formation.

The defining demo uses one captured attempt twice. The attempt passes formation for Role A and fails formation for Role B because the target changes while the captured movement does not.

The prototype supports one prepared rehearsal with manually verified metadata. It does not parse arbitrary videos automatically.

## 2. Scope decisions

These decisions are resolved. Do not reintroduce alternatives without an explicit request.

- Build one integrated phrase-learning flow. Do not build a separate arm-raise or Move Drill mode.
- Track the whole body, but keep timing, formation, and posture as separate evaluation dimensions.
- Formation position is judged in calibrated floor coordinates. Body posture is judged in body-relative coordinates.
- The reference choreography contains at least two selectable roles and two selectable eight-count phrases.
- Dancer highlights, counts, formation targets, and teaching notes are supplied as manually verified metadata.
- Prerecorded learner attempts and the live webcam use the same pose-analysis and scoring pipeline.
- Feedback uses learner-relative directions and labels them as such. For a learner facing the camera, movement toward camera-right is the learner's left.
- Deterministic geometry decides pass, fail, and correction category.
- OpenRouter is optional and deferred. It may rephrase an established correction through a server-side endpoint, but it never judges an attempt. The app must work without it.

### Out of scope

Do not build:

- public dance-database integration;
- automatic parsing of arbitrary rehearsal videos;
- automatic multi-person identity tracking for the reference clip;
- unverified choreography descriptions generated from video;
- model training or a training-data pipeline;
- centimeter-level reconstruction;
- perfect classification of every intermediate step;
- generated camera viewpoints presented as ground truth;
- support for large ensembles or severe occlusion;
- a separate posture-demo mode unrelated to the selected phrase.

## 3. Repository and working rules

- The application root is this directory, `hehe-nova/`.
- The stack is React, TypeScript, and Vite. Do not scaffold another application.
- Use the pinned `@mediapipe/tasks-vision` dependency and Pose Landmarker Lite.
- Target Chrome on localhost for the prototype.
- Use Node 22.12 or newer and install dependencies with `npm ci`.
- Keep the lockfile committed.
- Load the pose model from `/models/pose_landmarker_lite.task`.
- Load MediaPipe WASM from `/mediapipe/wasm`.
- Do not re-download model assets unless they are missing or the pinned MediaPipe version changes.
- Scripts must work on Windows, macOS, and Linux. Use Node for file operations in npm scripts rather than shell-only `rm` or `cp` commands.
- Use camelCase for variables and functions and PascalCase for components and component files.
- Put global tokens and resets in `src/index.css`. A component may import its own CSS file.
- Comments should explain responsibilities, coordinate conventions, invariants, or non-obvious failure cases. Do not narrate syntax.
- Run `npm run lint`, `npm run typecheck`, and `npm run build` before calling implementation work complete.

### Secrets

- A real OpenRouter key may exist only in `.env.local` as `OPENROUTER_API_KEY`.
- Never commit the key, place it in source, or expose it through a `VITE_` variable.
- Client code must not call OpenRouter directly.
- Do not block the vertical slice on an OpenRouter backend. Use deterministic correction templates first.

## 4. Input asset contract

The team will provide the videos and metadata below. Agents implement against this abstraction and must not include instructions for filming them.

### Reference assets

The reference package contains:

- one fixed front-view group choreography video;
- two or three dancers with stable role identities;
- at least two eight-count phrases;
- full bodies and the relevant floor visible;
- a count-in or known count timestamps;
- distinct role paths and count-eight destinations;
- a held final pose for each judged phrase;
- optionally, a synchronized side or diagonal video;
- optionally, isolated role demonstrations or slow teaching clips.

The front view is authoritative for video coordinates, floor calibration, role highlighting, and scoring targets. Other views are teaching aids only.

### Prerecorded learner attempts

The learner-attempt package contains videos recorded from the same kind of fixed, full-body view used by the live webcam. It includes:

- a correct attempt for each role;
- correct posture at the wrong formation position;
- correct formation position with an incorrect final body shape;
- a late landing;
- a wrong-foot or wrong-direction attempt;
- an attempt with unreliable or occluded feet;
- one attempt whose landing passes Role A and fails Role B.

Each attempt includes its phrase ID, intended role ID, practice calibration, expected dimension results, and expected primary correction. These attempts are deterministic acceptance fixtures, not a separate product mode.

### Choreography metadata

The manually verified metadata provides:

- video asset paths and durations;
- phrase IDs, labels, start times, and end times;
- timestamps for counts 1 through 8;
- role IDs, labels, and display colors;
- highlight keyframes or regions for each role;
- reference-floor calibration and dimensions;
- role-specific start positions, paths, and finish targets;
- important foot plants and travel directions;
- facing direction at judged counts;
- body-pose targets at judged counts;
- teaching chunks and one concise instruction per chunk;
- optional alternate-angle and isolated-demonstration paths.

Do not invent choreography facts when assets or metadata are missing. Add typed placeholder data only when it is visibly labeled as placeholder, make missing requirements explicit in the UI, and keep real data replaceable through one manifest.

## 5. Coordinate systems

The application uses three coordinate systems with different meanings. Never substitute one for another.

| System | Representation | Purpose |
| --- | --- | --- |
| Video | Normalized `x` and `y` in `[0,1]`, unmirrored, right and down positive | Landmarks, highlights, calibration clicks |
| Body-relative | Pose centered at the hip midpoint and scaled by torso length | Posture comparison across body sizes and camera distances |
| Floor | Meters on a calibrated floor plane | Formation paths, targets, and landing position |

The webcam may be mirrored visually, but stored coordinates remain unmirrored.

### Floor orientation

The floor origin is the near-left corner as seen by the camera. Positive `x` points camera-right. Positive `y` points away from the camera.

Learner-facing correction text converts this orientation:

- positive floor-x correction → move learner-left;
- negative floor-x correction → move learner-right;
- negative floor-y correction → move learner-forward, toward the camera;
- positive floor-y correction → move learner-back, away from the camera.

The interface must label corrections as learner-relative.

### Calibration

A calibration contains four video points ordered as near-left, near-right, far-right, far-left, plus the measured floor width and depth. Compute a homography from those video points to `(0,0)`, `(width,0)`, `(width,depth)`, and `(0,depth)`.

Reject:

- nonpositive width or depth;
- points outside the visible video content;
- self-intersecting or incorrectly ordered corners;
- degenerate or numerically unstable homographies.

Clicks are relative to the rendered video content rectangle. Ignore clicks in letterbox or pillarbox regions.

## 6. Core data model

Use equivalent TypeScript types even if names evolve. Preserve the responsibilities and units.

```ts
type ImagePoint = { x: number; y: number };
type FloorPoint = { x: number; y: number };

type Calibration = {
  corners: [ImagePoint, ImagePoint, ImagePoint, ImagePoint];
  widthM: number;
  depthM: number;
};

type PoseLandmark = {
  x: number;
  y: number;
  z: number;
  visibility: number;
};

type PoseSample = {
  timeMs: number;
  landmarks: PoseLandmark[];
};

type CountMark = {
  count: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  timeSec: number;
};

type HighlightKeyframe = {
  timeSec: number;
  center: ImagePoint;
  width: number;
  height: number;
};

type PoseTarget = {
  timeSec: number;
  landmarks: PoseLandmark[];
};

type RoleTarget = {
  roleId: string;
  label: string;
  color: string;
  highlights: HighlightKeyframe[];
  startFloor: FloorPoint;
  pathFloor: FloorPoint[];
  finishFloor: FloorPoint;
  poseTargets: PoseTarget[];
};

type TeachingChunk = {
  startCount: number;
  endCount: number;
  instruction: string;
};

type Phrase = {
  id: string;
  label: string;
  startSec: number;
  endSec: number;
  counts: CountMark[];
  roles: RoleTarget[];
  teachingChunks: TeachingChunk[];
};

type RehearsalManifest = {
  frontVideo: string;
  alternateVideo?: string;
  referenceCalibration: Calibration;
  phrases: Phrase[];
};

type ExpectedDimension = "pass" | "fail" | "inconclusive";

type LearnerAttemptFixture = {
  id: string;
  video: string;
  phraseId: string;
  intendedRoleId: string;
  calibration: Calibration;
  expected: {
    visibility: ExpectedDimension;
    timing: ExpectedDimension;
    formation: ExpectedDimension;
    posture: ExpectedDimension;
    primaryCorrection: string;
  };
};
```

Validate the manifest before rendering the learning flow. Report all discovered errors together when practical.

Validation must establish that:

- phrase times are ordered and within the video duration;
- each phrase contains exactly one ordered mark for counts 1 through 8;
- every role has a unique ID, highlight data, path, finish target, and judged pose target;
- teaching chunks lie inside the phrase and use valid count ranges;
- coordinates and dimensions are finite and within their declared domains;
- every learner fixture references an existing phrase and role;
- fixture expectations are present.

## 7. Shared pose pipeline

Create one pose-input abstraction that accepts either a live webcam video element or a prerecorded learner video element. Both sources must produce the same `PoseSample` stream and use the same evaluators.

### Detector behavior

- Initialize one Pose Landmarker in `VIDEO` mode with `numPoses: 1`.
- Load the local model and WASM assets.
- Process only new video frames, targeting approximately 12 to 20 samples per second.
- Use the media timestamp for prerecorded video and a monotonic `performance.now()`-based attempt clock for live input.
- Preserve landmark visibility values.
- Emit an empty landmark array when no pose is detected.
- Release animation loops, detector resources, and media streams on unmount.

A required landmark is initially considered reliable at visibility `>= 0.6`. Keep the threshold configurable because the final room may require tuning.

Relevant MediaPipe landmark indices include:

| Index | Landmark |
| --- | --- |
| 11, 12 | Left and right shoulders |
| 13, 14 | Left and right elbows |
| 15, 16 | Left and right wrists |
| 23, 24 | Left and right hips |
| 25, 26 | Left and right knees |
| 27, 28 | Left and right ankles |
| 29, 30 | Left and right heels |

## 8. Evaluation

Return independent dimension results. Do not reduce the attempt to one unexplained score.

```ts
type DimensionResult = {
  status: "pass" | "fail" | "inconclusive";
  score?: number;
  measured?: Record<string, number>;
  reason: string;
};

type AttemptResult = {
  visibility: DimensionResult;
  timing: DimensionResult;
  footwork: DimensionResult;
  formation: DimensionResult;
  posture: DimensionResult;
  primaryCorrection: string;
};
```

### Visibility

Evaluate visibility first. Required joints depend on the dimension being scored. Missing wrists should not prevent a formation result, but unreliable feet should make formation inconclusive.

Return an inconclusive result instead of substituting a neutral or fabricated score.

### Formation

For each sample in the landing window:

1. require both heels, or explicitly fall back to both ankles;
2. project each foot landmark through the practice-floor homography;
3. average the projected feet to obtain the landing center;
4. reject projections outside a small tolerance around the calibrated floor;
5. aggregate valid landing centers using the component-wise median.

Start with a landing window from 150 ms to 700 ms after count eight begins. Require at least three valid samples close enough to the median to establish a stable landing. Begin with a stability radius of `0.15 m`; keep it configurable.

Scale the reference floor into the practice floor without enlarging it:

```text
scale = min(1, practiceWidth / referenceWidth, practiceDepth / referenceDepth)
xOffset = (practiceWidth - scale * referenceWidth) / 2
yOffset = (practiceDepth - scale * referenceDepth) / 2
mapped(x, y) = (scale*x + xOffset, scale*y + yOffset)
```

Start with this passing tolerance:

```text
min(0.25 m, 0.4 * distance between the two role finish targets)
```

Keep thresholds centralized and configurable. The same captured landing must be reusable against another role target without rerunning pose detection.

### Timing and footwork

Do not attempt full step classification initially. Evaluate only verified events stored in the phrase metadata:

- travel start;
- one important left- or right-foot plant or direction change;
- arrival on count eight;
- stability after arrival.

Compare event time with the corresponding count window. Preserve the measured time difference so feedback can say early or late. A wrong-foot result requires reliable left and right foot trajectories; otherwise return inconclusive.

### Posture

Posture is evaluated inside the phrase attempt, not in a separate drill.

Normalize reference and learner poses independently:

1. correct the x-axis for source aspect ratio;
2. center at the hip midpoint;
3. scale by torso length;
4. compare visible reference joints with corresponding visible learner joints.

Use joint angles and normalized landmark distances for shoulders, elbows, wrists, hips, knees, and ankles. Do not allow global translation or body size to affect posture. Return per-region measurements so correction generation can identify the most important visible body-shape difference.

### Correction priority

Generate one primary correction in this order:

1. body or required joints not visible;
2. wrong timing;
3. wrong foot or movement direction;
4. wrong travel or formation landing;
5. wrong facing or weight transfer, when supported by reliable measurements;
6. posture or finishing detail.

Corrections must describe the measured difference. Examples:

- `Move back so both feet stay visible.`
- `Start traveling on count three.`
- `Plant the left foot on count six.`
- `Land one step farther to your left.`
- `Settle by count eight instead of passing through.`
- `Your formation is correct; finish the left arm higher.`

The retry action preserves phrase, role, and valid calibration. It returns directly to the count range relevant to the correction.

## 9. User interface

The first complete interface contains:

### Phrase selection

- phrase cards with label, count range, preview frame, and small formation-change diagram;
- direct access to any phrase;
- shortcuts to the last attempt and weak phrases.

### Role selection and learning

- role controls using stable names and colors;
- reference player with the selected dancer highlighted;
- normal and slow playback;
- looping for a phrase or teaching chunk;
- visible current count;
- teaching instruction for the active chunk;
- formation map showing start, path, and finish;
- synchronized alternate view when supplied.

Changing the role updates highlight, path, landing target, pose targets, teaching notes, and scoring target together. Do not leave stale role-dependent state.

### Practice

- source selector for development fixtures or live webcam;
- full-body visibility state;
- calibration flow and recalibrate action;
- count-in and active count display;
- live skeleton overlay;
- separate timing, footwork, formation, and posture results;
- one primary correction;
- retry and review-relevant-counts actions.

### Judging reveal

- preserve a completed attempt's extracted samples and landing;
- show the fixed captured landing against Role A and Role B targets;
- display why one target passes and the other fails;
- do not rerun detection or alter the captured attempt between judgments.

## 10. Implementation order

Complete stages in dependency order. Do not build later-stage polish on placeholder parallel logic.

### Stage 1: Domain model and placeholder manifest

- Implement the shared types and manifest validation.
- Add one clearly labeled placeholder rehearsal containing two phrases and two roles.
- Keep all asset paths and choreography facts in the manifest rather than components.
- Render a blocking, readable data-error view when validation fails.

**Complete when:** valid placeholder data loads, invalid fixtures report precise errors, and replacing the manifest does not require component edits.

### Stage 2: Phrase and role learning flow

- Implement phrase cards, role selection, reference playback, looping, speed, and count synchronization.
- Implement keyframed dancer highlighting.
- Implement teaching chunks and the formation map.
- Keep all role-dependent views synchronized.

**Complete when:** changing phrase or role updates every dependent view, and loops stay within the selected bounds.

### Stage 3: Shared pose input

- Implement the local MediaPipe detector.
- Implement webcam and prerecorded-video adapters that feed the same sampler.
- Draw the skeleton and expose per-joint visibility.
- Handle teardown and source switching without duplicate loops or leaked streams.

**Complete when:** the same evaluator-facing stream works with a fixture and the webcam, and missing poses are explicit.

### Stage 4: Floor calibration and formation scoring

- Implement calibration validation and homography projection.
- Implement reference-to-practice floor scaling.
- Implement landing aggregation, stability, pass/fail/inconclusive results, and directional correction data.
- Implement the frozen-attempt two-role reveal.

**Complete when:** the intended-role fixture passes, the other role fails from the same extracted landing, and occluded feet are inconclusive.

### Stage 5: Timing, footwork, and posture

- Align attempts with phrase counts.
- Evaluate only the verified movement events in metadata.
- Implement body-relative posture comparison with per-region output.
- Keep all dimension results independent.

**Complete when:** prepared fixtures isolate the intended failure: late, wrong foot or direction, wrong formation, wrong final shape, or visibility.

### Stage 6: Feedback, retry, and progress

- Implement correction priority from measured results.
- Preserve phrase, role, and calibration on retry.
- Link review to the relevant teaching chunk.
- Store the latest result and weak status by phrase and role in local state or local storage.

**Complete when:** every fixture receives its expected primary correction and retry does not repeat setup.

### Stage 7: Demo hardening

- Replace placeholders with the supplied asset package.
- Tune centralized thresholds against every acceptance fixture before testing live.
- Test the live flow in the final room with the final webcam and laptop.
- Add failure messaging for denied camera permission, missing assets, invalid metadata, poor visibility, and inconclusive evaluation.
- Verify the full story from a fresh browser session.

**Complete when:** the demo works without developer controls or manual edits and the audience can see the cause of each judgment.

## 11. Acceptance matrix

At minimum, automated unit tests or deterministic fixture checks must cover:

| Case | Timing | Footwork | Formation | Posture | Primary result |
| --- | --- | --- | --- | --- | --- |
| Correct Role A | Pass | Pass | Pass | Pass | Positive confirmation |
| Correct Role B | Pass | Pass | Pass | Pass | Positive confirmation |
| Late landing | Fail | May pass | May pass | May pass | Timing correction |
| Wrong foot or direction | Pass or fail | Fail | May fail | May pass | Footwork correction |
| Correct pose, wrong place | Pass | Pass | Fail | Pass | Formation correction |
| Correct place, wrong shape | Pass | Pass | Pass | Fail | Posture correction |
| Feet occluded | Inconclusive where required | Inconclusive where required | Inconclusive | May pass | Visibility correction |
| Same attempt, other role | Unchanged | Unchanged | Different result | Unchanged | Role-aware formation correction |

Test pure geometry, calibration, normalization, landing aggregation, manifest validation, and correction priority independently of React components.

## 12. Final demo path

1. A teammate has missed rehearsal.
2. They select the missed phrase and their assigned role.
3. The app highlights the correct dancer and explains the role's steps and travel.
4. They loop the relevant counts and perform the phrase.
5. The app returns separate dimension results and one visible, physically correct correction.
6. They review only the relevant counts and retry.
7. The second attempt improves or passes.
8. The app freezes that attempt and evaluates the identical landing against another role.
9. The formation judgment changes while timing and posture remain unchanged.

The demo succeeds when the audience understands why each judgment occurred without relying on an opaque combined score or a presenter explanation.
