import type { ProjectState } from "../orchestrator/types";

export type ActivityKind = "dispatch" | "result" | "log" | "system";

export type ActivityStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed"
  | "success"
  | "failure";

export interface ActivityEvent {
  id: string;
  kind: ActivityKind;
  message: string;
  timestamp: string;
  status?: ActivityStatus;
}

export interface RenderOptions {
  width?: number;
  height?: number;
  intentDraft?: string;
  intentHints?: string[];
  eventStream?: ActivityEvent[];
  showTimestamps?: boolean;
}

const ansi = {
  reset: "\u001b[0m",
  bold: "\u001b[1m",
};

const color = (code: number) => `\u001b[38;5;${code}m`;

const theme = {
  border: color(81),
  primary: color(81),
  accent: color(214),
  neutral: color(250),
  dim: color(244),
  bright: color(15),
  reset: ansi.reset,
  bold: ansi.bold,
};

const ansiRegex = /\u001b\[[0-9;]*m/g;

const stripAnsi = (value: string) => value.replace(ansiRegex, "");

const visibleLength = (value: string) => stripAnsi(value).length;

const clipPlain = (text: string, width: number) => {
  if (width <= 0) {
    return "";
  }
  if (text.length <= width) {
    return text;
  }
  if (width === 1) {
    return "…";
  }
  return `${text.slice(0, width - 1)}…`;
};

const clipAnsi = (value: string, width: number) => {
  if (width <= 0) {
    return "";
  }
  if (visibleLength(value) <= width) {
    return value;
  }
  if (width === 1) {
    return "…";
  }
  const target = width - 1;
  let visible = 0;
  let result = "";
  for (let index = 0; index < value.length && visible < target; index += 1) {
    const char = value[index];
    if (char === "\u001b") {
      const match = /\u001b\[[0-9;]*m/.exec(value.slice(index));
      if (match) {
        result += match[0];
        index += match[0].length - 1;
        continue;
      }
    }
    result += char;
    visible += 1;
  }
  return `${result}…`;
};

const padAnsi = (value: string, width: number) => {
  const clipped = clipAnsi(value, width);
  const padding = Math.max(width - visibleLength(clipped), 0);
  return `${clipped}${" ".repeat(padding)}${theme.reset}`;
};

const titleCase = (value: string) =>
  value
    .split(" ")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");

const formatPhase = (phase: ProjectState["phase"]) => {
  const label = titleCase(phase.replace(/_/g, " "));
  const waiting = phase.startsWith("awaiting");
  const indicator = waiting ? "⠿" : phase === "executing" ? "◍" : "●";
  const colorTone = waiting || phase === "error" ? theme.accent : theme.primary;
  return { text: `${indicator} ${label}`, color: colorTone };
};

const formatTimestamp = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "--:--";
  }
  return parsed.toISOString().slice(11, 16);
};

const sectionTitle = (label: string) =>
  `${theme.primary}${theme.bold}▌ ${label.toUpperCase()}${theme.reset}`;

const divider = (width: number) =>
  `${theme.dim}${"┄".repeat(Math.max(width, 0))}${theme.reset}`;

const renderKeyValue = (
  label: string,
  value: string,
  width: number,
  valueColor = theme.neutral,
) => {
  const labelText = `${label}: `;
  const available = Math.max(width - labelText.length, 0);
  const clippedValue = clipPlain(value, available);
  return clipAnsi(
    `${theme.dim}${labelText}${theme.reset}${valueColor}${clippedValue}${theme.reset}`,
    width,
  );
};

const renderPlain = (text: string, width: number, colorTone = theme.neutral) =>
  clipAnsi(`${colorTone}${text}${theme.reset}`, width);

const renderList = (items: string[] | undefined, width: number) => {
  if (!items || items.length === 0) {
    return "—";
  }
  return clipPlain(items.join(" · "), width);
};

