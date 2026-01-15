import type { AgentTask, AgentResult, AgentTaskType } from "../orchestrator/types";

/**
 * Execution-specific input format for the implementation layer.
 * Maps from the orchestrator's AgentTask.input to execution parameters.
 */
export interface ExecutionInput {
  taskId: string;
  inputs: Record<string, unknown>;
  constraints?: Record<string, unknown>;
  expectedOutputs?: string[];
}

/**
 * Execution-specific output format for the implementation layer.
 * Maps to the orchestrator's AgentResult format.
 */
export interface ExecutionOutput {
  taskId: string;
  status: "success" | "failure";
  artifacts?: unknown[];
  logs?: string[];
  error?: string;
}

/**
 * Configuration for the execution adapter.
 */
export interface ExecutionAdapterConfig {
  serverUrl?: string;
  model?: string;
  reasoningEffort?: "low" | "medium" | "high";
  timeoutMs?: number;
}

/**
 * Converts an AgentTask to ExecutionInput format.
 */
export function toExecutionInput(task: AgentTask): ExecutionInput {
  return {
    taskId: task.id,
    inputs: task.input,
    constraints: task.input.constraints as Record<string, unknown> | undefined,
    expectedOutputs: task.input.expectedOutputs as string[] | undefined,
  };
}

/**
 * Converts an ExecutionOutput to AgentResult format.
 */
export function toAgentResult(output: ExecutionOutput, completedAt: string): AgentResult {
  return {
    taskId: output.taskId,
    status: output.status,
    output: output.status === "success" ? { artifacts: output.artifacts, logs: output.logs } : undefined,
    error: output.error,
    completedAt,
  };
}

export type { AgentTask, AgentResult, AgentTaskType };
