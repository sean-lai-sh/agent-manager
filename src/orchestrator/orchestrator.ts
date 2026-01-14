import { IntentDispatcher } from "./dispatcher";
import { createProjectState } from "./stateMachine";
import { Intent, ProjectState, StateStore, StateTransitionResult } from "./types";

export interface OrchestratorOptions {
  store: StateStore;
  dispatcher: IntentDispatcher;
}

export class Orchestrator {
  private readonly store: StateStore;
  private readonly dispatcher: IntentDispatcher;
  private state: ProjectState | null = null;

  constructor(options: OrchestratorOptions) {
    this.store = options.store;
    this.dispatcher = options.dispatcher;
  }

  async initialize(): Promise<ProjectState | null> {
    this.state = await this.store.load();
    return this.state;
  }

  getState(): ProjectState | null {
    return this.state;
  }

  async handleIntent(intent: Intent): Promise<StateTransitionResult> {
    const currentState = this.state ?? this.bootstrapState(intent);
    const result = await this.dispatcher.dispatch(currentState, intent);
    this.state = result.newState;
    await this.store.save(this.state);
    return result;
  }

  private bootstrapState(intent: Intent): ProjectState {
    if (intent.type !== "create_project") {
      throw new Error("No project state loaded. Initialize or create a project first.");
    }

    const now = new Date().toISOString();
    return createProjectState(intent.payload.projectId, intent.payload.goal, now);
  }
}
