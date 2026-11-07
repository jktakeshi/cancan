# Product Vision

## Motivation

Missing one rehearsal can leave a dancer trying to reconstruct choreography from a crowded video. The video shows what happened, but it does not explain which dancer to follow, where that dancer travels, when each step happens, or what needs to change during practice.

We want to turn a rehearsal recording into an interactive lesson for one specific role.

## Main Goal

Let a dancer select their role in a rehearsal video, learn the role one phrase at a time, and practice in front of a single webcam.

The system should:

- identify and highlight the selected dancer;
- break the choreography into understandable counts and steps;
- make it easy to choose a section, phrase, or count to review;
- show body movement, foot placement, facing, and formation travel;
- provide useful views such as slow motion, a body skeleton, and a floor-path diagram;
- watch the learner practice with one webcam;
- evaluate timing, steps, formation position, and whole-body posture;
- give one clear correction, then allow an immediate retry.

## Core Experience

The rehearsal is organized into clear, selectable sections rather than presented as one long video. The learner can choose a phrase from a visual timeline, jump to a specific eight-count, or return directly to a difficult step. Each section shows its dancers, formation change, and a short preview so the correct part can be found without repeatedly scrubbing through the recording.

The learner watches the selected phrase, sees exactly who and what to follow, and practices it in small chunks. During practice, the laptop acts like a dance captain: it explains where to go, checks whether the steps and body shapes are correct, and prioritizes the most useful correction.

Feedback should be specific and physical, for example:

- "Start the turn on count four."
- "Travel one step farther to the right."
- "Transfer the weight onto the left foot."
- "The formation is correct; finish the right arm higher."

## The Sell

Most dance-learning tools compare a learner with a single performer or return a generic pose score. This product understands that choreography is role-specific: two dancers can perform the same phrase but travel to different places and finish in different formations.

Its defining demonstration is simple: the same physical landing can be correct for one role and wrong for another. The judgment changes because the selected dancer's path and formation responsibility change.

The product is not just a video player and not just a pose matcher. It is a role-aware rehearsal coach that teaches both the dance and the dancer's place within the group.

## Initial Scope

The first version should prove this experience with a short rehearsal divided into selectable eight-count phrases, two selectable roles, and one webcam. The dancer should be able to choose a phrase, review an individual count range, and return to the last attempted or weakest section. It should teach each phrase in short chunks and judge four things separately:

1. timing;
2. foot placement and travel;
3. formation position;
4. whole-body posture and final shape.

The objective is not to support every rehearsal video immediately. The objective is to make one role-specific learning experience clear, useful, and convincing from beginning to end.
