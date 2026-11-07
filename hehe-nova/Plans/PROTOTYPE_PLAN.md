# Dance Catch-up · Prototype plan

## Goal

Build a convincing role-aware dance rehearsal coach.

A dancer who missed rehearsal should be able to choose a phrase, select the dancer they need to learn, understand that role's steps and formation path, practice in front of one webcam, receive one specific correction, and retry only the relevant section.

The prototype will support one prepared rehearsal. It does not need to parse arbitrary dance videos or infer every choreographic detail automatically.

## Core sell

Most dance-learning tools compare one learner with one performer. Group choreography adds a separate responsibility: each dancer follows a role-specific path and owns a different place in the formation.

The prototype evaluates both how the learner moves and where the selected role must travel and land. Its defining reveal is that one captured landing can pass for one role and fail for another. The physical attempt remains unchanged; only the selected role's responsibility changes.

## Inputs the implementation will receive

The prototype uses footage recorded by the team. It does not depend on a public dance database.

### Reference choreography videos

The reference footage shows the choreography that the learner wants to learn. The initial package contains:

- one fixed front-view recording of two or three dancers performing two or three eight-count phrases;
- one synchronized diagonal or side recording when available;
- a visible or audible count-in;
- full bodies and enough floor to observe formation changes;
- a held final position at the end of each phrase.

The front recording is authoritative for role selection, phrase playback, and formation position. An additional angle is instructional evidence only; it must not silently replace the front-view coordinate system.

### Prerecorded learner-attempt videos

A separate set of videos shows one learner attempting the same phrases in the practice space. These files simulate live webcam input and make development repeatable.

The initial set contains:

- one correct attempt for each role;
- correct body shape at the wrong formation position;
- correct formation position with a visibly wrong final shape;
- a late landing;
- a wrong-foot or wrong-direction attempt;
- an attempt in which the feet leave the frame or become occluded;
- one landing that is correct for Role A and incorrect for Role B.

Prerecorded attempts and the live webcam must enter the same pose-analysis and scoring pipeline. A result that works only through a special prerecorded-video path does not establish that live feedback works.

### Verified choreography metadata

The following facts are supplied manually for the prototype:

- phrase names, start times, and end times;
- timestamps for counts 1 through 8;
- role names and display colors;
- the selected dancer's screen location through each phrase;
- formation positions at the beginning and end of each phrase;
- important foot plants and travel directions;
- facing direction at important counts;
- reference body poses at the counts that will be judged;
- one short teaching instruction per learning chunk.

The app treats this metadata as the source of truth. Automated extraction may be added later, but it is not part of the first vertical slice.

## User experience

### Choose what to review

The home view presents the rehearsal as selectable phrase cards rather than one long timeline. Each card includes a short preview, its count range, and a small formation-change diagram.

The learner can open any phrase, a smaller count range, the last attempted phrase, or a phrase marked weak by a previous attempt.

### Choose a role

The learner selects one dancer. The reference player identifies that dancer with a persistent color, outline, marker, or spotlight while de-emphasizing the others.

Changing the selected role updates all role-dependent information together:

- the highlighted dancer;
- the formation path;
- the target landing;
- the key poses and teaching notes;
- the scoring target.

### Learn the phrase

The learning view provides normal-speed and slow-motion playback, looping, a visible count indicator, a floor path, important footsteps and facing changes, the final body shape, and an alternate recorded angle when one is available.

The phrase is taught in short chunks, such as counts 1–2 or 1–4. Each chunk states which foot initiates the movement, where the dancer travels, when the movement occurs, and what body shape finishes the chunk.

### Practice and retry

The learner confirms that the webcam sees the full body and enough floor. A calibration step maps the visible practice area to a normalized floor.

After a count-in, the learner performs the selected phrase. The app records pose samples throughout the attempt and evaluates:

1. visibility and tracking confidence;
2. timing;
3. foot placement and travel direction;
4. formation position;
5. facing and weight transfer;
6. whole-body posture and final shape.

The result gives one correction: the highest-priority issue that can be acted on immediately. The learner can replay the relevant counts and retry without repeating role selection or calibration.

## Coordinate systems

Three coordinate systems have different jobs and must remain separate.

### Video coordinates

Video coordinates locate a dancer or landmark in an image. They support dancer highlighting and are preserved in an unmirrored orientation internally.

### Body-relative coordinates

Whole-body posture comparison centers and scales a pose relative to the body. This allows comparison across different body sizes and camera distances. It cannot judge formation because centering removes the dancer's location.

### Floor coordinates

Formation scoring projects visible foot positions onto a calibrated floor plane. Reference and practice floors use the same normalized orientation, then the reference formation is scaled to fit the learner's available space.

The evaluator must never substitute one coordinate system for another. In particular, a body-normalized pose cannot establish where the learner landed.

## First vertical slice

The first complete slice supports one reference rehearsal, at least two eight-count phrases, two selectable roles, prerecorded attempts, and a live webcam.

It is complete only when this path works:

