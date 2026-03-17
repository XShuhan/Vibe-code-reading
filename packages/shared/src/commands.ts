export const COMMANDS = {
  refreshIndex: "vibe.refreshIndex",
  testModelConnection: "vibe.testModelConnection",
  askAboutSelection: "vibe.askAboutSelection",
  explainCurrentSymbol: "vibe.explainCurrentSymbol",
  saveSelectionAsCard: "vibe.saveSelectionAsCard",
  addThreadAnswerToCanvas: "vibe.addThreadAnswerToCanvas",
  openCanvas: "vibe.openCanvas",
  traceCallPath: "vibe.traceCallPath",
  openThread: "vibe.openThread",
  openCard: "vibe.openCard",
  openCitation: "vibe.openCitation",
  openProjectOverview: "vibe.openProjectOverview"
} as const;

export const VIEWS = {
  container: "vibe",
  map: "vibe.map",
  threads: "vibe.threads",
  cards: "vibe.cards"
} as const;
