import type { ClarificationRecord, ProjectContext } from "../orchestrator/types";

export type PlanningStage = "clarification" | "final";

export interface PlanningInput {
  goal?: string;
  context?: ProjectContext;
  clarifications: ClarificationRecord[];
  stage: PlanningStage;
  note?: string;
}

export interface MilestoneDraft {
  id?: string;
  title: string;
  description?: string;
  targetDate?: string;
}

export interface FeatureDraft {
  id?: string;
  title: string;
  description?: string;
  dependencies?: string[];
  owners?: string[];
}

export type TaskRole =
  | "frontend"
  | "backend"
  | "ai_orchestration"
  | "infrastructure"
  | "testing"
  | "documentation"
  | "design"
  | string;

export interface TaskDraft {
  id?: string;
  title: string;
  description?: string;
  role: TaskRole;
  dependsOn?: string[];
  payload?: Record<string, unknown>;
}

export interface PlanDraft {
  roadmap: MilestoneDraft[];
  features: FeatureDraft[];
  tasks: TaskDraft[];
  rationale?: string;
}

export interface PlanningOutputQuestions {
  questions: [string];
  plan?: never;
}

export interface PlanningOutputPlan {
  questions?: never;
  plan: PlanDraft;
}

export type PlanningOutput = PlanningOutputQuestions | PlanningOutputPlan;

export interface AnsweredClarification {
  question: string;
  answer: string;
}

export interface PlanningPromptContext {
  goal?: string;
  context?: ProjectContext;
  answeredClarifications: AnsweredClarification[];
  stage: PlanningStage;
  note?: string;
}

export { ProjectContext };
