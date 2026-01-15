import { createHash, randomUUID } from "crypto";
import {
  AgentResult,
  AgentTask,
  AgentTaskStatus,
  ApprovalRequest,
  ApprovalType,
  ClarificationRecord,
  DiscussionEntry,
  DiscussionEntryInput,
  ExecutionFailure,
  ExecutionState,
  ExecutionSummary,
  ExecutionTaskDef,
  Feature,
  Intent,
  Milestone,
  OrchestratorSettings,
  PlanSnapshot,
  ProjectPhase,
  ProjectState,
  SideEffect,
  StateTransitionResult,
} from "./types";

const DEFAULT_SETTINGS: OrchestratorSettings = {
  requireExecutionApproval: false,
  requireRetryApproval: true,
};

export function transitionState(
  state: ProjectState,
  intent: Intent,
  now: string = new Date().toISOString(),
): StateTransitionResult {
  switch (intent.type) {
    case "create_project": {
      const baseState = createProjectState(
        intent.payload.projectId,
        intent.payload.goal,
        now,
        intent.payload.settings,
      );
      const planningTask = buildPlanningTask(
        {
          goal: intent.payload.goal,
          clarifications: baseState.clarifications,
          stage: "clarification",
        },
        now,
      );
      const result = markTasksForDispatch([planningTask], [planningTask.id], now);
      const newState = applyTransition(baseState, intent, "idle", "planning", now, {
        pendingTasks: result.updatedTasks,
      });
      return { newState, sideEffects: result.tasks.map((task) => ({ type: "dispatch_agent_task", task })) };
    }
    case "add_feature": {
      const planningTask = buildPlanningTask(
        {
          goal: state.goal,
          clarifications: state.clarifications,
          stage: "clarification",
          note: intent.payload.description,
        },
        now,
      );
      const allTasks = [...state.pendingTasks, planningTask];
      const result = markTasksForDispatch(allTasks, [planningTask.id], now);
      const newState = applyTransition(state, intent, state.phase, "planning", now, {
        pendingTasks: result.updatedTasks,
      });
      return { newState, sideEffects: result.tasks.map((task) => ({ type: "dispatch_agent_task", task })) };
    }
    case "request_clarifications": {
      return handleClarificationRequest(state, intent.payload, now, intent);
    }
    case "answer_clarifications": {
      return handleClarificationAnswer(state, intent.payload, now, intent);
    }
    case "finalize_scope": {
      return handleFinalizeScope(state, intent.payload, now, intent);
    }
    case "approve_plan": {
      return handlePlanApproval(state, intent.payload, now, intent);
    }
    case "approve_execution": {
      return handleExecutionApproval(state, intent.payload.approvalId, now, intent);
    }
    case "replan": {
      const planningTask = buildPlanningTask(
        {
          goal: state.goal,
          clarifications: state.clarifications,
          stage: "clarification",
          note: intent.payload?.reason ?? "replan",
        },
        now,
      );
      const allTasks = [...state.pendingTasks, planningTask];
      const result = markTasksForDispatch(allTasks, [planningTask.id], now);
      const newState = applyTransition(state, intent, state.phase, "planning", now, {
        pendingTasks: result.updatedTasks,
      });
      return { newState, sideEffects: result.tasks.map((task) => ({ type: "dispatch_agent_task", task })) };
    }
    case "run_tasks": {
      return handleRunTasks(state, intent.payload?.taskIds ?? [], now, intent);
    }
    case "retry_tasks": {
      return handleRetryTasks(state, intent.payload?.taskIds ?? [], now, intent);
    }
    case "pause_execution": {
      const discussion = appendDiscussion(state.discussion, now, {
        type: "system",
        message: intent.payload?.reason ?? "Execution paused",
        timestamp: now,
      });
      const newState = applyTransition(state, intent, state.phase, "paused", now, { discussion });
      return { newState, sideEffects: [] };
    }
    case "agent_result": {
      return handleAgentResult(state, intent.payload, now, intent);
    }
    default: {
      const newState = applyTransition(state, intent, state.phase, state.phase, now, {});
      return { newState, sideEffects: [] };
    }
  }
}

