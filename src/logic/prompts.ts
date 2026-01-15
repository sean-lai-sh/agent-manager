import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { AnsweredClarification, PlanningPromptContext, ProjectContext } from "./types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, "../resources/prompts");

function loadPromptTemplate(name: string): string {
  const path = join(PROMPTS_DIR, `${name}.txt`);
  return readFileSync(path, "utf-8");
}

const PROMPT_TEMPLATES = {
  clarification: loadPromptTemplate("clarification"),
  conversation: loadPromptTemplate("conversation"),
  planning: loadPromptTemplate("planning"),
  strictJson: loadPromptTemplate("strict_json"),
};

export type PromptMode = "checklist" | "conversation";

function formatContext(context?: ProjectContext): string {
  if (!context) {
    return "No additional context provided.";
  }

  const parts: string[] = [];

  if (context.icp) {
    parts.push(`ICP (Ideal Customer Profile): ${context.icp}`);
  }

  if (context.techStack && context.techStack.length > 0) {
    parts.push(`Tech Stack: ${context.techStack.join(", ")}`);
  }

  if (context.constraints && context.constraints.length > 0) {
    parts.push(`Constraints:\n${context.constraints.map((c) => `  - ${c}`).join("\n")}`);
  }

  if (context.coreFeatures && context.coreFeatures.length > 0) {
    parts.push(`Core Features:\n${context.coreFeatures.map((f) => `  - ${f}`).join("\n")}`);
  }

  return parts.length > 0 ? parts.join("\n\n") : "No additional context provided.";
}

function formatClarifications(clarifications: AnsweredClarification[]): string {
  if (clarifications.length === 0) {
    return "No clarifications yet.";
  }

  return clarifications
    .map((c, i) => `Q${i + 1}: ${c.question}\nA${i + 1}: ${c.answer}`)
    .join("\n\n");
}

function formatConversation(clarifications: AnsweredClarification[]): string {
  if (clarifications.length === 0) {
    return "This is the start of the conversation.";
  }

  return clarifications
    .map((c) => `Assistant: ${c.question}\nUser: ${c.answer}`)
    .join("\n\n");
}

function applyTemplateVariables(
  template: string,
  variables: Record<string, string>
): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`{{${key}}}`, "g"), value);
  }
  return result;
}

export function buildClarificationPrompt(
  promptContext: PlanningPromptContext,
  mode: PromptMode = "checklist"
): string {
  const { goal, context, answeredClarifications, note } = promptContext;

  if (mode === "conversation") {
    return buildConversationPrompt(promptContext);
  }

  return applyTemplateVariables(PROMPT_TEMPLATES.clarification, {
    goal: goal ?? "No goal specified yet.",
    context: formatContext(context),
    clarifications: formatClarifications(answeredClarifications),
    note: note ? `<additional_note>\n${note}\n</additional_note>` : "",
  });
}

export function buildConversationPrompt(promptContext: PlanningPromptContext): string {
  const { goal, context, answeredClarifications, note } = promptContext;

  return applyTemplateVariables(PROMPT_TEMPLATES.conversation, {
    goal: goal ?? "No goal specified yet.",
    context: formatContext(context),
    conversation: formatConversation(answeredClarifications),
    note: note ? `<additional_note>\n${note}\n</additional_note>` : "",
  });
}

export function buildPlanningPrompt(promptContext: PlanningPromptContext): string {
  const { goal, context, answeredClarifications, note } = promptContext;

  return applyTemplateVariables(PROMPT_TEMPLATES.planning, {
    goal: goal ?? "No goal specified yet.",
    context: formatContext(context),
    clarifications: formatClarifications(answeredClarifications),
    note: note ? `## Additional Note\n${note}\n` : "",
  });
}

export function buildStrictJsonPrompt(originalPrompt: string): string {
  return `${originalPrompt}\n\n${PROMPT_TEMPLATES.strictJson}`;
}

export const PROMPT_BUILDERS = {
  clarification: buildClarificationPrompt,
  conversation: buildConversationPrompt,
  planning: buildPlanningPrompt,
  strictJson: buildStrictJsonPrompt,
};
