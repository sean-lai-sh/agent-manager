import type { PlanningInput, PlanningPromptContext, ProjectContext, AnsweredClarification } from "./types";

export interface ReadinessResult {
  ready: boolean;
  missingFields: string[];
  coverage: {
    goal: boolean;
    icp: boolean;
    techStack: boolean;
    constraints: boolean;
    coreFeatures: boolean;
  };
}

function hasNonEmptyArray(arr: unknown[] | undefined): boolean {
  return Array.isArray(arr) && arr.length > 0;
}

function hasNonEmptyString(str: string | undefined): boolean {
  return typeof str === "string" && str.trim().length > 0;
}

function checkContextCoverage(context?: ProjectContext): {
  icp: boolean;
  techStack: boolean;
  constraints: boolean;
  coreFeatures: boolean;
} {
  return {
    icp: hasNonEmptyString(context?.icp),
    techStack: hasNonEmptyArray(context?.techStack),
    constraints: hasNonEmptyArray(context?.constraints),
    coreFeatures: hasNonEmptyArray(context?.coreFeatures),
  };
}

export function extractAnsweredClarifications(
  clarifications: PlanningInput["clarifications"]
): AnsweredClarification[] {
  const answered: AnsweredClarification[] = [];

  for (const record of clarifications) {
    if (record.status === "answered" || record.status === "resolved") {
      for (let i = 0; i < record.questions.length; i++) {
        const question = record.questions[i];
        const answer = record.answers[i];
        if (question && answer) {
          answered.push({ question, answer });
        }
      }
    }
  }

  return answered;
}

export function checkReadiness(input: PlanningInput): ReadinessResult {
  const missingFields: string[] = [];
  const goalPresent = hasNonEmptyString(input.goal);
  const contextCoverage = checkContextCoverage(input.context);

  if (!goalPresent) {
    missingFields.push("goal");
  }

  const answeredClarifications = extractAnsweredClarifications(input.clarifications);

  const icpPresent = contextCoverage.icp || hasAnswerForTopic(answeredClarifications, ["icp", "customer", "user", "audience", "target"]);
  const techStackPresent = contextCoverage.techStack || hasAnswerForTopic(answeredClarifications, ["tech", "stack", "technology", "framework", "language"]);
  const constraintsPresent = contextCoverage.constraints || hasAnswerForTopic(answeredClarifications, ["constraint", "limit", "budget", "timeline", "deadline"]);
  const coreFeaturesPresent = contextCoverage.coreFeatures || hasAnswerForTopic(answeredClarifications, ["feature", "functionality", "requirement", "must-have", "core"]);

  if (!icpPresent) missingFields.push("icp");
  if (!techStackPresent) missingFields.push("techStack");
  if (!constraintsPresent) missingFields.push("constraints");
  if (!coreFeaturesPresent) missingFields.push("coreFeatures");

  const coverage = {
    goal: goalPresent,
    icp: icpPresent,
    techStack: techStackPresent,
    constraints: constraintsPresent,
    coreFeatures: coreFeaturesPresent,
  };

  const ready = missingFields.length === 0;

  return {
    ready,
    missingFields,
    coverage,
  };
}

function hasAnswerForTopic(clarifications: AnsweredClarification[], keywords: string[]): boolean {
  const lowerKeywords = keywords.map((k) => k.toLowerCase());

  for (const { question, answer } of clarifications) {
    const lowerQuestion = question.toLowerCase();
    const lowerAnswer = answer.toLowerCase();

    for (const keyword of lowerKeywords) {
      if (lowerQuestion.includes(keyword) || lowerAnswer.includes(keyword)) {
        if (answer.trim().length > 0) {
          return true;
        }
      }
    }
  }

  return false;
}

export function isReadyToPlan(input: PlanningInput): boolean {
  if (input.stage === "final") {
    return true;
  }

  const { ready } = checkReadiness(input);
  return ready;
}

export function buildPromptContext(input: PlanningInput): PlanningPromptContext {
  return {
    goal: input.goal,
    context: input.context,
    answeredClarifications: extractAnsweredClarifications(input.clarifications),
    stage: input.stage,
    note: input.note,
  };
}
