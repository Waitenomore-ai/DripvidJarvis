# DripVid JARVIS Workforce HQ — Handover

Date: 2026-09-30
Branch: `feature/jarvis-workforce-hq`
Head at handover: `11605aecbaf63cc0a177f4913390d3371f8c1645`

## Delivered

The first workforce/HQ vertical slice is implemented inside the existing DripVid JARVIS application.

### Workforce backend

- Employee registry for `jarvis`, `sosh`, `scout`, `dev`, and `ops`.
- Employee rooms and live operational states.
- Task creation, lookup, filtering, updates, and handoffs.
- Task progress and result/error storage.
- Workforce activity feed.
- Workforce snapshot API.
- Task execution endpoint: `POST /api/workforce/tasks/:id/execute`.
- `/workforce` route serving the HQ interface.

### HQ frontend

- Command Centre.
- Social Studio.
- Research Lab.
- Dev Workshop.
- Ops Room.
- Task Hub.
- Activity feed.
- Employee/task detail panel.
- Three-second state polling.
- Offline indicator while retaining the last rendered state.
- Task Run control for queued/waiting tasks.

## Current execution behaviour

The workforce executor uses the existing model router supplied by JARVIS. It does not create a second model service.

When a model is unavailable, the task enters `needs_input` rather than pretending that work happened.

Model failures become task `error` states and are recorded in the workforce activity feed.

## Tests added

- `test/workforce-registry.test.js`
- `test/workforce-task-manager.test.js`
- `test/workforce-http.test.js`
- `test/workforce-frontend.test.js`
- `test/workforce-research.test.js`

The research tests cover successful execution, model failure, and missing-model behaviour.

## Verification limitation

The GitHub connector available for this session can read/write repository files and commits but does not provide a shell runner for executing `node --test` or `npm run check` inside the repository. Therefore this handover records the code and test contracts that were added, but does **not** claim a locally executed test-suite result.

The feature branch is intentionally separate from `main`. No merge or production deployment was performed.

## Next implementation phase

The next step should make the workforce genuinely useful rather than only executable through a button:

1. Give Scout direct access to the existing web-search adapter and Brain/Vault context.
2. Give Sosh access to the existing Social Manager through an approval-gated employee action layer.
3. Add persistent approvals and an Approval Inbox.
4. Add event-driven DripVid triggers so JARVIS can create tasks automatically.
5. Add employee memory and task history persistence.
6. Connect Ops to real DripVid/Jellyfin health events.
7. Add task handoff animations and room transitions to the HQ UI.
8. Add richer employee profiles, workload, history, and permissions.

## Important design rule

The HQ must remain a visualisation of real backend state. Employee animations, status labels, progress, and activity must not imply work that the backend has not actually performed.
