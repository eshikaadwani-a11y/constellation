/** The systems tutor: a deterministic engine that explains system behaviour. */
export {
  analyze,
  electionAnalyzer,
  replicationAnalyzer,
  faultAnalyzer,
  networkAnalyzer,
  DEFAULT_ANALYZERS,
  type Insight,
  type InsightSeverity,
  type InsightCategory,
  type Analyzer,
} from "./insights.js";
export { explainRaft } from "./explain.js";