export function createProjectState(
  projectId: string,
  goal: string,
  now: string,
  settings?: Partial<OrchestratorSettings>,
): ProjectState {
  return {
    projectId,
    phase: "idle",
    version: 0,
    updatedAt: now,
    goal,
    plans: {},
    pendingTasks: [],
    approvals: [],
    clarifications: [],
    discussion: [],
    settings: { ...DEFAULT_SETTINGS, ...(settings ?? {}) },
    history: [],
  };
}

function applyTransition(
  state: ProjectState,
  intent: Intent,
  from: ProjectPhase,
  to: ProjectPhase,
  now: string,
  overrides: Partial<ProjectState>,
): ProjectState {
  return {
    ...state,
    ...overrides,
    phase: to,
    version: state.version + 1,
    updatedAt: now,
    history: [...state.history, { timestamp: now, intentType: intent.type, from, to }],
  };
}

function buildPlanningTask(
  context: {
    goal?: string;
    clarifications: ClarificationRecord[];
    stage: "clarification" | "final";
    note?: string;
  },
  now: string,
): AgentTask {
  const id = `plan-${randomUUID()}`;
  return {
    id,
    type: "planning",
    status: "pending",
    input: {
      goal: context.goal,
      clarifications: context.clarifications,
      stage: context.stage,
      note: context.note,
    },
    createdAt: now,
  };
}

function handleClarificationRequest(
  state: ProjectState,
  payload: { questions: string[]; discussion?: DiscussionEntryInput[] },
  now: string,
  intent: Intent,
): StateTransitionResult {
  const clarification = createClarificationRecord(payload.questions, now);
  const clarifications = [...state.clarifications, clarification];
  const discussion = appendDiscussion(state.discussion, now, payload.discussion, {
    type: "clarification",
    message: `Clarifications requested (${payload.questions.length})`,
    timestamp: now,
    metadata: { clarificationId: clarification.id },
  });
  const newState = applyTransition(state, intent, state.phase, "awaiting_clarification", now, {
    clarifications,
    discussion,
  });
  return { newState, sideEffects: [] };
}

function handleClarificationAnswer(
  state: ProjectState,
  payload: { clarificationId: string; answers: string[] },
  now: string,
  intent: Intent,
): StateTransitionResult {
  const { clarifications, found } = updateClarificationAnswers(
    state.clarifications,
    payload.clarificationId,
    payload.answers,
    now,
  );
  if (!found) {
    return failTransition(state, intent, "Clarification not found", now);
  }

  const planningTask = buildPlanningTask(
    {
      goal: state.goal,
      clarifications,
      stage: "clarification",
    },
    now,
  );
  const discussion = appendDiscussion(state.discussion, now, {
    type: "clarification",
    message: "Clarifications answered",
    timestamp: now,
    metadata: { clarificationId: payload.clarificationId },
  });
  const allTasks = [...state.pendingTasks, planningTask];
  const result = markTasksForDispatch(allTasks, [planningTask.id], now);
  const newState = applyTransition(state, intent, state.phase, "planning", now, {
    clarifications,
    discussion,
    pendingTasks: result.updatedTasks,
  });
  return { newState, sideEffects: result.tasks.map((task) => ({ type: "dispatch_agent_task", task })) };
}

function handleFinalizeScope(
  state: ProjectState,
  payload: { note?: string } | undefined,
  now: string,
  intent: Intent,
): StateTransitionResult {
  const clarifications = state.clarifications.map((record) =>
    record.status === "resolved"
      ? record
      : { ...record, status: "resolved", resolvedAt: record.resolvedAt ?? now },
  );
  const planningTask = buildPlanningTask(
    {
      goal: state.goal,
      clarifications,
      stage: "final",
      note: payload?.note,
    },
    now,
  );
  const discussion = appendDiscussion(state.discussion, now, {
    type: "plan",
    message: "Scope finalized for planning",
    timestamp: now,
  });
  const allTasks = [...state.pendingTasks, planningTask];
  const result = markTasksForDispatch(allTasks, [planningTask.id], now);
  const newState = applyTransition(state, intent, state.phase, "planning", now, {
    clarifications,
    discussion,
    pendingTasks: result.updatedTasks,
  });
  return { newState, sideEffects: result.tasks.map((task) => ({ type: "dispatch_agent_task", task })) };
}

