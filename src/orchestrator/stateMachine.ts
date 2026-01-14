import {
  AgentResult,
  AgentTask,
  AgentTaskStatus,
  ApprovalRequest,
  Intent,
  ProjectPhase,
  ProjectState,
  SideEffect,
  StateTransitionResult,
} from "./types";

export function transitionState(
  state: ProjectState,
  intent: Intent,
  now: string = new Date().toISOString(),
): StateTransitionResult {
  switch (intent.type) {
    case "create_project": {
      const baseState = createProjectState(intent.payload.projectId, intent.payload.goal, now);
      const planningTask = buildPlanningTask(intent.payload.goal, now);
      const newState = applyTransition(baseState, intent, "idle", "planning", now, {
        pendingTasks: [planningTask],
      });
      return { newState, sideEffects: [{ type: "dispatch_agent_task", task: planningTask }] };
    }
    case "add_feature": {
      const planningTask = buildPlanningTask(intent.payload.description, now);
      const newState = applyTransition(state, intent, state.phase, "planning", now, {
        pendingTasks: [...state.pendingTasks, planningTask],
      });
      return { newState, sideEffects: [{ type: "dispatch_agent_task", task: planningTask }] };
    }
    case "replan": {
      const planningTask = buildPlanningTask(intent.payload?.reason ?? "replan", now);
      const newState = applyTransition(state, intent, state.phase, "planning", now, {
        pendingTasks: [...state.pendingTasks, planningTask],
      });
      return { newState, sideEffects: [{ type: "dispatch_agent_task", task: planningTask }] };
    }
    case "approve_plan": {
      const approvals = state.approvals.filter((approval) => approval.id !== intent.payload.approvalId);
      const executionTasks = buildExecutionTasks(state.plan, now);
      const newState = applyTransition(state, intent, state.phase, "executing", now, {
        approvals,
        pendingTasks: [...state.pendingTasks, ...executionTasks],
      });
      return {
        newState,
        sideEffects: executionTasks.map((task) => ({ type: "dispatch_agent_task", task })),
      };
    }
    case "run_tasks": {
      const taskIds = intent.payload?.taskIds ?? state.pendingTasks.map((task) => task.id);
      const { updatedTasks, tasksToDispatch } = markTasksInProgress(state.pendingTasks, taskIds);
      const newState = applyTransition(state, intent, state.phase, state.phase, now, {
        pendingTasks: updatedTasks,
      });
      return {
        newState,
        sideEffects: tasksToDispatch.map((task) => ({ type: "dispatch_agent_task", task })),
      };
    }
    case "pause_execution": {
      const newState = applyTransition(state, intent, state.phase, "paused", now, {});
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

export function createProjectState(projectId: string, goal: string, now: string): ProjectState {
  return {
    projectId,
    phase: "idle",
    version: 0,
    updatedAt: now,
    goal,
    pendingTasks: [],
    approvals: [],
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

function buildPlanningTask(prompt: string, now: string): AgentTask {
  return {
    id: `plan-${Date.now()}`,
    type: "planning",
    status: "pending",
    input: { prompt },
    createdAt: now,
  };
}

function buildExecutionTasks(plan: ProjectState["plan"], now: string): AgentTask[] {
  // TODO: map structured plan into execution tasks.
  if (!plan) {
    return [];
  }

  return [
    {
      id: `exec-${Date.now()}`,
      type: "execution",
      status: "pending",
      input: { plan },
      createdAt: now,
    },
  ];
}

function markTasksInProgress(tasks: AgentTask[], taskIds: string[]): {
  updatedTasks: AgentTask[];
  tasksToDispatch: AgentTask[];
} {
  const tasksToDispatch: AgentTask[] = [];
  const updatedTasks = tasks.map((task) => {
    if (!taskIds.includes(task.id)) {
      return task;
    }

    const status: AgentTaskStatus = "in_progress";
    const updatedTask = { ...task, status };
    tasksToDispatch.push(updatedTask);
    return updatedTask;
  });

  return { updatedTasks, tasksToDispatch };
}

function handleAgentResult(
  state: ProjectState,
  result: AgentResult,
  now: string,
  intent: Intent,
): StateTransitionResult {
  const task = state.pendingTasks.find((entry) => entry.id === result.taskId);
  const updatedTasks = state.pendingTasks.map((entry) =>
    entry.id === result.taskId
      ? { ...entry, status: result.status === "success" ? "completed" : "failed" }
      : entry,
  );

  let nextPhase: ProjectPhase = state.phase;
  let plan = state.plan;
  let approvals = state.approvals;
  let execution = state.execution;
  let sideEffects: SideEffect[] = [];

  if (task?.type === "planning") {
    if (result.status === "success") {
      const approval = createApprovalRequest(result, now);
      nextPhase = "awaiting_approval";
      plan = result.output ?? {};
      approvals = [...state.approvals, approval];
      sideEffects = [{ type: "request_approval", approval }];
    } else {
      nextPhase = "error";
      execution = { planningError: result.error ?? "Planning failed" };
    }
  }

  if (task?.type === "execution") {
    const existingResults = (state.execution?.results ?? {}) as Record<string, unknown>;
    execution = {
      ...(state.execution ?? {}),
      results: {
        ...existingResults,
        [result.taskId]: result,
      },
    };
    const hasActiveExecution = updatedTasks.some(
      (entry) => entry.type === "execution" && entry.status !== "completed",
    );
    nextPhase = hasActiveExecution ? nextPhase : "completed";
  }

  const newState = applyTransition(state, intent, state.phase, nextPhase, now, {
    pendingTasks: updatedTasks,
    plan,
    approvals,
    execution,
  });

  return { newState, sideEffects };
}

function createApprovalRequest(result: AgentResult, now: string): ApprovalRequest {
  return {
    id: `approval-${result.taskId}`,
    type: "plan",
    requestedAt: now,
    details: {
      taskId: result.taskId,
      summary: result.output ?? {},
    },
  };
}
