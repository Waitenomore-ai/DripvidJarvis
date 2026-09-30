# JARVIS Workforce HQ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real JARVIS workforce engine and game-style HQ UI that visualizes five AI employees, tasks, delegation, and live state using the existing DripVid JARVIS runtime.

**Architecture:** Add a focused `src/workforce` domain with employee registry, state, task manager, and handoff records. Wire it into the existing `src/app.js` runtime and HTTP server, then expose a dedicated `/workforce` frontend that polls the workforce snapshot and renders rooms, employees, tasks, and activity. Keep the current voice, Social Manager, Brain/Vault, model router, and DripVid adapters intact.

**Tech Stack:** Node.js 22+, existing Node test runner, existing vanilla HTML/CSS/JS frontend, existing HTTP server.

**Spec:** `docs/superpowers/specs/2026-09-30-jarvis-workforce-hq.md`

## Global Constraints
- Node.js >=22.
- Do not create a second backend or frontend application.
- Reuse existing model/tool infrastructure.
- Local/free model routing remains the default when configured.
- Existing Social Manager is extended, not replaced.
- Approval remains required for configured external/destructive actions.
- UI state must reflect real backend state; no fake employee activity.

## Review Focus
- Missing/invalid employee IDs must return a controlled validation error rather than creating orphan tasks; covered by Task 2 API validation tests.
- Concurrent task updates must not lose the latest state; covered by Task 2 task-manager mutation tests.
- Unknown task IDs must return 404 rather than a server error; covered by Task 3 HTTP tests.
- Browser polling/network failure must leave the last valid HQ state visible and show an offline indicator; covered by Task 4 frontend behavior checks.
- Existing JARVIS/voice routes must remain unchanged; covered by Task 3 integration smoke tests.

---

### Task 1: Workforce domain model and registry

**Files:**
- Create: `src/workforce/employee.js`
- Create: `src/workforce/registry.js`
- Create: `src/workforce/state.js`
- Test: `test/workforce-registry.test.js`

**Interfaces:**
- Produces `createEmployee(definition)`, `createWorkforceRegistry(employees)`, `registry.list()`, `registry.get(id)`, `registry.snapshot()`, and `normalizeEmployeeState(state)`.
- Employee IDs: `jarvis`, `sosh`, `scout`, `dev`, `ops`.

- [ ] **Step 1: Write failing registry tests** for five employees, lookup, snapshot shape, and invalid state normalization.
- [ ] **Step 2: Run `node --test test/workforce-registry.test.js` and verify failure.**
- [ ] **Step 3: Implement employee/state/registry modules with immutable-safe snapshots.**
- [ ] **Step 4: Run the focused tests and verify PASS.**
- [ ] **Step 5: Commit** `feat: add workforce employee registry`.

### Task 2: Task manager and handoffs

**Files:**
- Create: `src/workforce/task-manager.js`
- Create: `src/workforce/handoff.js`
- Test: `test/workforce-task-manager.test.js`

**Interfaces:**
- `createTaskManager({ registry, now, idFactory })`.
- `tasks.create({ title, description, priority, employeeId, dependencies })` returns a task.
- `tasks.get(id)`, `tasks.list(filters)`, `tasks.update(id, patch)`, `tasks.handoff(id, { fromEmployeeId, toEmployeeId, reason, payload })`.
- Task statuses: `queued`, `running`, `waiting`, `needs_input`, `complete`, `error`.

- [ ] **Step 1: Write failing tests** for create, assignment, progress, invalid employee, missing task, status lifecycle, and handoff history.
- [ ] **Step 2: Run focused tests and verify failure.**
- [ ] **Step 3: Implement task manager with serialized mutation path so concurrent updates preserve the latest task.**
- [ ] **Step 4: Run focused tests and verify PASS.**
- [ ] **Step 5: Commit** `feat: add workforce task manager and handoffs`.

### Task 3: Runtime integration and workforce HTTP API

**Files:**
- Create: `src/workforce/index.js`
- Modify: `src/app.js`
- Test: `test/workforce-http.test.js`