function handlePlanApproval(
  state: ProjectState,
  payload: { approvalId: string; planId: string },
  now: string,
  intent: Intent,
): StateTransitionResult {
  const approval = state.approvals.find((entry) => entry.id === payload.approvalId);
  if (!approval || approval.type !== "plan" || approval.planId !== payload.planId) {
    return failTransition(state, intent, "Plan approval mismatch", now);
  }
  const plan = state.plans[payload.planId];
  if (!plan) {
    return failTransition(state, intent, "Plan not found for approval", now);
  }

  let approvals = state.approvals.filter((entry) => entry.id !== approval.id);
  const executionTasks = buildExecutionTasks(plan, now);
  let pendingTasks = [...state.pendingTasks, ...executionTasks];
  let sideEffects: SideEffect[] = [];
  let phase: ProjectPhase = "executing";

  if (state.settings.requireExecutionApproval) {
    const executionApproval = createExecutionApproval("execution_start", plan.id, executionTasks, now);
    approvals = [...approvals, executionApproval];
    phase = "awaiting_execution_approval";
    sideEffects = [{ type: "request_approval", approval: executionApproval }];
  } else {
    const tasksToDispatch = markTasksForDispatch(pendingTasks, executionTasks.map((task) => task.id), now);
    pendingTasks = tasksToDispatch.updatedTasks;
    sideEffects = tasksToDispatch.tasks.map((task) => ({ type: "dispatch_agent_task", task }));
    phase = executionTasks.length === 0 ? "completed" : "executing";
  }

  const execution = buildExecutionState(pendingTasks);
  const discussion = appendDiscussion(state.discussion, now, {
    type: "plan",
    message: "Plan approved",
    timestamp: now,
    metadata: { planId: plan.id },
  });
  const newState = applyTransition(state, intent, state.phase, phase, now, {
    approvals,
    pendingTasks,
    execution,
    discussion,
    currentPlanId: plan.id,
  });
  return { newState, sideEffects };
}

function handleExecutionApproval(
  state: ProjectState,
  approvalId: string,
  now: string,
  intent: Intent,
): StateTransitionResult {
  const approval = state.approvals.find((entry) => entry.id === approvalId);
  if (!approval || (approval.type !== "execution_start" && approval.type !== "execution_retry")) {
    return failTransition(state, intent, "Execution approval mismatch", now);
  }

  const taskIds = approval.taskIds ?? state.pendingTasks.map((task) => task.id);
  const result = markTasksForDispatch(state.pendingTasks, taskIds, now);
  const approvals = state.approvals.filter((entry) => entry.id !== approvalId);
  const execution = buildExecutionState(result.updatedTasks, state.execution);
  const discussion = appendDiscussion(state.discussion, now, {
    type: "execution",
    message:
      approval.type === "execution_retry" ? "Retry approved" : "Execution approved",
    timestamp: now,
    metadata: { approvalId },
  });
  const newState = applyTransition(state, intent, state.phase, "executing", now, {
    approvals,
    pendingTasks: result.updatedTasks,
    execution,
    discussion,
  });
  return {
    newState,
    sideEffects: result.tasks.map((task) => ({ type: "dispatch_agent_task", task })),
  };
}

