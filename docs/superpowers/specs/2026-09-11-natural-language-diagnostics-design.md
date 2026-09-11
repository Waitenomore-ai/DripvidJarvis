# JARVIS Natural-Language Diagnostics Design

Date: 2026-09-11
Status: Approved design for implementation
Branch: feature/natural-language-diagnostics
Base: a924d1b98a3f49ed1960fd3cf8497b4a53fbc2c9

## Objective

Make JARVIS reliably turn ordinary operator requests into real, read-only diagnostics using the existing DripVid and MCP tools, then explain the findings clearly in chat.

Examples that must work:

- "Check DripVid health."
- "How much disk space do we have?"
- "Show me recent DripVid errors."
- "Is MCP running properly?"
- "Check all JARVIS dependencies."
- "Why is streaming slow?"
- "Are any services unhealthy?"
- "Check storage and tell me if anything needs attention."

## Existing Architecture

JARVIS already has:

- a model adapter that can advertise function tools and parse model tool calls;
- a model router with primary/fallback provider support;
- a central conversation orchestration loop;
- existing DripVid and MCP adapters;
- read-only diagnostic MCP tools;
- memory and vault tools;
- a live HUD at `/jarvis` through DripVid authentication;
- production JARVIS bound to localhost only.

This project extends the existing orchestration rather than adding a second agent runtime.

## Security Boundary

Natural-language diagnostic execution is restricted to a dedicated automatic diagnostic allowlist.

The automatic allowlist is:

- `dripvid.health`
- `mcp.server_info`
- `mcp.disk_status`
- `mcp.network_status`
- `mcp.service_status`
- `mcp.service_logs`
- `mcp.http_health`
- `mcp.dripvid_health`
- `mcp.dripvid_git_status`
- `mcp.dripvid_config`

Only these tools may execute automatically as part of a natural-language diagnostic request.

The following must never auto-execute in this release:

- shell commands;
- service restart/stop/start actions;
- deployments;
- source-code writes;
- configuration writes;
- environment/secret access;
- filesystem mutation;
- account/member mutation;
- database mutation;
- media mutation;
- vault writes or migrations;
- memory deletion;
- unknown tools;
- any tool marked mutating.

Unknown or non-allowlisted tools must be treated as unavailable to the model for this diagnostic loop, even if another subsystem knows about them.

`mcp.dripvid_config` may be exposed only through the existing secret-redaction path. No secret-bearing raw configuration may be inserted into model context.

## Tool Exposure Model

The conversation layer must separate all discovered JARVIS tools from the smaller set of tools eligible for automatic diagnostics.

The model receives only the automatic diagnostic allowlist for this feature when determining read-only diagnostic actions.

Memory and vault context may continue to enrich normal responses, but memory/vault mutation tools must not be mixed into the automatic diagnostic tool set.

This prevents a natural-language diagnostic request from accidentally expanding into unrelated capabilities.

## Diagnostic Execution Loop

For each operator request:

1. Build the conversation context from the existing chat history.
2. Add relevant memory/vault hints as currently supported.
3. Build the automatic diagnostic tool list from the approved allowlist.
4. Send the request and allowed tools to the active model provider.
5. If the model returns no tool calls, return its normal answer.
6. If the model returns tool calls:
   - validate every call against the automatic diagnostic allowlist;
   - validate that the resolved tool is non-mutating;
   - execute valid calls;
   - collect success/failure results;
   - append assistant tool-call metadata and tool results to the model conversation;
   - ask the model to interpret the results.
7. Continue until the model returns a final answer or a safety limit is reached.

## Loop Limits

A single operator request is limited to:

- maximum 4 model/tool rounds;
- maximum 8 executed diagnostic tool calls total.

When either limit is reached, JARVIS must stop executing tools and return a concise explanation based on the results collected so far.

The model must not be allowed to continue requesting tools indefinitely.

## Tool-Call Validation

Before execution, each requested call must pass all checks:

- call object exists;
- tool name is a string;
- tool name resolves to a known tool;
- tool name is in the automatic diagnostic allowlist;
- tool is not marked mutating;
- arguments are an object;
- required input fields are present when the local schema can validate them cheaply.

A rejected call is recorded as a failed tool result and is not executed.

A model attempting to call a blocked tool must not create a confirmation request in this feature. It should receive a tool result indicating that the requested action is unavailable in read-only diagnostic mode.

## Parallelism

Independent tool calls returned in the same model turn may execute concurrently when safe.

Examples:

- disk status + network status + DripVid health can run in parallel;
- a log read that depends on the model first learning a service name may happen in a later round.

The implementation should preserve result ordering by tool-call order even if execution is concurrent.

## Error Handling

One failed diagnostic must not fail the entire operator request.

For each tool execution, JARVIS records:

- tool name;
- success/failure;
- sanitized result or error;
- duration where practical.

The final model pass receives successful and failed results so it can explain partial findings.

