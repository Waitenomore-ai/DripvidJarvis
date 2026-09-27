# Employee definitions

Every file in this directory becomes a JARVIS agent. Definitions are discovered
at startup, so **adding an agent is a data change, not a code change** -- drop
in a new file and restart. Nothing here needs to be registered by hand.

## Adding an agent

Create `<id>.json` (preferred) or `<id>.js`:

```json
{
  "id": "marketing",
  "name": "Marketing",
  "role": "Messaging and content",
  "room": "growth",
  "avatar": "megaphone",
  "systemPrompt": "Draft on-brand copy. Never invent customer metrics.",
  "capabilities": ["draft", "rewrite"],
  "toolAllowlist": ["brain.recall", "vault.read", "vault.write"],
  "approvalRules": { "vault.write": true }
}
```

### Fields

| Field | Required | Notes |
|---|---|---|
| `id` | yes | Unique, filename-derived convention, lowercase |
| `name` | yes | Display name in the Agent Deck |
| `systemPrompt` | yes | The employee's standing instructions |
| `role` | yes | One line, shown on the card |
| `capabilities` | yes | Free-form labels for routing |
| `toolAllowlist` | yes | `["*"]` only for the lead. Everyone else gets an explicit list |
| `room` | no | Grouping, defaults to `main` |
| `avatar` | no | Icon key, defaults to `default` |
| `approvalRules` | no | Per-tool approval override. **Fails closed**: anything not positively identified as read-only needs operator approval |
| `lead` | no | `true` makes this the team lead. Exactly one should set it |

## Rules the code enforces

- `toolAllowlist` names are validated against the live tool catalog in
  `test/workforce-roster.test.js`, so a typo cannot silently grant or deny a tool.
- A malformed file is skipped and reported through `definitionErrors()` rather
  than thrown, so one bad definition cannot stop JARVIS from booting. The Agent
  Deck surfaces these.
- Employees are **least privilege**. Only the lead holds `["*"]`.