function handleRunTasks(
  state: ProjectState,
  taskIds: string[],
  now: string,
  intent: Intent,
): StateTransitionResult {
  if (hasExecutionApprovalPending(state.approvals)) {
    return rejectTransition(state, intent, "Execution approval required", now);
  }
  const targetIds = taskIds.length > 0 ? taskIds : state.pendingTasks.filter((t) => t.status === "pending").map((task) => task.id);
  const result = markTasksForDispatch(state.pendingTasks, targetIds, now);
  const execution = buildExecutionState(result.updatedTasks, state.execution);
  const newState = applyTransition(state, intent, state.phase, state.phase, now, {
    pendingTasks: result.updatedTasks,
    execution,
  });
  return {
    newState,
    sideEffects: result.tasks.map((task) => ({ type: "dispatch_agent_task", task })),
  };
}

function handleRetryTasks(
  state: ProjectState,
  taskIds: string[],
  now: string,
  intent: Intent,
): StateTransitionResult {
  // Filter to only execution tasks
  const executionTaskIds = state.pendingTasks
    .filter((task) => task.type === "execution" && (taskIds.length === 0 || taskIds.includes(task.id)))
    .map((task) => task.id);
  const failedTaskIds = taskIds.length > 0
    ? executionTaskIds.filter((id) => {
        const task = state.pendingTasks.find((t) => t.id === id);
        return task?.status === "failed";
      })
    : getFailedTaskIds(state.pendingTasks);

  if (failedTaskIds.length === 0) {
    return { newState: state, sideEffects: [] };
  }

  const pendingTasks = state.pendingTasks.map((task) =>
    failedTaskIds.includes(task.id) ? { ...task, status: "pending" as const } : task,
  );
  const executionSeed = pruneExecutionResults(state.execution, failedTaskIds);
  let approvals = state.approvals;
  let phase: ProjectPhase = "executing";
  let sideEffects: SideEffect[] = [];

  if (state.settings.requireRetryApproval) {
    const approval = createExecutionApproval("execution_retry", state.currentPlanId, pendingTasks, now, failedTaskIds);
    approvals = [...state.approvals, approval];
    phase = "awaiting_execution_approval";
    sideEffects = [{ type: "request_approval", approval }];
  } else {
    const result = markTasksForDispatch(pendingTasks, failedTaskIds, now);
    approvals = state.approvals;
    phase = "executing";
    sideEffects = result.tasks.map((task) => ({ type: "dispatch_agent_task", task }));
    return finalizeRetryTransition(
      state,
      intent,
      result.updatedTasks,
      approvals,
      executionSeed,
      now,
      phase,
      sideEffects,
    );
  }

  const execution = buildExecutionState(pendingTasks, executionSeed);
  const discussion = appendDiscussion(state.discussion, now, {
    type: "execution",
    message: "Retry requested",
    timestamp: now,
    metadata: { taskIds: failedTaskIds },
  });
  const newState = applyTransition(state, intent, state.phase, phase, now, {
    approvals,
    pendingTasks,
    execution,
    discussion,
  });
  return { newState, sideEffects };
}

function finalizeRetryTransition(
  state: ProjectState,
  intent: Intent,
  pendingTasks: AgentTask[],
  approvals: ApprovalRequest[],
  executionSeed: ExecutionState | undefined,
  now: string,
  phase: ProjectPhase,
  sideEffects: SideEffect[],
): StateTransitionResult {
  const execution = buildExecutionState(pendingTasks, executionSeed);
  const discussion = appendDiscussion(state.discussion, now, {
    type: "execution",
    message: "Retry dispatched",
    timestamp: now,
  });
  const newState = applyTransition(state, intent, state.phase, phase, now, {
    approvals,
    pendingTasks,
    execution,
    discussion,
  });
  return { newState, sideEffects };
}

function handleAgentResult(
  state: ProjectState,
  result: AgentResult,
  now: string,
  intent: Intent,
): StateTransitionResult {
  const task = state.pendingTasks.find((entry) => entry.id === result.taskId);
  if (!task) {
    return failTransition(state, intent, "Task not found for agent result", now);
  }

  const updatedTasks = state.pendingTasks.map((entry) =>
    entry.id === result.taskId
      ? { ...entry, status: result.status === "success" ? "completed" : "failed" }
      : entry,
  );

  if (task.type === "planning") {
    return handlePlanningResult(state, result, updatedTasks, now, intent);
  }

  if (task.type === "execution") {
    return handleExecutionResult(state, result, updatedTasks, now, intent);
  }

  const newState = applyTransition(state, intent, state.phase, state.phase, now, {
    pendingTasks: updatedTasks,
  });
  return { newState, sideEffects: [] };
}

