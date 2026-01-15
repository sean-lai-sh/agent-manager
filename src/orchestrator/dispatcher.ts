import {
  AgentTask,
  AgentResult,
  ApprovalRequest,
  Intent,
  ProjectState,
  SideEffect,
  SideEffectHandler,
  StateTransitionResult,
} from "./types";
import { transitionState } from "./stateMachine";
import {
  ExecutionAdapter,
  createOpenCodeAdapter,
} from "../implementation/adapters";
import type { ExecutionAdapterConfig } from "../implementation/types";
import { runTask, isExecutableTask } from "../implementation/runner";

export type TransitionHandler = (
  state: ProjectState,
  intent: Intent,
  now?: string,
) => StateTransitionResult;

export class IntentDispatcher {
  private readonly transition: TransitionHandler;
  private readonly sideEffects: SideEffectHandler;

  constructor(options: { transition?: TransitionHandler; sideEffects: SideEffectHandler }) {
    this.transition = options.transition ?? transitionState;
    this.sideEffects = options.sideEffects;
  }

  computeTransition(state: ProjectState, intent: Intent): StateTransitionResult {
    return this.transition(state, intent);
  }

  async executeSideEffects(sideEffects: SideEffect[]): Promise<void> {
    for (const effect of sideEffects) {
      await this.handleSideEffect(effect);
    }
  }

  private async handleSideEffect(effect: SideEffect): Promise<void> {
    switch (effect.type) {
      case "dispatch_agent_task":
        await this.sideEffects.dispatchAgentTask(effect.task);
        return;
      case "request_approval":
        await this.sideEffects.requestApproval(effect.approval);
        return;
      default:
        return;
    }
  }
}

export interface DefaultSideEffectHandlerOptions {
  adapterConfig?: ExecutionAdapterConfig;
  adapter?: ExecutionAdapter;
  onResult?: (result: AgentResult) => void | Promise<void>;
  onApproval?: (approval: ApprovalRequest) => void | Promise<void>;
}

export class DefaultSideEffectHandler implements SideEffectHandler {
  private readonly adapter: ExecutionAdapter;
  private readonly onResult?: (result: AgentResult) => void | Promise<void>;
  private readonly onApproval?: (approval: ApprovalRequest) => void | Promise<void>;

  constructor(options: DefaultSideEffectHandlerOptions = {}) {
    this.adapter = options.adapter ?? createOpenCodeAdapter(options.adapterConfig);
    this.onResult = options.onResult;
    this.onApproval = options.onApproval;
  }

  async dispatchAgentTask(task: AgentTask): Promise<void> {
    if (!isExecutableTask(task)) {
      throw new Error(`Unsupported task type: ${task.type}`);
    }

    const result = await runTask(task, this.adapter);

    if (this.onResult) {
      await this.onResult(result);
    }
  }

  async requestApproval(approval: ApprovalRequest): Promise<void> {
    if (this.onApproval) {
      await this.onApproval(approval);
      return;
    }
    // Default behavior: log the approval request (TUI will handle this)
    console.log(`Approval requested: ${approval.type} (${approval.id})`);
  }
}
