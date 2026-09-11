# JARVIS Natural-Language Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ordinary JARVIS chat requests execute only approved real read-only diagnostics, support bounded multi-tool investigation, and return clear explanations of the results.

**Architecture:** Keep `src/jarvis.js` as the orchestration boundary, but add a small focused diagnostic-policy module that owns the automatic allowlist, validation, sanitization, limits, and deterministic fallback formatting. The conversation loop will expose only policy-approved diagnostic tools to the model, execute independent calls concurrently while preserving call order, feed bounded/redacted results back to the model, and stop after 4 model/tool rounds or 8 executed diagnostics. Existing model routing, DripVid/MCP adapters, brain/vault context, HUD/API shape, confirmation system, and localhost/auth boundaries remain intact.

**Tech Stack:** Node.js 22+, CommonJS, built-in `node:test`, existing OpenAI-compatible model adapter/router, existing DripVid and MCP adapters.

**Spec:** `docs/superpowers/specs/2026-09-11-natural-language-diagnostics-design.md`

## Global Constraints

- Automatic diagnostic allowlist is exactly: `dripvid.health`, `mcp.server_info`, `mcp.disk_status`, `mcp.network_status`, `mcp.service_status`, `mcp.service_logs`, `mcp.http_health`, `mcp.dripvid_health`, `mcp.dripvid_git_status`, `mcp.dripvid_config`.
- Never auto-execute shell, restart/stop/start, deployment, source/config/environment/filesystem/account/database/media mutation, vault writes/migrations, memory deletion, unknown tools, or any tool marked `mutating`.
- Maximum 4 model/tool rounds per operator request.
- Maximum 8 executed diagnostic calls per operator request.
- Default tool-result context cap remains approximately 4,000 characters via `config.maxToolResultChars`.
- Sensitive values must be redacted before model context: API keys, bearer tokens, passwords, cookies, authorization headers, session secrets, database URLs, and equivalent secret-bearing keys.
- `/jarvis` remains Admin/Owner authenticated through DripVid; JARVIS remains localhost-only on `127.0.0.1:3342`.
- No nginx change.
- Preserve current HUD/voice, model fallback routing, brain/vault context, confirmation APIs, and existing response shapes.
- Production deployment is not part of implementation tasks; deployment occurs only after the verification gate.

---

### Task 1: Diagnostic Policy Boundary

**Files:**
- Create: `src/diagnostic-policy.js`
- Create: `test/diagnostic-policy.test.js`
- Modify: `package.json` only if its syntax/check script enumerates source files explicitly.

**Interfaces:**
- Consumes: discovered tool objects shaped like `{ name, source, description, inputSchema, mutating }` and model tool calls shaped like `{ id, name, arguments }`.
- Produces: `AUTOMATIC_DIAGNOSTIC_TOOL_NAMES`, `selectAutomaticDiagnosticTools(tools)`, `validateDiagnosticCall(call, toolByName)`, `sanitizeDiagnosticValue(value)`, `formatDiagnosticFallback(toolResults, reason)`.

- [ ] **Step 1: Write failing policy tests**

Create `test/diagnostic-policy.test.js` with tests equivalent to:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  AUTOMATIC_DIAGNOSTIC_TOOL_NAMES,
  selectAutomaticDiagnosticTools,
  validateDiagnosticCall,
  sanitizeDiagnosticValue,
  formatDiagnosticFallback
} = require('../src/diagnostic-policy');

test('automatic diagnostic allowlist contains only approved tools', () => {
  assert.deepEqual([...AUTOMATIC_DIAGNOSTIC_TOOL_NAMES], [
    'dripvid.health',
    'mcp.server_info',
    'mcp.disk_status',
    'mcp.network_status',
    'mcp.service_status',
    'mcp.service_logs',
    'mcp.http_health',
    'mcp.dripvid_health',
    'mcp.dripvid_git_status',
    'mcp.dripvid_config'
  ]);
});

test('selection excludes mutating and unrelated tools', () => {
  const selected = selectAutomaticDiagnosticTools([
    { name: 'dripvid.health', mutating: false },
    { name: 'mcp.disk_status', mutating: false },
    { name: 'mcp.restart_service', mutating: true },
    { name: 'vault.write', mutating: true },
    { name: 'brain.recall', mutating: false }
  ]);
  assert.deepEqual(selected.map((tool) => tool.name), [
    'dripvid.health',
    'mcp.disk_status'
  ]);
});