function handlePlanningResult(
  state: ProjectState,
  result: AgentResult,
  updatedTasks: AgentTask[],
  now: string,
  intent: Intent,
): StateTransitionResult {
  if (result.status !== "success") {
    const discussion = appendDiscussion(state.discussion, now, {
      type: "system",
      message: result.error ?? "Planning failed",
      timestamp: now,
    });
    const newState = applyTransition(state, intent, state.phase, "error", now, {
      pendingTasks: updatedTasks,
      discussion,
    });
    return { newState, sideEffects: [] };
  }

  const planningOutput = parsePlanningOutput(result.output, now);
  const discussion = appendDiscussion(state.discussion, now, planningOutput.discussion);

  if (planningOutput.questions.length > 0) {
    const clarification = createClarificationRecord(planningOutput.questions, now);
    const clarifications = [...state.clarifications, clarification];
    const updatedDiscussion = appendDiscussion(discussion, now, {
      type: "clarification",
      message: `Clarifications requested (${planningOutput.questions.length})`,
      timestamp: now,
      metadata: { clarificationId: clarification.id },
    });
    const newState = applyTransition(state, intent, state.phase, "awaiting_clarification", now, {
      pendingTasks: updatedTasks,
      clarifications,
      discussion: updatedDiscussion,
    });
    return { newState, sideEffects: [] };
  }

  if (!planningOutput.plan) {
    const newState = applyTransition(state, intent, state.phase, "planning", now, {
      pendingTasks: updatedTasks,
      discussion,
    });
    return { newState, sideEffects: [] };
  }

  const planSnapshot = normalizePlanSnapshot(planningOutput.plan, now);
  const plans = { ...state.plans, [planSnapshot.id]: planSnapshot };
  const approval = createPlanApproval(planSnapshot, now);
  const approvals = [...state.approvals, approval];
  const updatedDiscussion = appendDiscussion(discussion, now, {
    type: "plan",
    message: "Plan candidate ready for approval",
    timestamp: now,
    metadata: { planId: planSnapshot.id },
  });
  const newState = applyTransition(state, intent, state.phase, "awaiting_approval", now, {
    pendingTasks: updatedTasks,
    plans,
    currentPlanId: planSnapshot.id,
    approvals,
    discussion: updatedDiscussion,
  });
  return { newState, sideEffects: [{ type: "request_approval", approval }] };
}

function handleExecutionResult(
  state: ProjectState,
  result: AgentResult,
  updatedTasks: AgentTask[],
  now: string,
  intent: Intent,
): StateTransitionResult {
  const execution = updateExecutionState(state.execution, updatedTasks, result);
  const summary = execution.summary;
  const failures = execution.failures;
  const pendingCount = summary.total - summary.completed - summary.failed;

  let nextPhase: ProjectPhase = state.phase;
  if (summary.total > 0 && summary.completed === summary.total && failures.length === 0) {
    nextPhase = "completed";
  } else if (failures.length > 0 && pendingCount === 0) {
    nextPhase = "error";
  }

  const discussion = appendDiscussion(state.discussion, now, {
    type: "execution",
    message: result.status === "success" ? "Execution task completed" : "Execution task failed",
    timestamp: now,
    metadata: { taskId: result.taskId },
  });
  const newState = applyTransition(state, intent, state.phase, nextPhase, now, {
    pendingTasks: updatedTasks,
    execution,
    discussion,
  });
  return { newState, sideEffects: [] };
}

function createClarificationRecord(questions: string[], now: string): ClarificationRecord {
  return {
    id: buildDeterministicId({ questions, createdAt: now }, "clarification"),
    questions,
    answers: [],
    status: "open",
    createdAt: now,
  };
}

