import type { AgentTask, AgentResult } from "../orchestrator/types";
import type { ExecutionAdapter } from "./adapters";
import { toExecutionInput, toAgentResult } from "./types";

/**
 * Runs an agent task using the provided execution adapter.
 * This function performs execution only - no planning or decision-making logic.
 *
 * @param task - The agent task to execute.
 * @param adapter - The execution adapter to use.
 * @returns Promise resolving to the agent result.
 */
export async function runTask(task: AgentTask, adapter: ExecutionAdapter): Promise<AgentResult> {
  // Convert AgentTask to ExecutionInput format
  const input = toExecutionInput(task);

  // Execute via the adapter (adapter handles retries internally)
  const output = await adapter.execute(input);

  // Convert ExecutionOutput to AgentResult format
  const completedAt = new Date().toISOString();
  return toAgentResult(output, completedAt);
}

/**
 * Validates that a task is eligible for execution.
 * Planning and execution tasks are supported; other types are rejected.
 *
 * @param task - The task to validate.
 * @returns true if the task type is supported.
 */
export function isExecutableTask(task: AgentTask): boolean {
  return task.type === "planning" || task.type === "execution";
}
