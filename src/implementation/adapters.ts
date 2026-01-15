import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk";
import type { ExecutionInput, ExecutionOutput, ExecutionAdapterConfig } from "./types";

/**
 * Interface for execution adapters.
 * Adapters are thin wrappers around execution backends and must not contain
 * any decision-making or planning logic.
 */
export interface ExecutionAdapter {
  /**
   * Execute a task and return the result.
   * @param input - The execution input containing task details.
   * @returns Promise resolving to the execution output.
   */
  execute(input: ExecutionInput): Promise<ExecutionOutput>;
}

/**
 * Error thrown when the adapter fails to connect to the execution backend.
 */
export class AdapterConnectionError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AdapterConnectionError";
  }
}

/**
 * Error thrown when the execution backend returns an error.
 */
export class AdapterExecutionError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AdapterExecutionError";
  }
}

/**
 * Determines if an error is a transient network error that may be retried.
 */
function isTransientNetworkError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes("econnrefused") ||
      message.includes("econnreset") ||
      message.includes("etimedout") ||
      message.includes("socket hang up") ||
      message.includes("network") ||
      message.includes("timeout")
    );
  }
  return false;
}

/**
 * Default configuration for the OpenCode adapter.
 */
const DEFAULT_CONFIG: Required<ExecutionAdapterConfig> = {
  serverUrl: "http://localhost:3000",
  model: "gpt-5.2-codex",
  reasoningEffort: "high",
  timeoutMs: 120000,
};

/**
 * OpenCode SDK adapter for executing tasks via the OpenCode server.
 * This adapter is a thin wrapper that handles communication with the OpenCode
 * server. It does not contain any business or planning logic.
 */
export class OpenCodeAdapter implements ExecutionAdapter {
  private readonly config: Required<ExecutionAdapterConfig>;
  private readonly maxRetries = 1;

  constructor(config: ExecutionAdapterConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async execute(input: ExecutionInput): Promise<ExecutionOutput> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.executeOnce(input);
      } catch (error) {
        lastError = error;

        // Only retry on transient network errors
        if (!isTransientNetworkError(error) || attempt === this.maxRetries) {
          break;
        }
      }
    }

    // Return failure result with error message
    return this.createFailureOutput(input.taskId, lastError);
  }

  private async executeOnce(input: ExecutionInput): Promise<ExecutionOutput> {
    const client = createOpencodeClient({
      baseUrl: this.config.serverUrl,
    });

    // Create a session for this task
    let sessionId: string;
    try {
      const sessionResult = await client.session.create({
        body: {},
      });

      if (!sessionResult.data) {
        throw new AdapterConnectionError(
          `Failed to create session: ${JSON.stringify(sessionResult.error ?? "Unknown error")}`,
        );
      }
      sessionId = sessionResult.data.id;
    } catch (error) {
      if (isTransientNetworkError(error)) {
        throw error;
      }
      if (error instanceof AdapterConnectionError) {
        throw error;
      }
      throw new AdapterConnectionError(
        `Failed to create session: ${error instanceof Error ? error.message : String(error)}`,
        error,
      );
    }

    // Build the task prompt
    const taskPrompt = JSON.stringify({
      task_id: input.taskId,
      inputs: input.inputs,
      constraints: input.constraints,
      expected_outputs: input.expectedOutputs,
    });

    // Send the prompt to the session
    try {
      await client.session.prompt({
        path: { id: sessionId },
        body: {
          model: {
            providerID: "openai",
            modelID: this.config.model,
          },
          parts: [
            {
              type: "text" as const,
              text: taskPrompt,
            },
          ],
        },
      });
    } catch (error) {
      if (isTransientNetworkError(error)) {
        throw error;
      }
      throw new AdapterExecutionError(
        `OpenCode server failed to process request: ${error instanceof Error ? error.message : String(error)}`,
        error,
      );
    }

    // Get the messages from the session to retrieve the response
    let messagesData: unknown;
    try {
      const messagesResult = await client.session.messages({
        path: { id: sessionId },
      });
      messagesData = messagesResult.data;
    } catch (error) {
      throw new AdapterExecutionError(
        `Failed to retrieve session messages: ${error instanceof Error ? error.message : String(error)}`,
        error,
      );
    }

    return this.parseResponse(input.taskId, messagesData);
  }

  private parseResponse(taskId: string, messages: unknown): ExecutionOutput {
    // Extract the model's response content
    const content = this.extractContent(messages);

    if (!content) {
      return {
        taskId,
        status: "failure",
        error: "Empty response from model",
        logs: ["Model returned no content"],
      };
    }

    // Attempt to parse as JSON
    try {
      const parsed = JSON.parse(content);
      return {
        taskId,
        status: parsed.status === "success" ? "success" : "failure",
        artifacts: parsed.artifacts,
        logs: parsed.logs,
        error: parsed.error,
      };
    } catch {
      // If not JSON, treat as plain text success response
      return {
        taskId,
        status: "success",
        artifacts: [content],
        logs: ["Raw text response from model"],
      };
    }
  }

  private extractContent(messages: unknown): string | null {
    if (!messages || !Array.isArray(messages)) {
      return null;
    }

    // Find the last assistant message
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i] as Record<string, unknown>;
      if (msg.role === "assistant" && Array.isArray(msg.parts)) {
        for (const part of msg.parts as Array<Record<string, unknown>>) {
          if (part.type === "text" && typeof part.text === "string") {
            return part.text;
          }
        }
      }
    }

    return null;
  }

  private createFailureOutput(taskId: string, error: unknown): ExecutionOutput {
    let errorMessage: string;

    if (error instanceof AdapterConnectionError) {
      errorMessage = `Connection error: ${error.message}`;
    } else if (error instanceof AdapterExecutionError) {
      errorMessage = `Execution error: ${error.message}`;
    } else if (error instanceof Error) {
      errorMessage = `Unexpected error: ${error.message}`;
    } else {
      errorMessage = `Unknown error: ${String(error)}`;
    }

    return {
      taskId,
      status: "failure",
      error: errorMessage,
      logs: [`Failed after ${this.maxRetries + 1} attempt(s)`],
    };
  }
}

/**
 * Creates an OpenCode adapter with the given configuration.
 */
export function createOpenCodeAdapter(config?: ExecutionAdapterConfig): ExecutionAdapter {
  return new OpenCodeAdapter(config);
}