function updateClarificationAnswers(
  clarifications: ClarificationRecord[],
  clarificationId: string,
  answers: string[],
  now: string,
): { clarifications: ClarificationRecord[]; found: boolean } {
  let found = false;
  const updated = clarifications.map((record) => {
    if (record.id !== clarificationId) {
      return record;
    }
    found = true;
    return {
      ...record,
      answers,
      status: "answered",
      resolvedAt: now,
    };
  });
  return { clarifications: updated, found };
}

function parsePlanningOutput(output: Record<string, unknown> | undefined, now: string): {
  questions: string[];
  plan?: Omit<PlanSnapshot, "id" | "createdAt">;
  discussion?: DiscussionEntry[];
} {
  if (!output) {
    return { questions: [] };
  }

  const questions = Array.isArray(output.questions)
    ? output.questions.filter((question) => typeof question === "string")
    : [];
  const discussion = normalizeDiscussion(output.discussion, now);
  const planCandidate = extractPlanCandidate(output);

  return {
    questions,
    discussion,
    plan: planCandidate ?? undefined,
  };
}

function extractPlanCandidate(
  output: Record<string, unknown>,
): Omit<PlanSnapshot, "id" | "createdAt"> | null {
  if (output.plan && typeof output.plan === "object") {
    return normalizePlanDraft(output.plan as Record<string, unknown>);
  }

  if (output.roadmap || output.features || output.tasks) {
    return normalizePlanDraft(output);
  }

  return null;
}

function normalizePlanDraft(
  draft: Record<string, unknown>,
): Omit<PlanSnapshot, "id" | "createdAt"> {
  const roadmap = normalizeMilestones(draft.roadmap);
  const features = normalizeFeatures(draft.features);
  const tasks = normalizeExecutionTasks(draft.tasks);
  const rationale = typeof draft.rationale === "string" ? draft.rationale : undefined;

  return {
    roadmap,
    features,
    tasks,
    rationale,
  };
}

function normalizeMilestones(input: unknown): Milestone[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => {
      const record = entry as Record<string, unknown>;
      const title = typeof record.title === "string" ? record.title : "Untitled milestone";
      return {
        id: typeof record.id === "string" ? record.id : buildDeterministicId({ title, record }, "mile"),
        title,
        description: typeof record.description === "string" ? record.description : undefined,
        targetDate: typeof record.targetDate === "string" ? record.targetDate : undefined,
      };
    });
}

function normalizeFeatures(input: unknown): Feature[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => {
      const record = entry as Record<string, unknown>;
      const title = typeof record.title === "string" ? record.title : "Untitled feature";
      const dependencies = Array.isArray(record.dependencies)
        ? record.dependencies.filter((value) => typeof value === "string")
        : undefined;
      const owners = Array.isArray(record.owners)
        ? record.owners.filter((value) => typeof value === "string")
        : undefined;

      return {
        id: typeof record.id === "string" ? record.id : buildDeterministicId({ title, record }, "feat"),
        title,
        description: typeof record.description === "string" ? record.description : undefined,
        dependencies,
        owners,
      };
    });
}

function normalizeExecutionTasks(input: unknown): ExecutionTaskDef[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => {
      const record = entry as Record<string, unknown>;
      const title = typeof record.title === "string" ? record.title : "Untitled task";
      const role = typeof record.role === "string" ? record.role : "execution";
      const dependsOn = Array.isArray(record.dependsOn)
        ? record.dependsOn.filter((value) => typeof value === "string")
        : undefined;

      return {
        id: typeof record.id === "string" ? record.id : buildDeterministicId({ title, record }, "task"),
        title,
        description: typeof record.description === "string" ? record.description : undefined,
        role,
        dependsOn,
        payload: typeof record.payload === "object" && record.payload ? (record.payload as Record<string, unknown>) : undefined,
      };
    });
}

