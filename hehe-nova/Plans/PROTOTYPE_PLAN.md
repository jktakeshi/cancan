# Dance Catch-up · Prototype plan

## Goal

Build a convincing role-aware dance rehearsal coach.

A dancer who missed rehearsal should be able to choose a section of the choreography, select the dancer they need to learn, understand that role's movement and formation path, practice in front of one webcam, and receive a specific correction before retrying.

The prototype does not need to parse arbitrary rehearsal videos perfectly. It needs to make one prepared rehearsal work clearly from beginning to end.

## Core sell

Most dance-learning tools compare one learner with one performer. Group choreography has an additional requirement: each role travels through a different path and owns a different place in the formation.

The prototype should demonstrate that the system evaluates both:

- how the learner moves, including timing, steps, facing, and body shape;
- where the selected role must travel and land within the group.

The defining reveal is that one captured landing can pass for one role and fail for another. The physical attempt remains unchanged; only the selected role's responsibility changes.

## Prototype experience

### Choose what to review

The rehearsal is divided into named, selectable phrases or eight-counts. Each section has a short visual preview and indicates its formation change. The learner can jump directly to a phrase rather than scrub through one long video.

The interface should also make it easy to return to:

- the last attempted phrase;
- a specific count range;
- the weakest phrase identified during practice.

### Choose a role

The learner selects one dancer from the group. That dancer remains visually highlighted while the others are dimmed or de-emphasized.

For the selected role, the lesson shows:

- the original rehearsal video;
- a loop and slow-motion view;
- the role's path on a simple formation map;
- key footsteps, facing changes, and final body shapes;
- an alternate recorded angle when it materially clarifies the movement.

### Learn in small chunks

The selected phrase is taught in short count ranges, such as counts 1–2 or 1–4. Each chunk should communicate only the information needed to perform it:

- which foot initiates the movement;
- where the dancer travels;
- when the movement happens;
- which direction the body faces;
- the important posture or final shape.

### Practice with one webcam

The webcam sees the learner's full body and enough floor to observe travel. A brief calibration maps the visible practice area into a simple floor coordinate system.

During an attempt, whole-body tracking is used to measure separate aspects of performance:

1. timing;
2. foot placement and travel;
3. formation position;
4. facing and weight transfer;
5. whole-body posture and final shape.

The prototype should not hide these behind one unexplained score.

### Correct and retry

After an attempt, the system gives one correction: the highest-priority issue that the learner can act on immediately. For example:

- "Start the turn on count four."
- "Cross the left foot behind."
- "Travel one step farther right."
- "The formation is correct; finish the left arm higher."

The learner can replay the relevant counts and retry without repeating the entire setup.

## Vertical slice

The first complete slice should support one prepared rehearsal containing two or three selectable roles and at least two eight-count phrases.

It is complete when the following path works:

1. Open the rehearsal and choose an eight-count.
2. Select a role and see that dancer highlighted.
3. Review the role's loop, formation path, and key instruction.
4. Calibrate the practice space and confirm full-body visibility.
5. Perform the phrase after a count-in.
6. Capture the learner's movement and count-eight landing.
7. Report formation and whole-body results separately.
8. Give one correction and allow an immediate retry.
9. Save the result so the phrase can be revisited as a weak section.
10. Re-evaluate the same captured landing against another role for the role-aware reveal.

This slice matters more than broad feature coverage. A polished end-to-end loop is more convincing than several disconnected tracking demonstrations.

## Demo data required

Record one short choreography specifically for the prototype.

### Reference recording

- Two or three dancers.
- Two or three eight-counts.
- A fixed front camera showing every full body and the relevant floor area.
- Distinct clothing colors or silhouettes so dancer identity is easy to maintain.
- An audible count-in or known tempo.
- Clear foot plants on important counts.
- At least one formation change.
- At least two roles with visibly different count-eight destinations.
- One crossing or role exchange if tracking remains stable.
- A held final pose long enough to establish a clean reference.

Record a synchronized diagonal or side view if possible. The learner still uses one webcam; the extra reference camera only provides a truthful instructional view.

### Manually verified reference data

For each phrase and role, prepare:

- phrase start and end times;
- musical count timestamps;
- dancer identity through the clip;
- approximate dancer highlight or track;
- starting and ending formation positions;
- important foot plants and travel direction;
- facing at key counts;
- one or more reference body shapes;
- a short teaching instruction.

Automation may propose these values later, but the demo reference must be manually checked. A plausible but incorrect instruction would undermine the product more than visible manual preparation.

### Practice and judging examples

Record or rehearse several attempts for testing:

- a correct attempt for each role;
- correct posture at the wrong formation position;
- correct formation position with a visibly wrong final shape;
- correct path with a late landing;
- an attempt with missing or occluded feet;
- one landing deliberately correct for Role A and incorrect for Role B.

Public data such as the AIST group-dance collection can be used while developing playback, pose extraction, and dancer tracking. The purpose-built recording should be the final demonstration because its counts, roles, paths, and expected outcomes can be verified.

## Feedback priority

Corrections should follow physical dependency rather than whichever metric has the lowest numerical score:

1. The body or feet are not visible reliably.
2. The movement occurs on the wrong count.
3. The wrong foot or step pattern is used.
4. The travel path or formation landing is wrong.
5. Facing or weight transfer is wrong.
6. Posture, arms, or finishing detail is wrong.

This prevents feedback about an arm angle when the learner has not yet reached the correct place.

Measured geometry should decide whether an attempt passes. A language model may phrase a known correction, but it should not invent the judgment.

## Demo story

The final presentation should show one uninterrupted learner journey:

1. A teammate has "missed rehearsal."
2. They choose the phrase they missed and select their role.
3. The product highlights the correct dancer and explains the role's travel.
4. The teammate watches a short loop and performs the phrase.
5. The first attempt receives one clear correction.
6. The teammate reviews only the relevant counts and retries.
7. The second attempt improves or passes.
8. The captured landing is judged against a second role and produces a different result.

The last step proves the central claim more clearly than a generic pose score.

## Success criteria

The prototype succeeds if an audience can see, without additional explanation, that:

- the learner chose a specific section and role;
- the product knew which dancer to teach;
- the learner received information about both movement and formation;
- feedback described a visible, correctable physical difference;
- retrying the relevant section was fast;
- the same landing produced different judgments for different roles;
- all evaluation used one learner-facing webcam.

Technical accuracy should be evaluated separately for timing, landing position, and body shape. One combined score is optional and should not be the only evidence.

## Scope boundaries

The prototype does not need:

- reliable automatic parsing of arbitrary rehearsal videos;
- automatic choreography descriptions without human verification;
- centimeter-level floor reconstruction;
- perfect recognition of every intermediate step;
- generated viewpoints that claim to show unseen ground truth;
- support for large ensembles or frequent occlusion;
- a generalized training pipeline or a large model-training dataset.

Those are later extensions. The immediate objective is a clear, reliable role-aware learning loop built around one verified rehearsal.

## Build order

1. Prepare and verify the reference choreography and metadata.
2. Build phrase selection, role selection, video looping, and dancer highlighting.
3. Add webcam tracking and full-body visibility checks.
4. Add practice-space calibration and formation landing evaluation.
5. Add timing and a small set of footwork and posture checks.
6. Add prioritized correction, retry, and weak-phrase review.
7. Add the same-attempt role-switch judging reveal.
8. Rehearse the complete demo and tune thresholds using the actual room, camera, and dancers.