**Interfaces:**
- `createWorkforceRuntime({ model, brain, vault, dripvid, now })` returns `{ registry, tasks, snapshot(), createTask(), handoffTask() }`.
- Routes: `GET /api/workforce/state`, `GET /api/workforce/employees`, `GET /api/workforce/tasks`, `POST /api/workforce/tasks`, `GET /api/workforce/tasks/:id`, `POST /api/workforce/tasks/:id/handoff`.

- [ ] **Step 1: Write failing HTTP tests** for snapshot, employee list, task create, task lookup, handoff, invalid input, and unknown task 404.
- [ ] **Step 2: Run focused tests and verify failure.**
- [ ] **Step 3: Instantiate workforce runtime from the existing `createRuntime` path and route API requests through existing JSON/error helpers.**
- [ ] **Step 4: Run focused HTTP tests plus the existing `node --test` suite.**
- [ ] **Step 5: Run `npm run check` and verify PASS.**
- [ ] **Step 6: Commit** `feat: expose workforce runtime and api`.

### Task 4: HQ frontend vertical slice

**Files:**
- Create: `public/workforce.html`
- Create: `public/workforce.css`
- Create: `public/workforce.js`
- Modify: `public/index.html`
- Test: `test/workforce-frontend.test.js`

**Interfaces:**
- Frontend consumes the API endpoints from Task 3.
- `workforce.js` exposes `loadWorkforceState()`, `renderWorkforceState(state)`, and `startWorkforcePolling()`.

- [ ] **Step 1: Write frontend contract tests** for required room IDs, employee IDs, API paths, and state labels.
- [ ] **Step 2: Implement the `/workforce` HTML shell with Command Centre, Social Studio, Research Lab, Dev Workshop, Ops Room, Task Hub, activity feed, and employee/task detail panel.**
- [ ] **Step 3: Implement dark cinematic/game-style CSS with responsive layout and state indicators.**
- [ ] **Step 4: Implement polling, room filtering, employee selection, task selection, and offline-state preservation.**
- [ ] **Step 5: Add a Workforce/HQ link to the existing JARVIS navigation without removing voice controls.**
- [ ] **Step 6: Run frontend contract tests and full `node --test`; verify PASS.**
- [ ] **Step 7: Commit** `feat: add JARVIS workforce HQ interface`.

### Task 5: Real Scout research vertical slice

**Files:**
- Modify: `src/workforce/index.js`
- Modify: `src/jarvis.js`
- Test: `test/workforce-research.test.js`

**Interfaces:**
- `workforce.executeTask(id)` invokes the existing model/tool layer using the assigned employee definition and updates the task/employee state.
- Scout task prompt must preserve the user's requested research objective and return a structured result suitable for display.

- [ ] **Step 1: Write failing tests** using injected fake model/tool adapters for Scout state transitions and result storage.
- [ ] **Step 2: Run focused tests and verify failure.**
- [ ] **Step 3: Implement task execution using dependency injection; do not bypass the existing model router.**
- [ ] **Step 4: Verify success, tool/model failure, and needs-input paths.**
- [ ] **Step 5: Run full tests and `npm run check`.**
- [ ] **Step 6: Commit** `feat: execute workforce research tasks`.

### Task 6: Verification and handover

**Files:**
- Modify: `docs/superpowers/plans/2026-09-30-jarvis-workforce-hq.md`
- Create: `docs/superpowers/handover/2026-09-30-jarvis-workforce-hq.md`

- [ ] **Step 1: Run `node --test`.**
- [ ] **Step 2: Run `npm run check`.**
- [ ] **Step 3: Run the existing smoke check in dry-run mode.**
- [ ] **Step 4: Manually verify `/workforce`, existing `/`, voice UI, and representative DripVid routes.**
- [ ] **Step 5: Record actual test results, limitations, and next-phase work in the handover.**
- [ ] **Step 6: Commit** `docs: add workforce HQ verification handover`.

## Execution Order
Tasks are intentionally sequential because the API and UI depend on the workforce interfaces established earlier. Task 5 is kept after the UI vertical slice so the first end-to-end demonstration can be verified visually.