function normalizePlanSnapshot(
  plan: Omit<PlanSnapshot, "id" | "createdAt">,
  now: string,
): PlanSnapshot {
  const planId = buildDeterministicId(plan, "plan");
  const tasks = plan.tasks.map((task) => ({
    ...task,
    id: task.id || buildDeterministicId(task, "task"),
  }));

  return {
    id: planId,
    createdAt: now,
    roadmap: plan.roadmap,
    features: plan.features,
    tasks,
    rationale: plan.rationale,
  };
}

function buildExecutionTasks(plan: PlanSnapshot, now: string): AgentTask[] {
  return plan.tasks.map((task) => ({
    id: `exec-${randomUUID()}`,
    type: "execution" as const,
    status: "pending" as const,
    input: {
      task,
      planId: plan.id,
    },
    createdAt: now,
    planId: plan.id,
    definitionId: task.id,
  }));
}

function markTasksForDispatch(tasks: AgentTask[], taskIds: string[], now: string): {
  updatedTasks: AgentTask[];
  tasks: AgentTask[];
} {
  const tasksToDispatch: AgentTask[] = [];
  const updatedTasks = tasks.map((task) => {
    if (!taskIds.includes(task.id) || task.status !== "pending") {
      return task;
    }
    if (task.dispatchedAt) {
      return task;
    }

    const updatedTask = { ...task, dispatchedAt: now };
    tasksToDispatch.push(updatedTask);
    return updatedTask;
  });

  return { updatedTasks, tasks: tasksToDispatch };
}

function buildExecutionState(
  tasks: AgentTask[],
  existing?: ExecutionState,
): ExecutionState {
  const executionTasks = tasks.filter((task) => task.type === "execution");
  const taskIds = new Set(executionTasks.map((task) => task.id));
  const results = Object.fromEntries(
    Object.entries(existing?.results ?? {}).filter(([taskId]) => taskIds.has(taskId)),
  ) as Record<string, AgentResult>;
  const summary = buildExecutionSummary(executionTasks);
  const failures = buildExecutionFailures(executionTasks, results);

  return {
    results,
    summary: {
      ...summary,
    },
    failures,
  };
}

function updateExecutionState(
  execution: ExecutionState | undefined,
  tasks: AgentTask[],
  result: AgentResult,
): ExecutionState {
  const results = {
    ...(execution?.results ?? {}),
    [result.taskId]: result,
  };
  const summary = buildExecutionSummary(tasks.filter((task) => task.type === "execution"));
  const failures = buildExecutionFailures(tasks, results);
  return { results, summary, failures };
}

function pruneExecutionResults(
  execution: ExecutionState | undefined,
  taskIds: string[],
): ExecutionState | undefined {
  if (!execution) {
    return undefined;
  }

  const filteredResults = Object.fromEntries(
    Object.entries(execution.results).filter(([taskId]) => !taskIds.includes(taskId)),
  ) as Record<string, AgentResult>;
  return { ...execution, results: filteredResults };
}

function buildExecutionSummary(tasks: AgentTask[]): ExecutionSummary {
  const total = tasks.length;
  const completed = tasks.filter((task) => task.status === "completed").length;
  const failed = tasks.filter((task) => task.status === "failed").length;
  const inProgress = tasks.filter((task) => task.status === "pending" && task.dispatchedAt).length;
  return { total, completed, failed, inProgress };
}

function buildExecutionFailures(
  tasks: AgentTask[],
  results: Record<string, AgentResult>,
): ExecutionFailure[] {
  return tasks
    .filter((task) => task.type === "execution" && task.status === "failed")
    .map((task) => ({
      taskId: task.id,
      reason: results[task.id]?.error ?? "Execution failed",
    }));
}

function getFailedTaskIds(tasks: AgentTask[]): string[] {
  return tasks.filter((task) => task.type === "execution" && task.status === "failed").map((task) => task.id);
}

function createPlanApproval(plan: PlanSnapshot, now: string): ApprovalRequest {
  return {
    id: `approval-${plan.id}`,
    type: "plan",
    requestedAt: now,
    planId: plan.id,
    details: {
      planId: plan.id,
      roadmapCount: plan.roadmap.length,
      featureCount: plan.features.length,
      taskCount: plan.tasks.length,
    },
  };
}

