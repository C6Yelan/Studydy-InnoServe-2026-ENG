# Learning and assessment

[Documentation](../README.md) · [User guide](usage.md) · [Materials](materials.md)

## Identity and scope

A learner, material, and knowledge-structure revision identify a durable StudySession. Concepts may have independent sets, with at most one active set per session/concept. Reads do not create sessions or regrade answers.

Set ownership, structure revision, concept, and membership determine answer authorization independently of navigation focus.

## Preparation and publication

Eligible concept points determine set size. Sets preserve plans, execution snapshots, per-item state, and leases. The worker generates candidates outside database transactions and publishes only verified results.

The independent checker receives evidence, question stems, and reordered options without the generator's answer key. Publication requires one supported answer matching the candidate key, valid evidence, and no duplicate published question. Quality flags rank correct candidates; a weak distractor alone does not make a question unsafe.

Public APIs never expose unpublished questions or private answer keys. Failed items can be retried explicitly; available items can be published as a partial set. Unpublished points remain unassessed. Configuration changes affect newly created sets, not saved snapshots.

## Submission

A submission includes every published question's selected option, expected_set_version, and an idempotency key. Missing answers, duplicate members, invalid options, or scope mismatches reject the entire submission.

Answers, event sequence, and completion state commit atomically. The server grades against private keys. Replaying the same intent does not duplicate credit or overwrite answers. Refresh conflicting versions and retrieve saved results after response loss.

## Follow-up and mastery

Follow-up sets belong to an initial check and target only points still needing improvement. Each round requires an explicit action; an active set must be resumed first.

| Point state | Meaning |
| --- | --- |
| diagnostic_pass | Initial check answered correctly |
| needs_review | Initial answer was wrong and the latest follow-up has not passed |
| remediation_pass | Follow-up answered correctly |
| unanswered | No answer submitted |
| unavailable | No question published |

Unanswered points and generation failures are neither wrong answers nor passes. The cycle projects in_progress, needs_review, passed, or incomplete from active work and point outcomes.

Follow-up answers are assisted: they count toward improvement but not independent mastery evidence. Mastery requires distinct qualified correct questions and the latest correct answer for each claim; see [learning_states.py](../backend/src/learning_adaptation/learning_states.py).

## Recovery and inheritance

Progress and resume share one database snapshot and verify session, run, structure revision, set membership, and event sequence. URLs can identify a saved set. Reading, refreshing, or signing in again creates no question or answer event.

The server determines the next action and the client submits its guidance_revision. Updated materials inherit evidence only for unique matches with unchanged text, sources, and blocks; changed or ambiguous points do not inherit automatically.

Inheritance copies no answer events and changes no question, grade, timestamp, or source revision. Saved sets remain readable against their original structure.
