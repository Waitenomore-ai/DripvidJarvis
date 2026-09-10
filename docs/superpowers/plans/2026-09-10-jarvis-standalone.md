# DripVid JARVIS Standalone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a standalone localhost-only DripVid JARVIS service with a futuristic HUD, dependency monitoring, AI-HQ orchestration, safe tools, and confirmation-protected mutating actions.

**Architecture:** One Node.js 22 service listens on `127.0.0.1:3342`. DripVid, MCP, and AI-HQ are accessed through separate adapters so failures remain isolated.

**Tech Stack:** Node.js 22, `node:http`, native `fetch`, `node:test`, `node:crypto`, vanilla HTML/CSS/JavaScript.

**Spec:** `docs/superpowers/specs/2026-09-10-jarvis-standalone-design.md`

## Global Constraints

- Bind JARVIS to `127.0.0.1`.
- Default port: `3342`.
- DripVid: `http://127.0.0.1:3000`.
- MCP: `http://127.0.0.1:8788/mcp`.
- AI-HQ: `http://127.0.0.1:9001`.
- No secrets committed.
- Dependency failures must not crash JARVIS.
- Mutating actions require explicit confirmation.
- Do not modify live DripVid or nginx during this milestone.

---

## Task 1 — Runtime foundation

Create:
- `package.json`
- `.gitignore`
- `.env.example`
- `src/config.js`
- `src/app.js`
- `test/app.test.js`

Implement:
- config loader
- localhost defaults
- HTTP server creation
- no auto-bind when imported
- npm scripts for start/test/check

Test first:
- default host is `127.0.0.1`
- default port is `3342`
- app can be created without listening

Commit:
`feat: add jarvis runtime foundation`

---

## Task 2 — Dependency health

Create:
- `src/adapters/dripvid.js`
- `src/adapters/mcp.js`
- `src/adapters/aihq.js`
- `test/health.test.js`

Implement:
- independent health checks
- timeout handling
- structured online/offline results
- `GET /api/health`
- overall `online`, `degraded`, or `offline`

Test:
- all dependencies online
- each dependency failing independently
- JARVIS remains operational

Commit:
`feat: add resilient dependency health`

---

## Task 3 — Tool discovery

Create/modify:
- `src/jarvis.js`
- `src/adapters/dripvid.js`
- `src/adapters/mcp.js`
- `test/tools.test.js`
- `src/app.js`

Implement:
- normalized tool objects
- independent DripVid/MCP discovery
- partial results if one dependency fails
- `GET /api/tools`

Test:
- DripVid tools remain when MCP is offline
- MCP tools remain when DripVid is offline

Commit:
`feat: add partial tool discovery`

---

## Task 4 — Safe confirmation system

Modify:
- `src/jarvis.js`
- adapters
- `src/app.js`

Create:
- `test/confirmation.test.js`

Implement:
- classify tools as read-only or mutating
- strong random confirmation IDs
- in-memory pending actions
- expiration
- single-use confirmation
- `POST /api/confirm`

Test:
- read-only execution works
- mutating action does not run immediately
- confirmed action runs once
- invalid/expired confirmations fail

Commit:
`feat: protect mutating jarvis actions`

---

## Task 5 — AI-HQ orchestration

Modify:
- `src/adapters/aihq.js`
- `src/jarvis.js`
- tests

Implement:
- `POST /aihq/chat` client
- conversation normalization
- tool-call validation
- degraded response when AI-HQ is offline
- `POST /api/conversation`

Never execute unknown tools requested by AI-HQ.

Commit:
`feat: connect jarvis to ai hq`

---

## Task 6 — JARVIS HUD

Create:
- `public/index.html`
- `public/jarvis.css`
- `public/jarvis.js`

Modify:
- `src/app.js`
- tests

Implement:
- futuristic HUD shell
- overall reactor-style health display
- DripVid/MCP/AI-HQ indicators
- conversation console
- tool/activity feed
- confirmation panel
- health polling
- tools loading
- conversation submission
- confirmation controls

Commit:
`feat: add jarvis operator hud`

---

## Task 7 — Deployment package

Create:
- `deploy/dripvid-jarvis.service`

Update:
- `.env.example`
- `README.md`

Document:
- `/opt/dripvid-jarvis`
- non-root systemd service
- localhost bind
- env file
- restart on failure
- verification
- rollback

Do not install or start the production service yet.

Commit:
`docs: add jarvis deployment guidance`

---

## Task 8 — Verification

Run:
- `npm install`
- `npm test`
- `npm run check`
- temporary localhost startup
- `curl http://127.0.0.1:3342/api/health`
- `curl http://127.0.0.1:3342/`
- `git status`

Confirm:
- no secrets
- no public bind
- dependency failures are tolerated
- all tests pass

Do not deploy until explicitly approved.
