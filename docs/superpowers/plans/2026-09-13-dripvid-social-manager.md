# DripVid Social Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a first-class JARVIS Social Manager that maps DripVid events to approval-gated, platform-specific social campaigns.

**Architecture:** Add a focused `social-manager` module for rules, persistence, lifecycle, and audit; wrap the existing Jarvis HTTP handler with a Social Manager router in the same process/port; add a standalone Jarvis-native Social Manager screen served by the existing static file server. External social publishing remains disconnected in v1.

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

- [x] **Step 1: Write failing tests** for release playability gating, channel mapping, outage priority/platforms, approval before scheduling, persistence/audit.
- [x] **Step 2: Verify the feature contract is initially absent** on the feature branch.
- [x] **Step 3: Implement** `src/social-manager.js` with deterministic templates and atomic JSON persistence.
- [x] **Step 4: Verify with repository CI.**
- [x] **Step 5: Commit** the campaign engine changes.

### Task 2: Runtime and HTTP API

**Files:**
- Create: `src/social-http.js`
- Create: `src/bootstrap.js`
- Create: `test/social-http.test.js`
- Modify: `package.json`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `createSocialManager` and the existing Jarvis request handler.
- Produces routes: `GET /api/social/rules`, `GET /api/social/campaigns`, `POST /api/social/events`, `POST /api/social/campaigns/:id/approve`, `POST /api/social/campaigns/:id/schedule`.

- [x] **Step 1: Write API tests** for rules, event creation, approval, and scheduling validation.
- [x] **Step 2: Implement** the Social Manager HTTP wrapper and Jarvis bootstrap.
- [x] **Step 3: Keep Social Manager on the existing Jarvis host and port, delegating unmatched requests to the established handler.**
- [x] **Step 4: Add syntax checks and configurable campaign store path.**
- [x] **Step 5: Verify with repository CI.**

### Task 3: Jarvis Social Manager UI

**Files:**
- Create: `public/social.html`
- Create: `public/social.js`
- Create: `public/social.css`
- Create: `test/social-ui.test.js`

**Interfaces:**
- Consumes social API routes.
- Produces a Jarvis-native operator screen at `/social.html`.

- [x] **Step 1: Write static-contract tests** asserting page title, campaign form, platform preview container, approval controls, and no publish control.
- [x] **Step 2: Implement** responsive Social Manager page using existing DripVid logo assets and safe DOM rendering.
- [x] **Step 3: Implement** campaign creation, platform previews, approval, scheduling, status counts, and refresh behavior.
- [x] **Step 4: Verify with repository CI.**

### Task 4: Verification and PR

**Files:**
- Review all changed files.

- [x] **Step 1: Run repository CI syntax checks.**
- [x] **Step 2: Run repository CI test suite.**
- [x] **Step 3: Open draft pull request #11 from `feature/social-manager` to `main`.**
- [x] **Step 4: Inspect the PR diff for unrelated changes and approval-gate regressions.**
