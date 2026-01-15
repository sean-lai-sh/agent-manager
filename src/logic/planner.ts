import type { PlanningInput, PlanningOutput, PlanningPromptContext, PlanDraft } from "./types";
import { RawPlanningOutputSchema } from "./schemas";
import { buildClarificationPrompt, buildPlanningPrompt, buildStrictJsonPrompt, type PromptMode } from "./prompts";
import { isReadyToPlan, buildPromptContext } from "./decision";
import type { LlmAdapter } from "./adapters";

export interface PlanningOptions {
  mode?: PromptMode;
}

export interface ParsedOutput {
  success: true;
  output: PlanningOutput;
}

export interface ParseError {
  success: false;
  error: string;
  raw?: unknown;
}

export type ParseResult = ParsedOutput | ParseError;

function extractJsonFromResponse(raw: string): unknown {
  const trimmed = raw.trim();

  if (trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // Continue to other extraction methods
    }
  }

  const jsonMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch?.[1]) {
    try {
      return JSON.parse(jsonMatch[1].trim());
    } catch {
      // Continue to other extraction methods
    }
  }

  const objectMatch = trimmed.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    try {
      return JSON.parse(objectMatch[0]);
    } catch {
      // Fall through to error
    }
  }

  throw new Error("No valid JSON object found in response");
}

export function parsePlanningOutput(raw: unknown): ParseResult {
  try {
    let parsed: unknown;

    if (typeof raw === "string") {
      parsed = extractJsonFromResponse(raw);
    } else {
      parsed = raw;
    }

    const validated = RawPlanningOutputSchema.parse(parsed);

    if (validated.questions && validated.questions.length === 1) {
      return {
        success: true,
        output: { questions: [validated.questions[0]] },
      };
    }

    if (validated.plan) {
      return {
        success: true,
        output: { plan: validated.plan as PlanDraft },
      };
    }

    return {
      success: false,
      error: "Output contains neither valid questions nor a valid plan",
      raw: parsed,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: `Validation failed: ${message}`,
      raw,
    };
  }
}

export function getPromptForInput(input: PlanningInput, options: PlanningOptions = {}): string {
  const promptContext = buildPromptContext(input);
  const mode = options.mode ?? "conversation";

  if (isReadyToPlan(input)) {
    return buildPlanningPrompt(promptContext);
  }

  return buildClarificationPrompt(promptContext, mode);
}

export interface PlanningLogicResult {
  success: true;
  output: PlanningOutput;
  retried: boolean;
}

export interface PlanningLogicError {
  success: false;
  error: string;
  retried: boolean;
}

export type RunPlanningResult = PlanningLogicResult | PlanningLogicError;

export async function runPlanningLogic(
  input: PlanningInput,
  adapter: LlmAdapter,
  options: PlanningOptions = {}
): Promise<RunPlanningResult> {
  const prompt = getPromptForInput(input, options);

  const firstResponse = await adapter.completeJson(prompt);
  const firstParse = parsePlanningOutput(firstResponse);

  if (firstParse.success) {
    return {
      success: true,
      output: firstParse.output,
      retried: false,
    };
  }

  const strictPrompt = buildStrictJsonPrompt(prompt);
  const retryResponse = await adapter.completeJson(strictPrompt);
  const retryParse = parsePlanningOutput(retryResponse);

  if (retryParse.success) {
    return {
      success: true,
      output: retryParse.output,
      retried: true,
    };
  }

  return {
    success: false,
    error: retryParse.error,
    retried: true,
  };
}

export { buildPromptContext, isReadyToPlan };
