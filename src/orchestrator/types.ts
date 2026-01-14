export type ProjectPhase =
  | "idle"
  | "planning"
  | "awaiting_approval"
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
}

export interface AgentResult {
  taskId: string;
  status: "success" | "failure";
  output?: Record<string, unknown>;
  error?: string;
  completedAt: string;
}

export interface ApprovalRequest {
  id: string;
  type: "plan" | "execution";
  requestedAt: string;
  details: Record<string, unknown>;
}

export interface TransitionRecord {
  timestamp: string;
  intentType: Intent["type"];
  from: ProjectPhase;
  to: ProjectPhase;
}

export interface ProjectState {
  projectId: string;
  phase: ProjectPhase;
  version: number;
  updatedAt: string;
  goal?: string;
  plan?: Record<string, unknown>;
  execution?: Record<string, unknown>;
  pendingTasks: AgentTask[];
  approvals: ApprovalRequest[];
  history: TransitionRecord[];
}

export type Intent =
  | {
      type: "create_project";
      payload: { projectId: string; goal: string };
    }
  | {
      type: "add_feature";
      payload: { description: string };
    }
  | {
      type: "approve_plan";
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
