# Agent Manager System Overview

This repository implements a local, human-in-the-loop agent orchestration system for software projects.

The system is designed to:
- Separate planning from execution
- Enable parallel agent workflows
- Preserve explicit project state
- Keep architectural control with the user

Agents must follow the structure and boundaries defined below.

---

## High-Level Architecture

The system is composed of five layers:

1. Visual TUI Layer
2. Orchestrator Layer
3. Logic Layer
4. Implementation Layer
5. Persistence Layer

Each layer has strict responsibilities and must not leak concerns across boundaries.

---

## 1. Visual TUI Layer

Purpose:
- Display project state
- Display agent activity and logs
- Accept user commands and approvals

Constraints:
- No planning logic
- No execution logic
- No model calls
- No direct filesystem mutations

Inputs:
- Read-only project state snapshots (JSON)
- Event stream from orchestrator

Outputs:
- User intents such as:
  - create_project
  - add_feature
  - approve_plan
  - replan
  - run_tasks
  - pause_execution

The TUI must be restart-safe and stateless.

---

## 2. Orchestrator Layer (System Spine)

Purpose:
- Own project lifecycle
- Own agent lifecycle
- Own state transitions
- Coordinate planning and execution

This is the only layer allowed to mutate canonical project state.

Key responsibilities:
- Dispatch planning agents
- Dispatch execution agents
- Validate agent outputs
- Persist state transitions
- Enforce approval checkpoints

All transitions follow:

(state, intent) -> (new_state, side_effects)

---

## 3. Logic Layer (Agent Intelligence)

The logic layer is pure logic plus prompts. It does not perform execution.

### 3.1 Questioning Logic
- Identify missing or ambiguous requirements
- Generate structured clarification questions

### 3.2 Planning Logic
- Convert answers into:
  - System design summary
  - Task graph
  - Agent role assignments

Planning output must be structured and machine-parseable.

### 3.3 Execution Policy
- Decide:
  - Parallel vs sequential execution
  - Agent allocation
  - Retry and escalation rules

Early versions may use simple rule-based policies.

---

## 4. Implementation Layer (Execution)

Purpose:
- Perform code generation
- Modify files
- Execute commands
- Report results

This layer does not make decisions.

Execution tools may include:
- Claude Code SDK
- opencode execution helpers

Each task must follow this contract:

Input:
```json
{
  "task_id": "string",
  "inputs": {},
  "constraints": {},
  "expected_outputs": []
}
Output:

json
Copy code
{
  "task_id": "string",
  "status": "success | failure",
  "artifacts": [],
  "logs": []
}
No hidden side effects are allowed.