const buildLeftColumn = (state: ProjectState, width: number) => {
  const lines: string[] = [];
  const phase = formatPhase(state.phase);
  lines.push(sectionTitle("Project State"));
  lines.push(renderKeyValue("Phase", phase.text, width, phase.color));
  lines.push(renderKeyValue("Version", `v${state.version}`, width));
  lines.push(renderKeyValue("Updated", formatTimestamp(state.updatedAt), width));
  lines.push(divider(width));
  lines.push(sectionTitle("Goal"));
  lines.push(renderPlain(state.goal ?? "—", width));
  lines.push(divider(width));
  lines.push(sectionTitle("Context"));
  if (!state.context) {
    lines.push(renderPlain("No context loaded.", width, theme.dim));
  } else {
    lines.push(renderKeyValue("ICP", state.context.icp ?? "—", width));
    lines.push(
      renderKeyValue(
        "Stack",
        renderList(state.context.techStack, width - 7),
        width,
      ),
    );
    lines.push(
      renderKeyValue(
        "Limits",
        renderList(state.context.constraints, width - 8),
        width,
      ),
    );
    lines.push(
      renderKeyValue(
        "Core",
        renderList(state.context.coreFeatures, width - 6),
        width,
      ),
    );
  }
  lines.push(divider(width));
  lines.push(sectionTitle("Plan Summary"));
  const plan = state.currentPlanId ? state.plans[state.currentPlanId] : undefined;
  if (!plan) {
    lines.push(renderPlain("No plan snapshot.", width, theme.dim));
  } else {
    lines.push(renderKeyValue("Plan", plan.id, width));
    lines.push(renderKeyValue("Roadmap", `${plan.roadmap.length} milestones`, width));
    lines.push(renderKeyValue("Features", `${plan.features.length} items`, width));
    lines.push(renderKeyValue("Tasks", `${plan.tasks.length} defs`, width));
    if (plan.rationale) {
      lines.push(
        renderKeyValue("Rationale", clipPlain(plan.rationale, width - 10), width),
      );
    }
  }
  return lines;
};

const iconForEvent = (event: ActivityEvent) => {
  if (event.kind === "result") {
    return event.status === "failure" || event.status === "failed" ? "✕" : "✓";
  }
  if (event.kind === "dispatch") {
    return "⇢";
  }
  if (event.kind === "system") {
    return "◆";
  }
  return "•";
};

const colorForEvent = (event: ActivityEvent) => {
  if (event.status === "failure" || event.status === "failed") {
    return theme.accent;
  }
  if (event.status === "success" || event.status === "completed") {
    return theme.primary;
  }
  if (event.status === "in_progress") {
    return theme.primary;
  }
  return theme.neutral;
};

const renderEventLine = (
  event: ActivityEvent,
  width: number,
  showTimestamps: boolean,
) => {
  const time = showTimestamps ? `${formatTimestamp(event.timestamp)} ` : "";
  const icon = iconForEvent(event);
  const iconColor = colorForEvent(event);
  const prefix = `${theme.dim}${time}${theme.reset}${iconColor}${icon}${theme.reset} `;
  const available = Math.max(width - visibleLength(prefix), 0);
  const message = clipPlain(event.message, available);
  return clipAnsi(
    `${theme.dim}${time}${theme.reset}${iconColor}${icon}${theme.reset} ${theme.neutral}${message}${theme.reset}`,
    width,
  );
};

const buildActivityStream = (state: ProjectState): ActivityEvent[] => {
  const events: ActivityEvent[] = [];
  for (const task of state.pendingTasks) {
    events.push({
      id: `task:${task.id}`,
      kind: "dispatch",
      message: `${titleCase(task.type)} task ${task.id} · ${task.status.replace("_", " ")}`,
      timestamp: task.dispatchedAt ?? task.createdAt,
      status: task.status,
    });
  }
  if (state.execution) {
    for (const result of Object.values(state.execution.results)) {
      const message = result.error
        ? `Result ${result.taskId} · ${result.status} · ${clipPlain(result.error, 48)}`
        : `Result ${result.taskId} · ${result.status}`;
      events.push({
        id: `result:${result.taskId}`,
        kind: "result",
        message,
        timestamp: result.completedAt,
        status: result.status,
      });
    }
  }
  for (const entry of state.discussion.slice(-12)) {
    events.push({
      id: `log:${entry.id}`,
      kind: "log",
      message: `${titleCase(entry.type)} · ${entry.message}`,
      timestamp: entry.timestamp,
    });
  }
  return events.sort(
    (left, right) =>
      toTimestamp(right.timestamp) - toTimestamp(left.timestamp),
  );
};