function createExecutionApproval(
  type: ApprovalType,
  planId: string | undefined,
  tasks: AgentTask[],
  now: string,
  taskIds?: string[],
): ApprovalRequest {
  const resolvedTaskIds = taskIds ?? tasks.filter((task) => task.type === "execution").map((task) => task.id);
  return {
    id: buildDeterministicId({ type, planId, taskIds: resolvedTaskIds, at: now }, "approval"),
    type,
    requestedAt: now,
    planId,
    taskIds: resolvedTaskIds,
    details: {
      planId,
      taskCount: tasks.filter((task) => task.type === "execution").length,
    },
  };
}

function appendDiscussion(
  discussion: DiscussionEntry[],
  now: string,
  entries?: DiscussionEntryInput[] | DiscussionEntryInput,
  fallback?: DiscussionEntryInput,
): DiscussionEntry[] {
  const incoming = Array.isArray(entries) ? entries : entries ? [entries] : [];
  const normalized = incoming.map((entry) => ({
    ...entry,
    id: entry.id ?? buildDeterministicId(entry, "discussion"),
  }));
  const fallbackEntry = fallback
    ? {
      ...fallback,
      id: fallback.id ?? buildDeterministicId({ ...fallback, now }, "discussion"),
    }
    : null;
  return [...discussion, ...normalized, ...(fallbackEntry ? [fallbackEntry] : [])];
}

function normalizeDiscussion(input: unknown, now: string): DiscussionEntry[] | undefined {
  if (!input) {
    return undefined;
  }

  if (Array.isArray(input)) {
    return input
      .map((entry) => {
        if (typeof entry === "string") {
          return {
            id: buildDeterministicId({ message: entry, timestamp: now }, "discussion"),
            type: "system",
            message: entry,
            timestamp: now,
          };
        }

        if (entry && typeof entry === "object") {
          const record = entry as Record<string, unknown>;
          const type =
            record.type === "clarification" || record.type === "plan" || record.type === "execution"
              ? record.type
              : "system";
          const message = typeof record.message === "string" ? record.message : "Discussion entry";
          const timestamp = typeof record.timestamp === "string" ? record.timestamp : now;
          return {
            id: typeof record.id === "string" ? record.id : buildDeterministicId({ type, message, timestamp }, "discussion"),
            type,
            message,
            timestamp,
            metadata: typeof record.metadata === "object" ? (record.metadata as Record<string, unknown>) : undefined,
          };
        }

        return null;
      })
      .filter((entry): entry is DiscussionEntry => Boolean(entry));
  }

  return undefined;
}

function buildDeterministicId(value: unknown, prefix: string): string {
  const hash = createHash("sha256").update(stableStringify(value)).digest("hex");
  return `${prefix}-${hash.slice(0, 12)}`;
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }

  if (typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const serialized = entries
    .map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`)
    .join(",");
  return `{${serialized}}`;
}

function hasExecutionApprovalPending(approvals: ApprovalRequest[]): boolean {
  return approvals.some((approval) => approval.type === "execution_start" || approval.type === "execution_retry");
}

function rejectTransition(
  state: ProjectState,
  intent: Intent,
  message: string,
  now: string,
): StateTransitionResult {
  const discussion = appendDiscussion(state.discussion, now, {
    type: "system",
    message,
    timestamp: now,
  });
  const newState = applyTransition(state, intent, state.phase, state.phase, now, {
    discussion,
  });
  return { newState, sideEffects: [] };
}

function failTransition(
  state: ProjectState,
  intent: Intent,
  message: string,
  now: string,
): StateTransitionResult {
  const discussion = appendDiscussion(state.discussion, now, {
    type: "system",
    message,
    timestamp: now,
  });
  const newState = applyTransition(state, intent, state.phase, "error", now, {
    discussion,
  });
  return { newState, sideEffects: [] };
}
