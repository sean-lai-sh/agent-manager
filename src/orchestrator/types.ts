export type ProjectPhase =
  | "idle"
  | "planning"
  | "awaiting_clarification"
  | "awaiting_approval"
  | "awaiting_execution_approval"
  | "executing"
  | "paused"
  | "completed"
  | "error";

export type AgentTaskType = "planning" | "execution";

export type AgentTaskStatus = "pending" | "in_progress" | "completed" | "failed";

export interface AgentTask {
  id: string;
  type: AgentTaskType;
  status: AgentTaskStatus;
  input: Record<string, unknown>;
  createdAt: string;
  dispatchedAt?: string;
  planId?: string;
  definitionId?: string;
}

export interface AgentResult {
  taskId: string;
  status: "success" | "failure";
  output?: Record<string, unknown>;
  error?: string;
  completedAt: string;
}

export type ApprovalType = "plan" | "execution_start" | "execution_retry";

export interface ApprovalRequest {
  id: string;
  type: ApprovalType;
  requestedAt: string;
  details: Record<string, unknown>;
  planId?: string;
  taskIds?: string[];
}

export interface TransitionRecord {
  timestamp: string;
  intentType: Intent["type"];
  from: ProjectPhase;
  to: ProjectPhase;
}

export interface ClarificationRecord {
  id: string;
  questions: string[];
  answers: string[];
  status: "open" | "answered" | "resolved";
  createdAt: string;
  resolvedAt?: string;
}

export interface DiscussionEntry {
  id: string;
  type: "clarification" | "plan" | "execution" | "system";
  message: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export type DiscussionEntryInput = Omit<DiscussionEntry, "id"> & { id?: string };

export interface Milestone {
  id: string;
  title: string;
  description?: string;
  targetDate?: string;
}

export interface Feature {
  id: string;
  title: string;
  description?: string;
  dependencies?: string[];
  owners?: string[];
}

export interface ExecutionTaskDef {
  id: string;
  title: string;
  description?: string;
  role: string;
  dependsOn?: string[];
  payload?: Record<string, unknown>;
}

export interface PlanSnapshot {
  id: string;
  createdAt: string;
  roadmap: Milestone[];
  features: Feature[];
  tasks: ExecutionTaskDef[];
  rationale?: string;
}

export interface ExecutionFailure {
  taskId: string;
  reason: string;
}

export interface ExecutionSummary {
  total: number;
  completed: number;
  failed: number;
  inProgress: number;
}

export interface ExecutionState {
  results: Record<string, AgentResult>;
  summary: ExecutionSummary;
  failures: ExecutionFailure[];
}

export interface OrchestratorSettings {
  requireExecutionApproval: boolean;
  requireRetryApproval: boolean;
}

export interface ProjectContext {
  icp?: string;
  techStack?: string[];
  constraints?: string[];
  coreFeatures?: string[];
}

export interface ProjectState {
  projectId: string;
  phase: ProjectPhase;
  version: number;
  updatedAt: string;
  goal?: string;
  context?: ProjectContext;
  plans: Record<string, PlanSnapshot>;
  currentPlanId?: string;
  pendingTasks: AgentTask[];
  approvals: ApprovalRequest[];
  clarifications: ClarificationRecord[];
  discussion: DiscussionEntry[];
  execution?: ExecutionState;
  settings: OrchestratorSettings;
  history: TransitionRecord[];
}

export type Intent =
  | {
    type: "create_project";
    payload: {
      projectId: string;
      goal: string;
      context?: ProjectContext;
      settings?: Partial<OrchestratorSettings>;
    };
  }
  | {
    type: "add_feature";
    payload: { description: string };
  }
  | {
    type: "request_clarifications";
    payload: { questions: string[]; discussion?: DiscussionEntryInput[] };
  }
  | {
    type: "answer_clarifications";
    payload: { clarificationId: string; answers: string[] };
  }
  | {
    type: "finalize_scope";
    payload?: { note?: string };
  }
  | {
    type: "approve_plan";
    payload: { approvalId: string; planId: string };
  }
  | {
    type: "approve_execution";
    payload: { approvalId: string };
  }
  | {
    type: "replan";
    payload?: { reason?: string };
  }
  | {
    type: "run_tasks";
    payload?: { taskIds?: string[] };
  }
  | {
    type: "retry_tasks";
    payload?: { taskIds?: string[] };
  }
  | {
    type: "pause_execution";
    payload?: { reason?: string };
  }
  | {
    type: "agent_result";
    payload: AgentResult;
  };

export type SideEffect =
  | { type: "dispatch_agent_task"; task: AgentTask }
  | { type: "request_approval"; approval: ApprovalRequest };

export interface StateTransitionResult {
  newState: ProjectState;
  sideEffects: SideEffect[];
}

export interface StateStore {
  load(): Promise<ProjectState | null>;
  save(state: ProjectState): Promise<void>;
}

export interface SideEffectHandler {
  dispatchAgentTask(task: AgentTask): Promise<void>;
  requestApproval(approval: ApprovalRequest): Promise<void>;
}