const buildCenterColumn = (
  state: ProjectState,
  width: number,
  options: RenderOptions,
) => {
  const lines: string[] = [];
  const waiting = state.phase.startsWith("awaiting");
  lines.push(sectionTitle("Agent Activity"));
  if (waiting) {
    lines.push(renderPlain("░▒▓ waiting on input ▓▒░", width, theme.accent));
  } else {
    lines.push(renderKeyValue("Queue", `${state.pendingTasks.length} tasks`, width));
  }
  if (state.execution?.summary) {
    lines.push(
      renderKeyValue(
        "Progress",
        `${state.execution.summary.completed}/${state.execution.summary.total} done`,
        width,
      ),
    );
  }
  lines.push(divider(width));
  const feed = options.eventStream ?? buildActivityStream(state);
  if (feed.length === 0) {
    lines.push(renderPlain("No activity yet.", width, theme.dim));
    return lines;
  }
  const maxItems = Math.max(options.height ?? 12, 6);
  const items = feed.slice(0, maxItems);
  for (const event of items) {
    lines.push(renderEventLine(event, width, options.showTimestamps !== false));
  }
  return lines;
};

const buildRightColumn = (state: ProjectState, width: number) => {
  const lines: string[] = [];
  const openClarifications = state.clarifications.filter(
    (clarification) => clarification.status !== "resolved",
  );
  lines.push(sectionTitle("Clarifications"));
  if (openClarifications.length === 0) {
    lines.push(renderPlain("No open clarifications.", width, theme.dim));
  } else {
    openClarifications.slice(0, 2).forEach((clarification) => {
      const question = clarification.questions[0] ?? "Clarification pending";
      lines.push(renderPlain(`? ${question}`, width));
      if (clarification.questions.length > 1) {
        lines.push(
          renderPlain(
            `+${clarification.questions.length - 1} more queued`,
            width,
            theme.dim,
          ),
        );
      }
    });
  }
  lines.push(divider(width));
  lines.push(sectionTitle("Approvals"));
  if (state.approvals.length === 0) {
    lines.push(renderPlain("No approvals queued.", width, theme.dim));
  } else {
    state.approvals.slice(0, 2).forEach((approval) => {
      lines.push(
        renderPlain(
          `↳ ${titleCase(approval.type.replace(/_/g, " "))}`,
          width,
        ),
      );
    });
    if (state.approvals.length > 2) {
      lines.push(
        renderPlain(`+${state.approvals.length - 2} more`, width, theme.dim),
      );
    }
  }
  lines.push(divider(width));
  lines.push(sectionTitle("Next Action"));
  lines.push(renderPlain(deriveNextAction(state), width, theme.accent));
  return lines;
};

const deriveNextAction = (state: ProjectState) => {
  if (state.approvals.length > 0) {
    const approval = state.approvals[0];
    return `Approve ${titleCase(approval.type.replace(/_/g, " "))}`;
  }
  const clarification = state.clarifications.find(
    (item) => item.status === "open",
  );
  if (clarification) {
    return "Answer clarification";
  }
  switch (state.phase) {
    case "idle":
      return "Create a project";
    case "planning":
      return "Awaiting plan draft";
    case "awaiting_clarification":
      return "Provide clarification";
    case "awaiting_approval":
      return "Review and approve plan";
    case "awaiting_execution_approval":
      return "Approve execution start";
    case "executing":
      return "Monitor agent runs";
    case "paused":
      return "Resume execution";
    case "completed":
      return "Capture follow-up scope";
    case "error":
      return "Review failure details";
    default:
      return "Stand by";
  }
};

const defaultIntentHints = (state: ProjectState) => {
  switch (state.phase) {
    case "idle":
      return ["create_project"];
    case "awaiting_clarification":
      return ["answer_clarifications", "finalize_scope"];
    case "awaiting_approval":
      return ["approve_plan", "replan"];
    case "awaiting_execution_approval":
      return ["approve_execution"];
    case "executing":
      return ["pause_execution", "run_tasks"];
    case "paused":
      return ["run_tasks", "retry_tasks"];
    case "completed":
      return ["add_feature", "replan"];
    case "planning":
      return ["request_clarifications", "replan"];
    case "error":
      return ["retry_tasks", "replan"];
    default:
      return [];
  }
};