1. Open the rehearsal and select a phrase.
2. Select a role and see the correct dancer highlighted.
3. Review the loop, counts, teaching note, and formation path.
4. Choose either a prerecorded learner attempt or the live webcam.
5. Calibrate the practice floor or load the saved calibration belonging to the prerecorded attempt.
6. Run the attempt through the shared pose-analysis pipeline.
7. Evaluate timing, formation landing, and final body shape separately.
8. Display one measured correction.
9. Replay the relevant counts and retry.
10. Save the phrase result as passed or weak.
11. Re-evaluate the same captured landing against the second role and obtain a different formation judgment.

A polished end-to-end slice is the priority. Features that do not contribute to this path should wait.

## Implementation sequence

Each stage below produces a usable result and has an explicit completion check. Later stages build on the same data and evaluation path rather than introduce parallel demo-only behavior.

### Stage 1: Define and validate the data contract

Represent rehearsals as phrases, phrases as count ranges, and each phrase as a set of role-specific targets. Represent prerecorded attempts separately, but associate each attempt with a phrase, practice-space calibration, and expected outcome.

On startup, validate that:

- every phrase lies within the reference video duration;
- count timestamps are ordered and lie within the phrase;
- every selectable role has a highlight, path, and landing target;
- every judged key pose contains the required landmarks;
- every prerecorded attempt refers to an existing phrase and role;
- coordinates use the declared orientation and units.

**Completion check:** incomplete metadata produces a precise error before the learning interface opens.

### Stage 2: Build phrase and role navigation

Show phrase cards, role controls, playback, looping, speed control, and the count indicator. Synchronize the selected phrase and role across the reference player, formation map, and teaching text.

For the prototype, dancer highlights may be manually authored paths or keyframed regions. Automatic multi-person identity tracking is not required.

**Completion check:** switching phrases or roles updates every dependent view without stale targets, and a selected count range loops without leaving its boundaries.

### Stage 3: Add reference teaching views

Render the selected role's starting position, travel path, and final position on a floor diagram. Show verified footsteps, facing, and key body poses for the active count range. Synchronize an alternate recording to the same counts when available.

**Completion check:** someone unfamiliar with the routine can identify who to follow, which direction to travel, and where to finish without scrubbing the full video.

### Stage 4: Build one shared pose-input pipeline

Accept frames from either a prerecorded attempt or the webcam. Run the same whole-body pose detector, produce the same timestamped landmark samples, and expose the same visibility status to the evaluator.

The pipeline must preserve unmirrored coordinates internally, sample only new frames, retain confidence values, and report missing poses explicitly.

**Completion check:** the same evaluator can switch between a learner video and webcam input without changing its input format or scoring code.

### Stage 5: Add calibration and formation evaluation

Map the visible practice floor into floor coordinates. Project the learner's heels or ankles onto that floor and use the midpoint between the feet as the landing position. If the feet are unreliable, use an explicitly documented fallback or return an inconclusive result.

Scale and center the reference formation to fit the practice area without changing relationships between roles. Judge the landing over a short window around count eight. A passing landing must be near the role target and stable rather than merely passing through it.

**Completion check:** the correct prerecorded landing passes its intended role, fails the other role, and an occluded-foot attempt returns "unable to judge" rather than a fabricated score.

### Stage 6: Add timing and whole-body evaluation

Align each attempt with the reference counts. Initially evaluate only a small verified set of events:

- when travel begins;
- one important foot plant or direction change;
- arrival and stability on count eight;
- the final whole-body shape.

Compare body shape in body-relative coordinates so camera distance and body size do not affect posture scoring. Keep formation and posture results separate.

**Completion check:** the late attempt fails timing but can pass posture; the wrong-position attempt passes posture but fails formation; the wrong-shape attempt passes formation but fails posture.

### Stage 7: Prioritize feedback and support retry

Select one correction according to physical dependency:

1. body or feet not visible;
2. wrong timing;
3. wrong foot or movement direction;
4. wrong travel path or formation landing;
5. wrong facing or weight transfer;
6. posture or finishing detail.

Generate the correction from measured errors. A language model may rephrase an established correction, but it must not decide whether the attempt passed.

Store the result by phrase and role. Mark failed phrases as weak and link directly back to the relevant counts.

**Completion check:** every prepared learner attempt receives the expected primary correction, and retrying does not require repeated setup.

### Stage 8: Add the judging reveal and rehearse the demo

Preserve one completed attempt and allow its landing to be scored against another role without rerunning pose detection. Show that the captured body and floor position remain unchanged while the role target changes.

Tune thresholds using the final room, laptop, webcam, and presenters. Verify all prepared correct and incorrect attempts rather than tuning against one successful run.

**Completion check:** the complete demo works from a fresh browser session without developer controls or manual data edits.

## Feedback rules

Timing, formation, and posture remain separately visible. A combined score is optional and cannot be the only explanation.

Corrections describe observable differences, for example:

- "Start traveling on count three."
- "Plant the left foot on count six."
- "Land farther to camera-right."
- "Settle by count eight instead of passing through."
- "The formation is correct; finish the left arm higher."

Directional language must remain consistent. The interface must state whether left and right refer to the camera, learner, stage, or selected dancer.

