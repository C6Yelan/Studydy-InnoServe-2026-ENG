import { SourceButton, sourceLinks } from "../../ui/SourceButton";
import type { StudydyApiClient } from "../../api/client";
import type { AssessmentRecordView, KnowledgeStructureView } from "../../api/contracts";
import { Icon } from "../../ui/Icon";
import "./styles.css";

export function AssessmentPanel({
  apiClient,
  record,
  completed,
  view,
  answerSelection,
}: {
  apiClient: StudydyApiClient;
  record: AssessmentRecordView;
  completed: boolean;
  view: KnowledgeStructureView;
  answerSelection: {
    value: string | null;
    disabled: boolean;
    onChange: (optionId: string) => void;
  };
}) {
  const assessment = record.assessment;
  const feedback = record.feedback;
  const selection = answerSelection.value;
  const canAnswer = !completed && record.can_submit;
  if (feedback) {
    const evidence = view.concepts
      .flatMap((item) => item.claims)
      .flatMap((claim) => claim.evidence)
      .filter((item) => feedback.source_evidence_ids.includes(item.evidence_id));
    const evidenceLinks = sourceLinks(evidence);
    return (
      <section
        className={`assessment-card feedback-card is-${feedback.is_correct ? "correct" : "incorrect"}`}
        aria-live="polite"
      >
        <header className="feedback-result">
          <span className="feedback-icon" aria-hidden="true">
            <Icon name={feedback.is_correct ? "check" : "warning"} size={24} />
          </span>
          <div>
            <p className="eyebrow">Answer feedback</p>
            <h2>{feedback.is_correct ? "Correct!" : "Review this answer"}</h2>
          </div>
        </header>
        <section className="feedback-section">
          <h3>Question</h3>
          <p>{assessment.prompt}</p>
        </section>
        <section className="feedback-section">
          <h3>Your answer</h3>
          <p>
            {
              assessment.options.find((option) => option.option_id === feedback.selected_option_id)
                ?.text
            }
          </p>
        </section>
        <section className="feedback-section">
          <h3>Why?</h3>
          <p className="feedback-rationale">{feedback.rationale}</p>
        </section>
        <div className="feedback-evidence">
          <h3>Source evidence</h3>
          {evidenceLinks.map((item) => (
            <SourceButton
              apiClient={apiClient}
              key={item.evidence_id}
              resolver={view.source_resolver}
              evidence={item}
            />
          ))}
        </div>
      </section>
    );
  }

  const questionId = `assessment-question-${assessment.question_id}`;
  return (
    <section className="assessment-card" aria-labelledby={questionId}>
      <p className="eyebrow">Multiple-choice question</p>
      <h2 id={questionId}>{assessment.prompt}</h2>
      <fieldset className="assessment-options" disabled={!canAnswer || answerSelection.disabled}>
        <legend className="sr-only">Choose one answer</legend>
        {assessment.options.map((option, index) => (
          <label
            className={selection === option.option_id ? "is-selected" : undefined}
            key={option.option_id}
          >
            <input
              type="radio"
              name={`assessment-option-${assessment.question_id}`}
              value={option.option_id}
              checked={selection === option.option_id}
              onChange={() => answerSelection.onChange(option.option_id)}
            />
            <span>{String.fromCharCode(65 + index)}</span>
            <strong>{option.text}</strong>
          </label>
        ))}
      </fieldset>
      {!canAnswer && <p className="assessment-readonly">This question is available for review only</p>}
    </section>
  );
}