test('validation blocks unknown, mutating, malformed and missing-required-argument calls', () => {
  const map = new Map([
    ['mcp.service_logs', {
      name: 'mcp.service_logs',
      mutating: false,
      inputSchema: {
        type: 'object',
        required: ['service']
      }
    }],
    ['mcp.disk_status', {
      name: 'mcp.disk_status',
      mutating: true
    }]
  ]);
  assert.equal(validateDiagnosticCall(null, map).ok, false);
  assert.equal(validateDiagnosticCall({ name: 'mcp.nope', arguments: {} }, map).ok, false);
  assert.equal(validateDiagnosticCall({ name: 'mcp.disk_status', arguments: {} }, map).ok, false);
  assert.equal(validateDiagnosticCall({ name: 'mcp.service_logs', arguments: {} }, map).ok, false);
  assert.equal(validateDiagnosticCall({ name: 'mcp.service_logs', arguments: { service: 'dripvid' } }, map).ok, true);
});

test('sanitization recursively redacts secret-bearing keys', () => {
  const result = sanitizeDiagnosticValue({
    safe: 'yes',
    apiKey: 'a',
    nested: { authorization: 'Bearer x', cookie: 'sid=x', databaseUrl: 'postgres://x' }
  });
  assert.deepEqual(result, {
    safe: 'yes',
    apiKey: '[REDACTED]',
    nested: {
      authorization: '[REDACTED]',
      cookie: '[REDACTED]',
      databaseUrl: '[REDACTED]'
    }
  });
});

test('fallback summary reports successful and failed diagnostics', () => {
  const text = formatDiagnosticFallback([
    { name: 'mcp.disk_status', ok: true, result: { free: '1 TB' } },
    { name: 'mcp.service_logs', ok: false, error: 'timeout' }
  ], 'model unavailable');
  assert.match(text, /mcp\.disk_status/);
  assert.match(text, /1 TB/);
  assert.match(text, /mcp\.service_logs/);
  assert.match(text, /timeout/);
  assert.match(text, /model unavailable/);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test test/diagnostic-policy.test.js
```

Expected: FAIL because `../src/diagnostic-policy` does not exist.

- [ ] **Step 3: Implement the minimal policy module**

Create `src/diagnostic-policy.js` with:

```js
'use strict';

const AUTOMATIC_DIAGNOSTIC_TOOL_NAMES = Object.freeze([
  'dripvid.health',
  'mcp.server_info',
  'mcp.disk_status',
  'mcp.network_status',
  'mcp.service_status',
  'mcp.service_logs',
  'mcp.http_health',
  'mcp.dripvid_health',
  'mcp.dripvid_git_status',
  'mcp.dripvid_config'
]);

const automaticNames = new Set(AUTOMATIC_DIAGNOSTIC_TOOL_NAMES);

function isSensitiveKey(key) {
  return /(?:api[_-]?key|token|password|secret|database[_-]?url|bearer|authorization|cookie|session)/i.test(String(key || ''));
}

function sanitizeDiagnosticValue(value) {
  if (Array.isArray(value)) return value.map(sanitizeDiagnosticValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    isSensitiveKey(key) ? '[REDACTED]' : sanitizeDiagnosticValue(item)
  ]));
}

function selectAutomaticDiagnosticTools(tools) {
  return (Array.isArray(tools) ? tools : []).filter((tool) =>
    tool &&
    automaticNames.has(String(tool.name || '')) &&
    tool.mutating !== true
  );
}

function validateDiagnosticCall(call, toolByName) {
  if (!call || typeof call.name !== 'string') {
    return { ok: false, error: 'Malformed diagnostic tool call' };
  }
  if (!automaticNames.has(call.name)) {
    return { ok: false, error: 'Tool unavailable in read-only diagnostic mode' };
  }
  const tool = toolByName.get(call.name);
  if (!tool) return { ok: false, error: 'Unknown diagnostic tool' };
  if (tool.mutating === true) return { ok: false, error: 'Mutating tools are blocked in read-only diagnostic mode' };
  const args = call.arguments && typeof call.arguments === 'object' && !Array.isArray(call.arguments)
    ? call.arguments
    : {};
  const required = tool.inputSchema && Array.isArray(tool.inputSchema.required)
    ? tool.inputSchema.required
    : [];
  const missing = required.filter((name) => !Object.hasOwn(args, name));
  if (missing.length) return { ok: false, error: `Missing required arguments: ${missing.join(', ')}` };
  return { ok: true, tool, args };
}

