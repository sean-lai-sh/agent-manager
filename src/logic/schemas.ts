import { z } from "zod";

export const MilestoneDraftSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1, "Milestone title is required"),
  description: z.string().optional(),
  targetDate: z.string().optional(),
});

export const FeatureDraftSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1, "Feature title is required"),
  description: z.string().optional(),
  dependencies: z.array(z.string()).optional(),
  owners: z.array(z.string()).optional(),
});

export const TaskRoleSchema = z.union([
  z.literal("frontend"),
  z.literal("backend"),
  z.literal("ai_orchestration"),
  z.literal("infrastructure"),
  z.literal("testing"),
  z.literal("documentation"),
  z.literal("design"),
  z.string(),
]);

export const TaskDraftSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1, "Task title is required"),
  description: z.string().optional(),
  role: TaskRoleSchema,
  dependsOn: z.array(z.string()).optional(),
  payload: z.record(z.unknown()).optional(),
});

export const PlanDraftSchema = z.object({
  roadmap: z.array(MilestoneDraftSchema).min(1, "At least one milestone is required"),
  features: z.array(FeatureDraftSchema).min(1, "At least one feature is required"),
  tasks: z.array(TaskDraftSchema).min(1, "At least one task is required"),
  rationale: z.string().optional(),
});

export const PlanningOutputQuestionsSchema = z.object({
  questions: z.tuple([z.string().min(1, "Question cannot be empty")]),
  plan: z.undefined().optional(),
});

export const PlanningOutputPlanSchema = z.object({
  questions: z.undefined().optional(),
  plan: PlanDraftSchema,
});

export const PlanningOutputSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("questions"), questions: z.tuple([z.string().min(1)]) }),
  z.object({ type: z.literal("plan"), plan: PlanDraftSchema }),
]).or(
  z.union([PlanningOutputQuestionsSchema, PlanningOutputPlanSchema])
);

export const RawPlanningOutputSchema = z.object({
  questions: z.array(z.string()).max(1).optional(),
  plan: PlanDraftSchema.optional(),
}).refine(
  (data) => {
    const hasQuestions = data.questions && data.questions.length > 0;
    const hasPlan = data.plan !== undefined;
    return hasQuestions !== hasPlan;
  },
  {
    message: "Output must contain either exactly one question OR a plan, not both or neither",
  }
);

export type ValidatedPlanningOutput = z.infer<typeof RawPlanningOutputSchema>;
