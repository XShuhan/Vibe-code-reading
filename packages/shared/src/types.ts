export type CodeNodeKind =
  | "file"
  | "directory"
  | "overview"
  | "symbolGroup"
  | "callChain"
  | "module"
  | "class"
  | "function"
  | "method"
  | "interface"
  | "type"
  | "variable";

export type CodeEdgeType =
  | "contains"
  | "imports"
  | "calls"
  | "implements"
  | "tests"
  | "references";

export type ThreadRole = "user" | "assistant" | "system_internal";
export type ThreadQuestionType =
  | "explain_code"
  | "call_flow"
  | "principle"
  | "risk_review"
  | "module_summary";

export type ThreadSkillId =
  | "ExplainSkill"
  | "CallFlowSkill"
  | "PrincipleSkill"
  | "RiskReviewSkill"
  | "ModuleSummarySkill";

export type CardType =
  | "SymbolCard"
  | "FlowCard"
  | "BugCard"
  | "ConceptCard"
  | "DecisionCard"
  | "QuestionCard";

export type CanvasRelation =
  | "explains"
  | "calls"
  | "depends_on"
  | "tests"
  | "related_to"
  | "causes"
  | "implements";

export type ModelProvider = "openai-compatible" | "mock";

export interface WorkspaceSnapshot {
  id: string;
  rootUri: string;
  revision: string;
  languageSet: string[];
  indexedAt: string;
  analyzerVersion: string;
}

export interface CodeNode {
  id: string;
  workspaceId: string;
  kind: CodeNodeKind;
  name: string;
  path: string;
  rangeStartLine: number;
  rangeEndLine: number;
  signature?: string;
  docComment?: string;
  exported: boolean;
  parentId?: string;
}

export interface CodeEdge {
  id: string;
  workspaceId: string;
  fromNodeId: string;
  toNodeId: string;
  type: CodeEdgeType;
  inferred?: boolean;
}

export interface Citation {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  symbolId?: string;
  label: string;
}

export interface EvidenceSpan {
  id: string;
  workspaceId: string;
  path: string;
  startLine: number;
  endLine: number;
  symbolId?: string;
  excerpt: string;
  score: number;
  reason: string;
}

export interface ThreadMessage {
  id: string;
  role: ThreadRole;
  content: string;
  citations: Citation[];
  createdAt: string;
  structuredAnswer?: StructuredThreadAnswer;
  streamStatus?: ThreadStreamStatus;
}

export interface StructuredThreadAnswer {
  questionType: ThreadQuestionType;
  skillId: ThreadSkillId;
  questionRestatement: string;
  conclusion: string;
  codeBehavior: string;
  principle: string;
  callFlow: string;
  risks: string;
  uncertainty: string;
  sourceReferences: string[];
  sections?: StructuredSection[];
  extraSections?: StructuredSection[];
}

export interface StructuredSection {
  title: string;
  content: string;
}

export interface ThreadStreamStatus {
  isStreaming: boolean;
  currentSection?: string;
}

export interface Thread {
  id: string;
  workspaceId: string;
  title: string;
  questionType?: ThreadQuestionType;
  skillId?: ThreadSkillId;
  createdAt: string;
  updatedAt: string;
  contextRefs: string[];
  messages: ThreadMessage[];
}

export interface Card {
  id: string;
  workspaceId: string;
  type: CardType;
  title: string;
  summary: string;
  evidenceRefs: Citation[];
  sourceThreadId?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CanvasNode {
  id: string;
  cardId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CanvasEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  relation: CanvasRelation;
}

export interface CanvasViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface CanvasState {
  id: string;
  workspaceId: string;
  name: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  viewport: CanvasViewport;
  updatedAt: string;
}

export interface QuestionContext {
  workspaceId: string;
  activeFile: string;
  activeSelection?: {
    startLine: number;
    endLine: number;
    text: string;
  };
  activeSymbolId?: string;
  nearbySymbolIds: string[];
  selectedCardIds: string[];
  userQuestion: string;
}

export interface GroundedAnswer {
  answerMarkdown: string;
  structuredAnswer?: StructuredThreadAnswer;
  citations: Citation[];
  suggestedCards: Array<Pick<Card, "title" | "type" | "summary">>;
  uncertaintyFlags: string[];
}

export interface WorkspaceIndex {
  snapshot: WorkspaceSnapshot;
  nodes: CodeNode[];
  edges: CodeEdge[];
  fileContents: Record<string, string>;
}

export interface EditorSelectionState {
  activeFile: string;
  startLine: number;
  endLine: number;
  selectedText: string;
  currentSymbolId?: string;
}

export interface TracePathResult {
  anchorNodeId: string;
  callers: CodeEdge[];
  callees: CodeEdge[];
  neighbors: CodeEdge[];
}

export interface ModelInfo {
  id: string;
  label: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export type ModelResponseFormat =
  | {
      type: "json_object";
    }
  | {
      type: "json_schema";
      json_schema: {
        name: string;
        schema: Record<string, unknown>;
        strict?: boolean;
      };
    };

export interface ModelRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  responseFormat?: ModelResponseFormat;
}

export interface ModelChunk {
  delta: string;
  done?: boolean;
}

export interface ModelResponse {
  content: string;
}

export interface ModelConfig {
  provider: ModelProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
}

export interface WebviewThreadState {
  kind: "thread";
  title: string;
  thread: Thread;
}

export interface WebviewCardState {
  kind: "card";
  title: string;
  card: Card;
}

export interface CanvasCardViewModel {
  card: Card;
  node?: CanvasNode;
}

export interface WebviewCanvasState {
  kind: "canvas";
  title: string;
  canvas: CanvasState;
  cards: CanvasCardViewModel[];
}

export type WebviewState =
  | WebviewThreadState
  | WebviewCardState
  | WebviewCanvasState;