function formatDiagnosticFallback(toolResults, reason) {
  const lines = ['I completed the available read-only diagnostics, but could not generate the normal AI explanation.'];
  if (reason) lines.push(`Reason: ${reason}`);
  for (const item of toolResults || []) {
    const detail = item.ok ? JSON.stringify(sanitizeDiagnosticValue(item.result)) : String(item.error || 'failed');
    lines.push(`- ${item.name || 'diagnostic'}: ${item.ok ? 'OK' : 'FAILED'} — ${detail}`);
  }
  return lines.join('\n');
}

module.exports = {
  AUTOMATIC_DIAGNOSTIC_TOOL_NAMES,
  selectAutomaticDiagnosticTools,
  validateDiagnosticCall,
  sanitizeDiagnosticValue,
  formatDiagnosticFallback
};
```

If `package.json` has an explicit `node --check` file list, add `src/diagnostic-policy.js` to it without changing other scripts.

- [ ] **Step 4: Run focused tests and syntax check**

Run:

```bash
node --test test/diagnostic-policy.test.js
node --check src/diagnostic-policy.js
```

Expected: all focused tests PASS and syntax check exits 0.

- [ ] **Step 5: Commit the policy boundary**

```bash
git add src/diagnostic-policy.js test/diagnostic-policy.test.js package.json
git commit -m "feat: define read-only diagnostic policy"
```

---

### Task 2: Restrict Model Tool Exposure and Execute Valid Diagnostics

**Files:**
- Modify: `src/jarvis.js`
- Modify: `test/jarvis.test.js`

**Interfaces:**
- Consumes: Task 1 `selectAutomaticDiagnosticTools`, `validateDiagnosticCall`, and `sanitizeDiagnosticValue`.
- Produces: the existing `jarvis.conversation()` API, now advertising only approved diagnostic tools to the model and executing valid read-only calls without creating confirmations.

- [ ] **Step 1: Add failing conversation tests for allowlisting and real execution**

Extend `test/jarvis.test.js` so the setup can return per-round model responses and per-tool MCP results. Add tests with these assertions:

```js
test('conversation exposes only approved read-only diagnostics to the model', async () => {
  const { jarvis, chats } = setup({
    mcpTools: [
      { name: 'mcp.disk_status', source: 'mcp', mutating: false },
      { name: 'mcp.restart_service', source: 'mcp', mutating: true },
      { name: 'vault.search', source: 'vault', mutating: false }
    ]
  });
  await jarvis.conversation({ conversation: [{ role: 'user', content: 'Check disk space' }] });
  assert.deepEqual(chats[0].tools.map((tool) => tool.name), [
    'dripvid.health',
    'mcp.disk_status'
  ]);
});

test('known read-only diagnostic executes and result is returned to model', async () => {
  const { jarvis, calls, chats } = setup({
    mcpTools: [{ name: 'mcp.disk_status', source: 'mcp', mutating: false }],
    toolCalls: [{ id: 'disk1', name: 'mcp.disk_status', arguments: {} }],
    rounds: 1,
    mcpResult: { free: '1 TB', total: '2 TB' }
  });
  const result = await jarvis.conversation({ conversation: [{ role: 'user', content: 'How much disk space?' }] });
  assert.deepEqual(calls, [{ source: 'mcp', name: 'mcp.disk_status', args: {} }]);
  assert.equal(chats.length, 2);
  assert.match(JSON.stringify(chats[1].conversation), /1 TB/);
  assert.equal(result.message, 'Final answer');
  assert.equal(result.confirmations.length, 0);
});

