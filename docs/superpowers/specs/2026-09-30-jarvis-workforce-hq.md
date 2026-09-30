# DripVid JARVIS Workforce HQ — Product Specification

## Goal
Turn DripVid JARVIS into a free/self-hosted AI workforce with a game-style virtual HQ that visualizes real employee work, delegation, tasks, approvals, and system activity.

## Scope
Version 1 is a vertical slice: real workforce state plus a browser HQ showing JARVIS, Sosh, Scout, Dev, and Ops. It integrates with the existing JARVIS runtime instead of creating a second application.

## Existing constraints
- Node.js >=22.
- Existing `src/app.js` owns the HTTP server/static frontend and runtime construction.
- Existing Brain, Vault, model router, free-agent usage budget, DripVid adapter, MCP, web search, voice, and Social Manager remain reusable.
- Existing Social Manager is extended rather than replaced.
- Existing confirmation/approval behavior remains authoritative for external or destructive actions.
- No paid AI dependency is required for the workforce core; local/free model routing remains the default when configured.

## Workforce
Initial employees: `jarvis` coordinator/team leader; `sosh` social media manager; `scout` research/trends; `dev` development/testing; `ops` infrastructure/operations.

Each employee has id, name, role, description, system prompt, capabilities, permitted tools, model preference, state, current task, and work history.

## Employee states
`idle`, `thinking`, `working`, `researching`, `waiting`, `needs_input`, `complete`, `error`.

State must be backed by actual task/runtime state. The UI must never invent activity.

## Task model
A task contains id, title, description, status, priority, assigned employee, created timestamp, updated timestamp, progress 0-100, dependencies, result/error, and audit events.

Required lifecycle: `queued -> running -> waiting/needs_input -> complete/error`.

## Delegation
JARVIS can create a task for an employee and hand work between employees. A handoff records source employee, destination employee, task id, reason, and payload/result metadata.

Initial demonstrable workflow: user asks JARVIS to research a DripVid promotion idea -> JARVIS creates Scout task -> Scout uses existing model/tool infrastructure -> Scout returns findings -> JARVIS displays completed result.

## HQ rooms
- Command Centre: JARVIS, workforce overview, active tasks, alerts, approvals.
- Social Studio: Sosh; future Penny/designer/community roles.
- Research Lab: Scout; research and knowledge retrieval.
- Dev Workshop: Dev; code/build/test activity.
- Ops Room: Ops; system/service monitoring.
- Task Hub: shared queue/workflow.
- Brain/Knowledge Archive: future visual surface for Brain/Vault.

V1 implements the first five rooms plus Task Hub; Brain Archive may be a visual placeholder until the underlying knowledge surface is defined.

## UI behavior
The HQ is the primary JARVIS dashboard, while existing voice functionality remains accessible. The interface is dark, cinematic, futuristic, professional, and game-like without becoming a fake animation.

Users can click a room to inspect its employees/tasks, click an employee to see profile/current work, and click a task to inspect details/result/history.

Required live panels: workforce status, active task cards, activity feed, approval/needs-input indicator, and selected employee/task detail.

## Backend API
Expose from the existing server:
- `GET /api/workforce/state` -> workforce snapshot
- `GET /api/workforce/employees` -> employee registry/state
- `GET /api/workforce/tasks` -> current/recent tasks
- `POST /api/workforce/tasks` -> create task
- `GET /api/workforce/tasks/:id` -> task detail
- `POST /api/workforce/tasks/:id/handoff` -> hand off task

Mutation endpoints validate input and use existing server error/JSON conventions.

## Frontend files
Create `public/workforce.html`, `public/workforce.css`, and `public/workforce.js`. Add a Workforce/HQ navigation entry from the current JARVIS dashboard.

## Non-goals for V1
- Full animated 3D characters.
- Autonomous social publishing without approval.
- Dozens of employees.
- Replacing the existing Social Manager.
- Replacing Brain/Vault.
- Building a separate frontend/backend application.
- Paid model requirements.

## Acceptance criteria
1. Server starts with the existing runtime.
2. Existing tests/checks continue to pass.
3. `/workforce` loads the HQ interface.
4. API returns the five employees with real state.
5. A task can be created and assigned.
6. Task state changes are reflected in the HQ without a page reload.
7. Employee/task detail can be inspected.
8. Handoff records are visible in task history.
9. The research workflow can execute through the existing JARVIS/model/tool layer when configured.
10. No fake employee activity is displayed.
11. Existing voice and existing DripVid routes remain functional.