Examples:

- "Disk and network checks succeeded, but service logs were unavailable."
- "DripVid is reachable; MCP timed out, so I could not verify its tool server state."

If the model provider fails entirely after diagnostics already ran, JARVIS must return a deterministic fallback summary containing the tool names, success/failure state, and concise sanitized results rather than discarding the work.

## Result Size and Sanitization

Tool results inserted into model context must be bounded.

Use the existing truncation helper or equivalent to cap large output such as logs. The implementation should prefer a default per-result cap around 4,000 characters unless an existing configuration value is already used for this purpose.

Sensitive values must be redacted before entering model context. This includes API keys, bearer tokens, passwords, cookies, authorization headers, session secrets, and database URLs.

Recent logs should be summarized by the model rather than dumped verbatim into the HUD unless the operator explicitly asks to inspect raw output.

## Final Answer Contract

A successful diagnostic answer should normally contain:

1. a direct answer to the operator's question;
2. the important finding(s);
3. warnings/errors if present;
4. a short indication of which diagnostics were used;
5. a sensible next read-only check if uncertainty remains.

The UI should receive the existing conversation response shape and not require a separate diagnostic page.

Raw JSON should not be the default user-facing answer.

## Example Behaviours

### Check DripVid health

Operator:
"Check DripVid health."

Expected tool use:
- `mcp.dripvid_health` or `dripvid.health`

Expected response style:
"DripVid is reachable. Its application health endpoint requires an authenticated session, while the underlying service is responding normally."

### Disk usage

Operator:
"How much disk space do we have?"

Expected tool use:
- `mcp.disk_status`

Expected response style:
"Storage is healthy. The main volume has X free of Y total. No immediate capacity warning is detected."

### Recent errors

Operator:
"Show me recent DripVid errors."

Expected tool use:
- `mcp.service_logs` with a DripVid service selector when supported
- optionally `mcp.service_status`

Expected response style:
Summarize recent errors and their likely operational meaning; do not dump large logs by default.

### Why is streaming slow?

Expected multi-tool sequence may include:
- `mcp.dripvid_health`
- `mcp.service_status`
- `mcp.service_logs`
- `mcp.disk_status`
- `mcp.network_status`

JARVIS should correlate the results and clearly distinguish evidence from inference.

## Model Behaviour Guidance

The model prompt/context should explicitly state:

- use tools when live system state is needed;
- do not invent service state;
- prefer the minimum diagnostics needed to answer well;
- multiple read-only diagnostics are allowed when useful;
- never request write/restart/deploy/shell operations in read-only mode;
- after receiving tool results, explain them in plain language;
- distinguish confirmed findings from suspected causes.

## Observability

Each diagnostic request should emit lightweight structured activity information through the existing activity/event mechanisms where available.

At minimum capture:

- operator request start;
- diagnostic tool names selected;
- success/failure per tool;
- limit reached event, if any;
- final response completion/failure.

Do not log secrets or raw authorization material.

## Compatibility

This change must preserve:

- `/jarvis` Admin/Owner authentication;
- localhost-only JARVIS binding;
- the current HUD and voice work;
- model fallback routing;
- existing brain/vault context features;
- existing read-only MCP safety classification;
- current API response shapes unless a backward-compatible additive field is useful.

No nginx change is required.

## Testing Requirements

Tests must cover at least:

1. a natural-language request can trigger a known read-only diagnostic tool;
2. multiple read-only tools can execute in one request;
3. tool results are passed back to the model for a final explanation;
4. mutating tools are not exposed to the automatic diagnostic model tool list;
5. a model-requested mutating or unknown tool is blocked and not executed;
6. maximum 4 rounds is enforced;
7. maximum 8 tool executions is enforced;
8. one tool failure does not prevent other diagnostics from completing;
9. large tool results are truncated before being re-sent to the model;
10. secret-bearing config values remain redacted;
11. provider failure after tool execution produces a deterministic fallback summary;
12. normal non-tool conversation still works;
13. current brain/vault context injection continues to work;
14. existing API and HUD tests remain green.

## Deployment Gate

Before production deployment:

- full JARVIS test suite passes;
- syntax/check script passes;
- diff check passes;
- review confirms only read-only diagnostics auto-execute;
- live smoke test verifies at least:
  - "Check DripVid health";
  - "How much disk space do we have?";
  - "Are any services unhealthy?";
- JARVIS remains bound to `127.0.0.1:3342`;
- `/jarvis` remains Admin/Owner protected through DripVid;
- no DripVid, MCP, Tech-AI, nginx, or other service is restarted except when separately required and explicitly approved by deployment procedure.

## Non-Goals

Not part of this release:

- autonomous remediation;
- service restarts;
- code editing;
- deployment actions;
- shell access;
- write-capable MCP tools;
- account/media/database mutation;
- automatic vault writes;
- unrestricted agent loops.

Those require separate design and approval.
