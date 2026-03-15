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

  return (
    <section className="detail-panel">
      <p className="eyebrow">{message.role}</p>
      {structured ? (
        <div className="section-grid">
          <SectionBlock title="Question restatement" content={structured.questionRestatement} />
          <SectionBlock title="Conclusion first" content={structured.conclusion} />
          <SectionBlock title="What the code is doing" content={structured.codeBehavior} />
          <SectionBlock title="Why / principle" content={structured.principle} />
          <SectionBlock title="Call flow / upstream-downstream" content={structured.callFlow} />
          <SectionBlock title="Risks / uncertainties" content={[structured.risks, structured.uncertainty].join("\n")} />
        </div>
      ) : (
        <pre className="detail-content">{message.content}</pre>
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

function SectionBlock({ title, content }: { title: string; content: string }) {
  return (
    <article className="thread-section">
      <h3>{title}</h3>
      <pre className="detail-content">{content}</pre>
    </article>
  );
}

