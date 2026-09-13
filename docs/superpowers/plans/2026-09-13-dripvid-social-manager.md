# DripVid Social Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a first-class JARVIS Social Manager that maps DripVid events to approval-gated, platform-specific social campaigns.

**Architecture:** Add a focused `social-manager` module for rules, persistence, lifecycle, and audit; expose operator-local API routes through the existing HTTP server; add a standalone Jarvis-native Social Manager screen served by the existing static file server. External social publishing remains disconnected in v1.

**Tech Stack:** Node.js 22, CommonJS, built-in `node:test`, existing JARVIS HTTP/static server, JSON persistence.

**Spec:** `docs/superpowers/specs/2026-09-13-dripvid-social-manager-design.md`

## Global Constraints

- All campaigns begin in `draft`.
- Scheduling requires explicit approval.
- No external publishing in v1.
- `new_release` events only create campaigns when `playable === true` or `ready === true`.
- Support Facebook, Instagram, X, TikTok, and YouTube Community presets.
- Persist an audit trail for creation, approval, and scheduling.
- P4 events do not create a public campaign.

---

### Task 1: Event mapping and campaign lifecycle

**Files:**
- Create: `test/social-manager.test.js`
- Create: `src/social-manager.js`

**Interfaces:**
- Produces: `createSocialManager({ config, now })`
- Produces methods: `rules()`, `listCampaigns()`, `ingestEvent(event)`, `approveCampaign(id)`, `scheduleCampaign(id, scheduledAt)`.

- [ ] **Step 1: Write failing tests** for release playability gating, channel mapping, outage priority/platforms, approval before scheduling, persistence/audit.
- [ ] **Step 2: Run** `node --test test/social-manager.test.js` and confirm RED.
- [ ] **Step 3: Implement** `src/social-manager.js` with deterministic templates and atomic JSON persistence.
- [ ] **Step 4: Run** `node --test test/social-manager.test.js` and confirm GREEN.
- [ ] **Step 5: Commit** with `feat: add social campaign engine`.

### Task 2: Runtime and HTTP API

**Files:**
- Modify: `src/config.js`
- Modify: `src/app.js`
- Modify: `package.json`
- Modify: `.env.example`
- Modify: `test/app.test.js`

**Interfaces:**
- Consumes: `createSocialManager`.
- Produces routes: `GET /api/social/rules`, `GET /api/social/campaigns`, `POST /api/social/events`, `POST /api/social/campaigns/:id/approve`, `POST /api/social/campaigns/:id/schedule`.

- [ ] **Step 1: Write failing API tests** for rules, event creation, approval, and scheduling validation.
- [ ] **Step 2: Run** targeted app tests and confirm RED.
- [ ] **Step 3: Wire** social manager into runtime, config, syntax checks, and API router.
- [ ] **Step 4: Run** targeted tests and confirm GREEN.
- [ ] **Step 5: Commit** with `feat: expose social manager API`.

### Task 3: Jarvis Social Manager UI

**Files:**
- Create: `public/social.html`
- Create: `public/social.js`
- Create: `public/social.css`
- Create: `test/social-ui.test.js`

**Interfaces:**
- Consumes social API routes.
- Produces a Jarvis-native operator screen at `/social.html`.

- [ ] **Step 1: Write failing static-contract tests** asserting page title, campaign form, platform preview container, approval controls, and no auto-publish control.
- [ ] **Step 2: Run** `node --test test/social-ui.test.js` and confirm RED.
- [ ] **Step 3: Implement** responsive Social Manager page using existing DripVid logo assets and safe DOM rendering.
- [ ] **Step 4: Run** UI tests and confirm GREEN.
- [ ] **Step 5: Commit** with `feat: add Jarvis social manager UI`.

### Task 4: Verification and PR

**Files:**
- Review all changed files.

- [ ] **Step 1: Run** `npm run check`.
- [ ] **Step 2: Run** `npm test`.
- [ ] **Step 3: Open a pull request** from `feature/social-manager` to `main` so repository CI independently validates syntax and tests.
- [ ] **Step 4: Inspect the PR diff** for accidental unrelated changes and approval-gate regressions.
