import type { Citation, ThreadMessage, WebviewThreadState } from "@code-vibe/shared";

interface ThreadDetailProps {
  state: WebviewThreadState;
  onOpenCitation: (citation: Citation) => void;
}

export function ThreadDetail({ state, onOpenCitation }: ThreadDetailProps) {
  return (
    <main className="detail-shell">
      <section className="detail-panel">
        <p className="eyebrow">Thread</p>
        <h1>{state.thread.title}</h1>
        <p className="muted">
          Updated {new Date(state.thread.updatedAt).toLocaleString()}
        </p>
      </section>

      {state.thread.messages.map((message) => (
        <MessageCard
          key={message.id}
          message={message}
          onOpenCitation={onOpenCitation}
        />
      ))}
    </main>
  );
}

function MessageCard({
  message,
  onOpenCitation
}: {
  message: ThreadMessage;
  onOpenCitation: (citation: Citation) => void;
}) {
  const structured = message.structuredAnswer;
  const dynamicSections =
    structured?.sections && structured.sections.length > 0
      ? structured.sections
      : null;
  const streaming = message.streamStatus?.isStreaming === true;
  const currentSection = message.streamStatus?.currentSection;

  return (
    <section className="detail-panel">
      <p className="eyebrow">{message.role}</p>
      {streaming ? (
        <div className="stream-status">
          <span className="stream-dot" />
          <span>
            Generating{currentSection ? `: ${currentSection}` : "..."}
          </span>
        </div>
      ) : null}
      {structured ? (
        <div className="section-grid">
          {shouldShowSummaryPrelude(structured) ? (
            <>
              <SectionBlock
                title="Question restatement"
                content={structured.questionRestatement}
                streaming={streaming}
                isActive={currentSection === "Question restatement"}
              />
              <SectionBlock
                title="Conclusion first"
                content={structured.conclusion}
                streaming={streaming}
                isActive={currentSection === "Conclusion first"}
              />
            </>
          ) : null}
          {dynamicSections ? (
            dynamicSections.map((section, index) => (
              <SectionBlock
                key={`${section.title}-${index}`}
                title={section.title}
                content={section.content}
                streaming={streaming}
                isActive={currentSection === section.title}
              />
            ))
          ) : (
            <>
              <SectionBlock
                title="What the code is doing"
                content={structured.codeBehavior}
                streaming={streaming}
                isActive={currentSection === "What the code is doing"}
              />
              <SectionBlock
                title="Why / principle"
                content={structured.principle}
                streaming={streaming}
                isActive={currentSection === "Why / principle"}
              />
              <SectionBlock
                title="Call flow / upstream-downstream"
                content={structured.callFlow}
                streaming={streaming}
                isActive={currentSection === "Call flow / upstream-downstream"}
              />
              {(structured.extraSections ?? []).map((section, index) => (
                <SectionBlock
                  key={`${section.title}-${index}`}
                  title={section.title}
                  content={section.content}
                  streaming={streaming}
                  isActive={currentSection === section.title}
                />
              ))}
              <SectionBlock
                title="Risks / uncertainties"
                content={[structured.risks, structured.uncertainty].join("\n")}
                streaming={streaming}
                isActive={currentSection === "Risks / uncertainties"}
              />
            </>
          )}
        </div>
      ) : (
        <pre className={`detail-content ${message.content.startsWith("Generating answer") ? "is-generating" : ""}`}>
          {message.content}
        </pre>
      )}
      {message.citations.length > 0 ? (
        <>
          <h2>Source references</h2>
          <div className="chip-grid">
            {message.citations.map((citation) => (
              <button
                key={citation.id}
                className="chip"
                onClick={() => onOpenCitation(citation)}
              >
                {citation.label}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}

function SectionBlock({
  title,
  content,
  streaming = false,
  isActive = false
}: {
  title: string;
  content: string;
  streaming?: boolean;
  isActive?: boolean;
}) {
  if (!content.trim()) {
    return null;
  }

  return (
    <article className="thread-section">
      <h3>{title}</h3>
      <pre className="detail-content">
        {content}
        {streaming && isActive ? <span className="stream-cursor">|</span> : null}
      </pre>
    </article>
  );
}

function shouldShowSummaryPrelude(answer: NonNullable<ThreadMessage["structuredAnswer"]>): boolean {
  if (answer.questionType === "module_summary") {
    return true;
  }

  if (/(summary|summarize|总结|归纳|tl;dr|tldr)/i.test(answer.questionRestatement)) {
    return true;
  }

  return false;
}