test('model-requested blocked tool is not executed and creates no confirmation', async () => {
  const { jarvis, calls } = setup({
    mcpTools: [{ name: 'mcp.restart_service', source: 'mcp', mutating: true }],
    toolCalls: [{ id: 'bad1', name: 'mcp.restart_service', arguments: { service: 'dripvid' } }],
    rounds: 1
  });
  const result = await jarvis.conversation({ conversation: [{ role: 'user', content: 'Restart it' }] });
  assert.equal(calls.length, 0);
  assert.equal(result.confirmations.length, 0);
  assert.equal(result.toolResults[0].ok, false);
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
node --test test/jarvis.test.js
```

Expected: new tests FAIL because the current conversation advertises all discovered tools and creates confirmations for model-requested mutating tools.

- [ ] **Step 3: Apply the diagnostic policy in `conversation()`**

At the top of `src/jarvis.js`, import:

```js
const {
  selectAutomaticDiagnosticTools,
  validateDiagnosticCall,
  sanitizeDiagnosticValue,
  formatDiagnosticFallback
} = require('./diagnostic-policy');
```

Inside `conversation()`:

```js
const availableTools = await tools();
const diagnosticTools = selectAutomaticDiagnosticTools(availableTools);
const toolByName = new Map(diagnosticTools.map((tool) => [tool.name, tool]));
const requestTools = diagnosticTools.map((tool) => ({
  name: tool.name,
  description: tool.description || tool.name,
  parameters: tool.inputSchema || { type: 'object', additionalProperties: true }
}));
```

Before each execution use:

```js
const validation = validateDiagnosticCall(call, toolByName);
if (!validation.ok) {
  const blocked = { name: call && call.name, ok: false, error: validation.error };
  toolResults.push(blocked);
  toolMessages.push({
    role: 'tool',
    tool_call_id: callId,
    content: truncateContent(sanitizeDiagnosticValue(blocked), config.maxToolResultChars)
  });
  continue;
}
const { tool, args } = validation;
```

Delete the model-loop branch that creates a confirmation for `tool.mutating`. The separate explicit `confirm(id)` API remains untouched for non-diagnostic workflows; natural-language diagnostics never create confirmation IDs.

For successful/failed model-context results, call `sanitizeDiagnosticValue()` before `truncateContent()`.

- [ ] **Step 4: Run focused tests**

```bash
node --test test/jarvis.test.js test/diagnostic-policy.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit automatic read-only execution**

```bash
git add src/jarvis.js test/jarvis.test.js
git commit -m "feat: execute approved diagnostics from chat"
```

---

### Task 3: Add Bounded Multi-Tool Rounds and Parallel Execution

**Files:**
- Modify: `src/config.js`
- Modify: `.env.example`
- Modify: `src/jarvis.js`
- Modify: `test/jarvis.test.js`
- Modify: `test/integration-contracts.test.js`

**Interfaces:**
- Consumes: Task 2 diagnostic-only model tool list and validated calls.
- Produces: `config.maxDiagnosticRounds` default `4`, `config.maxDiagnosticCalls` default `8`; ordered concurrent execution for calls from the same model turn.

- [ ] **Step 1: Write failing limit and parallelism tests**

Add config assertions to `test/integration-contracts.test.js`:

```js
assert.equal(config.maxDiagnosticRounds, 4);
assert.equal(config.maxDiagnosticCalls, 8);
```

Add JARVIS tests that:

```js
// A model response containing disk_status + network_status executes both,
// returns results in the same order as tool calls, and receives both results
// on the next model turn.

// Repeated tool-calling responses cannot cause more than 4 model/tool rounds.

// A response asking for 10 allowed calls executes at most 8 total calls.
```

For the parallelism test, make the first MCP promise wait on a gate and assert the second call starts before the first resolves; then release the gate and assert `toolResults.map(x => x.name)` still matches model call order.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
node --test test/jarvis.test.js test/integration-contracts.test.js
```

Expected: FAIL because the dedicated limits do not exist and current calls execute sequentially.

- [ ] **Step 3: Add dedicated configuration limits**

In `src/config.js` add:

```js
maxDiagnosticRounds:
  parsePositiveInteger(
    env.JARVIS_MAX_DIAGNOSTIC_ROUNDS,
    4
  ),
maxDiagnosticCalls:
  parsePositiveInteger(
    env.JARVIS_MAX_DIAGNOSTIC_CALLS,
    8
  ),
```

In `.env.example` add:

```text
JARVIS_MAX_DIAGNOSTIC_ROUNDS=4
JARVIS_MAX_DIAGNOSTIC_CALLS=8
```

Keep `maxAgentIterations` for compatibility with any non-diagnostic use; diagnostic conversation uses the new limits.

- [ ] **Step 4: Implement bounded ordered concurrency**

In `conversation()` maintain:

```js
let diagnosticCallCount = 0;
let limitReason = null;
```

Use `config.maxDiagnosticRounds || 4` as the loop bound. Before executing a turn, slice the valid executable calls to remaining capacity:

```js
const remaining = Math.max(0, (config.maxDiagnosticCalls || 8) - diagnosticCallCount);
const scheduled = validatedCalls.slice(0, remaining);
if (validatedCalls.length > scheduled.length) {
  limitReason = 'Maximum diagnostic call limit reached';
}
diagnosticCallCount += scheduled.length;
```

Execute `scheduled` with `Promise.all(scheduled.map(async (...) => ...))`; because `Promise.all` preserves input order, append returned result/message pairs in call order. Blocked/malformed calls do not increment the executed diagnostic count. If no remaining capacity exists, add a bounded tool result stating the limit was reached and stop further execution.

When the 4-round loop exits while the last response still requested tools, set `limitReason = 'Maximum diagnostic round limit reached'`.

- [ ] **Step 5: Run focused tests**

```bash
node --test test/jarvis.test.js test/integration-contracts.test.js
```

Expected: PASS with no more than 4 rounds and 8 executed calls.

- [ ] **Step 6: Commit limits and concurrency**

```bash
git add src/config.js .env.example src/jarvis.js test/jarvis.test.js test/integration-contracts.test.js
git commit -m "feat: bound multi-tool diagnostic investigations"
```

---

### Task 4: Preserve Partial Results, Redact Context, and Add Deterministic Fallbacks

**Files:**
- Modify: `src/jarvis.js`
- Modify: `test/jarvis.test.js`
- Modify: `test/diagnostic-policy.test.js`

**Interfaces:**
- Consumes: Task 1 `sanitizeDiagnosticValue()` and `formatDiagnosticFallback()` plus Task 3 limit state.
- Produces: safe bounded model-context tool messages and useful degraded responses when a provider fails after diagnostics or a loop limit is reached.

- [ ] **Step 1: Add failing resilience tests**

Add tests for all of these cases:

```js
// One of two diagnostic calls rejects while the other succeeds:
// both toolResults exist and the model receives both result messages.

// A tool result containing { token: 'secret', nested: { password: 'secret' } }
// is redacted in the next model payload and the raw secret strings are absent.

// A tool result longer than config.maxToolResultChars is truncated in the next
// model payload and includes the existing "...[truncated N chars]" marker.

// The model succeeds on the tool-selection turn, a diagnostic executes, then
// every retry of the explanation turn fails: conversation returns degraded:true,
// preserves toolResults, and message includes a deterministic diagnostic summary.

// When the 4-round or 8-call limit is hit, conversation returns a useful fallback
// explanation based on collected toolResults rather than an empty/unfinished answer.
```

- [ ] **Step 2: Run focused tests and verify RED**

```bash
node --test test/jarvis.test.js test/diagnostic-policy.test.js
```

Expected: provider-after-tool failure currently returns only `JARVIS brain is currently unavailable`, and limit fallback is not yet complete.

- [ ] **Step 3: Implement safe fallback behaviour**

When `chatError` occurs:

```js
if (toolResults.length) {
  return {
    message: formatDiagnosticFallback(toolResults, chatError.message || String(chatError)),
    toolResults,
    confirmations: [],
    degraded: true,
    error: chatError.message || String(chatError)
  };
}
```

Retain the existing generic unavailable response only when no diagnostic work has completed.

Before any result enters `toolMessages`, apply:

```js
const safeResult = sanitizeDiagnosticValue(result);
content: truncateContent(safeResult, config.maxToolResultChars)
```

When a loop limit ends the investigation with pending tool calls, return `formatDiagnosticFallback(toolResults, limitReason)` as the message and set `degraded: true`; do not execute further tools.

- [ ] **Step 4: Run focused resilience tests**

```bash
node --test test/jarvis.test.js test/diagnostic-policy.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit resilience behaviour**

```bash
git add src/jarvis.js test/jarvis.test.js test/diagnostic-policy.test.js
git commit -m "feat: preserve diagnostic results on degraded responses"
```

---

### Task 5: Add Model Guidance for Clear Diagnostic Explanations

**Files:**
- Modify: `src/jarvis.js`
- Modify: `test/jarvis.test.js`

**Interfaces:**
- Consumes: existing `buildChatRequest()` memory/vault system hints.
- Produces: one additional system hint instructing the model how to select and explain live diagnostics without inventing state.

- [ ] **Step 1: Write a failing prompt-contract test**

Add:

```js
test('diagnostic chat prompt requires live evidence and plain-language explanations', async () => {
  const { jarvis, chats } = setup();
  await jarvis.conversation({
    conversation: [{ role: 'user', content: 'Why is streaming slow?' }]
  });
  const systemText = chats[0].conversation
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n');
  assert.match(systemText, /use the available read-only diagnostic tools/i);
  assert.match(systemText, /do not invent live system state/i);
  assert.match(systemText, /distinguish confirmed findings from suspected causes/i);
  assert.match(systemText, /plain language/i);
});
```

- [ ] **Step 2: Run the test and verify RED**

```bash
node --test test/jarvis.test.js
```

Expected: FAIL because the diagnostic system hint is absent.

- [ ] **Step 3: Add the diagnostic system hint**

In `buildChatRequest()`, always prepend a concise system hint when diagnostic tools are available:

```js
systemHints.unshift(
  'You are JARVIS operating in read-only diagnostic mode. ' +
  'When the operator asks about current system state, use the available read-only diagnostic tools rather than guessing. ' +
  'Use the minimum checks needed, but combine multiple diagnostics when useful. ' +
  'Do not invent live system state and do not request write, restart, deploy, shell, or other mutating actions. ' +
  'After tool results arrive, explain the important findings in plain language, mention failed checks, and distinguish confirmed findings from suspected causes.'
);
```

Do not remove or reorder the actual user conversation; keep existing memory/vault hints functional.

- [ ] **Step 4: Run prompt and memory/vault regression tests**

```bash
node --test test/jarvis.test.js test/vault.test.js test/brain.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit explanation guidance**

```bash
git add src/jarvis.js test/jarvis.test.js
git commit -m "feat: guide jarvis diagnostic reasoning"
```

---

### Task 6: Full Regression and Release Gate

**Files:**
- Modify: `README.md` only if current operator documentation describes chat/tool behaviour.
- No production files outside the JARVIS repository.

**Interfaces:**
- Consumes: Tasks 1-5.
- Produces: a verified feature branch ready for review/merge; no production deployment in this task.

- [ ] **Step 1: Add concise operator documentation if applicable**

If README has a capabilities section, add exactly the behaviour now implemented: natural-language read-only diagnostics, examples (`Check DripVid health`, `How much disk space do we have?`, `Are any services unhealthy?`), 4-round/8-call limits, and explicit statement that restart/deploy/write/shell operations are not auto-executable. Do not document capabilities that are not implemented.

- [ ] **Step 2: Run the complete test suite**

```bash
npm test
```

Expected: all tests PASS, zero failures.

- [ ] **Step 3: Run syntax/static checks**

```bash
npm run check
git diff --check
```

Expected: both commands exit 0.

- [ ] **Step 4: Review the branch diff for the safety boundary**

Run:

```bash
git --no-pager diff main...HEAD -- src test .env.example README.md package.json
git grep -nE 'restart|deploy|shell|vault\.write|vault\.migrate' -- src test
```

Verify manually from the diff that automatic model tool exposure comes only from `selectAutomaticDiagnosticTools()`, blocked tools create no confirmation, no secret values are logged, and no production/network/auth binding changed.

- [ ] **Step 5: Commit documentation if changed**

```bash
git add README.md
git diff --cached --quiet || git commit -m "docs: document natural-language diagnostics"
```

- [ ] **Step 6: Final verification evidence**

Re-run after the final commit:

```bash
npm test
npm run check
git diff --check
git status --short
git --no-pager log -5 --oneline
```

Expected: tests/check/diff all clean and worktree has no uncommitted changes.

- [ ] **Step 7: Prepare live smoke-test commands but do not deploy yet**

After merge/deployment approval, the production smoke gate must exercise these authenticated JARVIS chat requests through the existing `/jarvis` route:

```text
Check DripVid health.
How much disk space do we have?
Are any services unhealthy?
```

For each, verify the response contains real diagnostic evidence and a clear explanation. Also verify `ss -ltnp` still shows JARVIS only on `127.0.0.1:3342`, `/jarvis` remains Admin/Owner protected, and no unrelated service was restarted.
