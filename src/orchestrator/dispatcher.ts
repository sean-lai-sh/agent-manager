import {
  AgentTask,
  ApprovalRequest,
  Intent,
  ProjectState,
  SideEffect,
  SideEffectHandler,
  StateTransitionResult,
} from "./types";
import { transitionState } from "./stateMachine";

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

  async dispatch(state: ProjectState, intent: Intent): Promise<StateTransitionResult> {
    const result = this.transition(state, intent);
    for (const effect of result.sideEffects) {
      await this.handleSideEffect(effect);
    }
    return result;
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

export class DefaultSideEffectHandler implements SideEffectHandler {
  async dispatchAgentTask(task: AgentTask): Promise<void> {
    // TODO: integrate planning/execution agent adapters.
    throw new Error(`Agent dispatch not implemented for ${task.type}`);
  }

  async requestApproval(approval: ApprovalRequest): Promise<void> {
    // TODO: wire approval requests to the TUI layer.
    throw new Error(`Approval hook not implemented for ${approval.id}`);
  }
}