## Final demo story

1. A teammate has missed rehearsal.
2. They choose the phrase they missed and select their role.
3. The product highlights the correct dancer and explains the role's steps and travel.
4. The teammate watches a short loop and performs the phrase.
5. The first attempt receives one visible, physically correct correction.
6. The teammate reviews only the relevant counts and retries.
7. The second attempt improves or passes.
8. The captured landing is evaluated against another role and produces a different result.

The demo succeeds when the audience can see the cause of each judgment without relying on an opaque score.

## Scope boundaries

The prototype does not require:

- public dance databases;
- automatic parsing of arbitrary rehearsal videos;
- automatic choreography descriptions without human verification;
- centimeter-level floor reconstruction;
- perfect recognition of every intermediate step;
- generated viewpoints presented as unseen ground truth;
- support for large ensembles or frequent occlusion;
- model training or a large training dataset.

## Recording protocol

This section specifies the footage and metadata the team must create before final threshold tuning.

### 1. Prepare the choreography

Create two or three eight-count phrases for two or three dancers. Keep the movement learnable after one short review. Include:

- clear weight changes and foot plants;
- at least one lateral or diagonal travel sequence;
- distinct role paths;
- two different count-eight destinations;
- one recognizable final body shape;
- one formation change;
- at most one crossing, and only if every dancer remains visible.

Design one landing so it is deliberately correct for Role A and clearly incorrect for Role B.

### 2. Prepare the room and cameras

Choose a well-lit room with a visible, uncluttered floor. Mark the corners of the usable dance area and its center with tape. Measure and record its width and depth.

Place the front camera on a fixed support, level and centered on the formation, far enough away to show every full body and all floor marks, and in landscape orientation. Fix the resolution and frame rate. Do not move, zoom, or reframe this camera after calibration footage is recorded.

If available, place a second camera at a diagonal or side angle. Keep it fixed and ensure a synchronization clap is visible and audible in both recordings.

### 3. Assign visually distinct roles

Give each dancer a stable role name and color. Wear distinct solid-colored tops or otherwise distinguishable outfits. Avoid loose clothing that hides hips, knees, or ankles and avoid colors that blend into the background.

Record the role order and clothing colors in the metadata notes.

### 4. Record calibration footage

Before dancing, record the empty floor and all tape marks for several seconds. Then have one dancer stand still on each marked floor corner and at center. Hold each position long enough to identify both feet clearly.

Record the measured dimensions, camera position, resolution, frame rate, and orientation. This footage establishes the reference floor mapping.

### 5. Record the reference choreography

For every take:

1. Start both cameras.
2. Perform one synchronization clap if two cameras are used.
3. Announce the take number.
4. Give an audible eight-count lead-in at the routine's actual tempo.
5. Perform all phrases without stopping.
6. Plant the feet and hold each phrase's final pose for at least one second.
7. Hold the final formation for several seconds after the routine.

Record at least three complete takes. Select the take with the clearest timing and visibility, not merely the most expressive performance.

### 6. Record isolated teaching material

Record each role performing each phrase individually from the front. Use the same tempo and floor marks. Also record one slow demonstration if normal speed hides important footwork.

If a movement is difficult to understand from the front, record a short synchronized side or diagonal explanation. These clips are teaching aids, not separate scoring references.

### 7. Annotate the chosen reference take

For each phrase:

1. Mark the start and end timestamps.
2. Mark counts 1 through 8.
3. Identify each dancer through the phrase.
4. Mark starting and ending foot positions.
5. Mark the expected path between those positions.
6. Record the active foot and travel direction at important counts.
7. Record facing direction at the judged counts.
8. Save the final reference pose for each role.
9. Write one concise teaching instruction for each learning chunk.

Review the annotations while playing the video slowly. A second teammate should verify them before they become scoring targets.

### 8. Record prerecorded learner attempts

Use the same webcam placement and practice-floor marks intended for development. Record separate files for:

1. a correct attempt for each role;
2. a correct final pose at the wrong formation position;
3. the correct formation landing with a deliberately wrong arm or torso shape;
4. a correct movement performed one count late;
5. a wrong-foot or wrong-direction attempt;
6. an attempt that passes through the target but does not settle;
7. an attempt with one or both feet outside the frame;
8. the shared landing that should pass Role A and fail Role B.

Begin every attempt from the same ready position and include the same audible count-in. Hold the final position for at least one second unless the test intentionally represents an unstable landing.

For each file, record the phrase, intended role, expected pass and fail categories, and expected primary correction. These expectations become the prototype's acceptance cases.

### 9. Verify the complete data package

Before implementation depends on the recordings, confirm that:

- every video opens in the browser and has stable timestamps;
- the front reference shows all dancers and floor marks throughout;
- count timestamps agree across reference and learner attempts;
- every role has a distinct path and target;
- the same-landing case is visibly unambiguous;
- expected outcomes are written before scoring thresholds are tuned;
- no file depends on an unrecorded camera position or missing measurement.

Only after this check should thresholds be tuned to the final room and recordings.