const renderInputBar = (
  state: ProjectState,
  totalWidth: number,
  options: RenderOptions,
) => {
  const draft = options.intentDraft?.trim();
  const intent = draft && draft.length > 0 ? draft : "type intent…";
  const hints = options.intentHints ?? defaultIntentHints(state);
  const hintText = hints.length > 0 ? hints.join(" • ") : "no suggestions";
  const content = `${theme.dim}Intent:${theme.reset} ${theme.bold}${theme.primary}${intent}${theme.reset}`;
  const hint = `${theme.dim}Hints:${theme.reset} ${theme.neutral}${hintText}${theme.reset}`;
  const combined = `${content} ${theme.dim}│${theme.reset} ${hint}`;
  const top = `${theme.border}╭${"─".repeat(totalWidth - 2)}╮${theme.reset}`;
  const line = `${theme.border}│${theme.reset} ${padAnsi(combined, totalWidth - 4)} ${theme.border}│${theme.reset}`;
  const bottom = `${theme.border}╰${"─".repeat(totalWidth - 2)}╯${theme.reset}`;
  return [top, line, bottom];
};

const renderBanner = (totalWidth: number) => {
  const label = `${theme.bold}${theme.primary}AGENT MANAGER${theme.reset} ${theme.dim}⟡${theme.reset} ${theme.bold}${theme.accent}MISSION CONTROL${theme.reset}`;
  return `${theme.border}╭${theme.reset}${padAnsi(label, totalWidth - 2)}${theme.border}╮${theme.reset}`;
};

const toTimestamp = (value: string) => {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const normalizeLines = (lines: string[], height: number) => {
  if (lines.length > height) {
    return lines.slice(0, height);
  }
  if (lines.length < height) {
    return [...lines, ...Array(height - lines.length).fill("")];
  }
  return lines;
};

const computeLayout = (width?: number) => {
  const totalWidth = Math.max(width ?? 120, 90);
  const contentWidth = Math.max(totalWidth - 10, 60);
  let left = Math.floor(contentWidth * 0.28);
  let center = Math.floor(contentWidth * 0.44);
  let right = contentWidth - left - center;
  const minColumn = 18;
  if (left < minColumn) {
    left = minColumn;
  }
  if (right < minColumn) {
    right = minColumn;
    center = contentWidth - left - right;
  }
  if (center < minColumn) {
    center = minColumn;
    right = contentWidth - left - center;
  }
  return {
    totalWidth: left + center + right + 10,
    left,
    center,
    right,
  };
};

export const renderMissionControlTui = (
  state: ProjectState,
  options: RenderOptions = {},
) => {
  const layout = computeLayout(options.width);
  const leftLines = buildLeftColumn(state, layout.left);
  const centerLines = buildCenterColumn(state, layout.center, options);
  const rightLines = buildRightColumn(state, layout.right);
  const bodyHeight = options.height ??
    Math.max(leftLines.length, centerLines.length, rightLines.length, 16);
  const left = normalizeLines(leftLines, bodyHeight);
  const center = normalizeLines(centerLines, bodyHeight);
  const right = normalizeLines(rightLines, bodyHeight);
  const leftSpan = layout.left + 2;
  const centerSpan = layout.center + 2;
  const rightSpan = layout.right + 2;
  const topBorder = `${theme.border}┏${"━".repeat(leftSpan)}┳${"━".repeat(centerSpan)}┳${"━".repeat(rightSpan)}┓${theme.reset}`;
  const bottomBorder = `${theme.border}┗${"━".repeat(leftSpan)}┻${"━".repeat(centerSpan)}┻${"━".repeat(rightSpan)}┛${theme.reset}`;
  const rows = left.map((line, index) => {
    const leftCell = padAnsi(line, layout.left);
    const centerCell = padAnsi(center[index] ?? "", layout.center);
    const rightCell = padAnsi(right[index] ?? "", layout.right);
    return `${theme.border}│${theme.reset} ${leftCell} ${theme.border}│${theme.reset} ${centerCell} ${theme.border}│${theme.reset} ${rightCell} ${theme.border}│${theme.reset}`;
  });
  return [
    renderBanner(layout.totalWidth),
    topBorder,
    ...rows,
    bottomBorder,
    ...renderInputBar(state, layout.totalWidth, options),
  ].join("\n");
};
