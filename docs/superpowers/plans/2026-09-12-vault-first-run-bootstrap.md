# JARVIS Vault First-Run Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A fresh JARVIS install starts with the vault ONLINE instead of `degraded (vault path missing)`, so the HUD vault panel, brain-to-vault auto-mirror, and vault search work out of the box.

**Observations (current behaviour):**
- `JARVIS_VAULT_PATH` defaults to `vault/` next to the repo.
- On a fresh install that folder does not exist, so `vault.health()` reports `degraded`/`vault path missing`, the HUD shows Vault OFFLINE, and the welcome experience is broken until the operator manually creates the folder.
- The vault is app-managed: `vault.write` and `vault.migrateFromBrain` already create missing directories, and the test suite's fixture already seeds a `Welcome.md` note at the vault root.

**Architecture:** Keep `src/vault.js` as the boundary. Add a tiny self-initialization path that runs only for the app-determined default vault (never for an explicitly configured `JARVIS_VAULT_PATH`). `loadConfig` records whether the operator set the path (`vaultPathConfigured`); `createVault` uses that flag to decide whether a missing root is a first-run state (bootstrap) or a real configuration error (keep `degraded`).

**Tech Stack:** Node.js 22+, CommonJS, built-in `node:test`, existing `vault.js`/`config.js` modules.

## Global Constraints

- Never modify a vault whose path was explicitly configured (`JARVIS_VAULT_PATH` set): a missing configured path remains `degraded` with the existing error.
- Bootstrap is synchronous and confined to the vault root: it creates the root folder and one `Welcome.md` note (frontmatter + markdown body), then indexes it.
- The note is searchable and count/capacity/read limits still apply. Existing health/stats/reindex/search/write/migrate contracts are unchanged.
- No secrets, no network calls, no changes to HUD/API surface.
- `vault/` and `data/` are already gitignored, so runtime bootstrap artifacts are never committed.

---

### Task 1: Record whether the vault path was explicitly configured

**Files:**
- Modify: `src/config.js`

- [x] **Step 1: Add the flag**
  In `loadConfig`, next to `vaultPath`, add:

  ```js
  vaultPathConfigured:
    Boolean(env.JARVIS_VAULT_PATH),
  ```

  `String(env.JARVIS_VAULT_PATH)` truthy (non-empty) → configured. Left unset (the default path) → `false`.

- [x] **Step 2: Commit the flag**
  `git commit -m "feat: track whether the vault path was explicitly configured"`

---

### Task 2: Bootstrap the default vault with a welcome note

**Files:**
- Modify: `src/vault.js`

- [x] **Step 1: Add the welcome note constant**
  Near the top of `src/vault.js`:

  ```js
  const WELCOME_PATH = 'Welcome.md';
  const WELCOME_CONTENT = [
    '---',
    'title: Welcome',
    'tags: [jarvis, memory]',
    '---',
    '',
    '# Welcome',
    '',
    'This vault was created by JARVIS so it can remember and understand the operator.',
    '',
    '- Facts you ask JARVIS to remember are mirrored here as notes under `Memories/`.',
    '- Edit notes in Obsidian or any markdown editor; JARVIS re-indexes automatically.',
    '- JARVIS searches this vault before answering to bring relevant notes into context.'
  ].join('\n') + '\n';
  ```

- [x] **Step 2: Add the bootstrap helper**
  Gate on `config.vaultPathConfigured === false` (strict) so existing callers that do not pass the flag (tests) keep their current behaviour:

  ```js
  function ensureBootstrap() {
    if (config.vaultPathConfigured !== false) return;
    if (fs.existsSync(root)) return;
    write(WELCOME_PATH, WELCOME_CONTENT);
  }
  ```

  `write()` already creates missing directories, indexes the note, and persists the index.

- [x] **Step 3: Run bootstrap on first access**
  Call `ensureBootstrap()` from `ensureLoaded()`, so every vault operation (health, stats, search, read, write, migrate, reindex) gets the same first-run initialisation:

  ```js
  function ensureLoaded() {
    if (!loaded) {
      loaded = true;
      loadIndex();
    }
    ensureBootstrap();
  }
  ```

  No recursion: `write()` calls `ensureLoaded()`, which no-ops after the first pass. `health()` and `stats()` then see the note and report `online`.

- [x] **Step 4: Commit the bootstrap**
  `git commit -m "feat: bootstrap the default vault on first run"`

---

### Task 3: Lock the behaviour with tests

**Files:**
- Modify: `test/vault.test.js`

- [x] **Step 1: Add the bootstrap tests**
  Append to `test/vault.test.js`:

  ```js
  test('default vault bootstraps root, welcome note, and health on first run', async () => {
    const dir =
      fs.mkdtempSync(
        path.join(os.tmpdir(), 'jarvis-vault-bootstrap-')
      );

    const vaultDir = path.join(dir, 'vault');

    const vault = createVault({
      config: {
        vaultPath: vaultDir,
        vaultIndexPath: path.join(dir, 'data', 'index.json'),
        vaultSearchLimit: 5,
        vaultReadMaxChars: 16000,
        vaultPathConfigured: false
      }
    });

    assert.equal(
      fs.existsSync(vaultDir),
      false
    );

    const health = vault.health();

    assert.equal(health.status, 'online');
    assert.equal(health.noteCount, 1);
    assert.ok(fs.existsSync(path.join(vaultDir, 'Welcome.md')));

    const notes = await vault.search('remember');

    assert.ok(
      notes.some((note) => note.path === 'Welcome.md')
    );
  });

  test('explicitly configured missing vault path is never auto-created', async () => {
    const dir =
      fs.mkdtempSync(
        path.join(os.tmpdir(), 'jarvis-vault-configured-')
      );

    const vaultDir = path.join(dir, 'does-not-exist');

    const vault = createVault({
      config: {
        vaultPath: vaultDir,
        vaultIndexPath: path.join(dir, 'data', 'index.json'),
        vaultPathConfigured: true
      }
    });

    const result = vault.health();

    assert.equal(result.status, 'degraded');
    assert.equal(
      fs.existsSync(vaultDir),
      false
    );
  });
  ```

- [x] **Step 2: Run the focused tests and syntax check**

  ```bash
  node --test test/vault.test.js
  node --check src/vault.js
  ```

  Expected: all PASS for the new tests and the existing missing-path/health tests.

- [x] **Step 3: Commit the tests**
  `git commit -m "test: lock vault first-run bootstrap behaviour"`

---

### Task 4: Document the vault environment variables

**Files:**
- Modify: `.env.example`
- Modify: `README.md`

- [x] **Step 1: Add a vault section to `.env.example`**

  ```text
  # Obsidian vault for operator memory. Defaults to vault/ (auto-created on
  # first run with a welcome note). An explicitly configured path is used
  # as-is and is never auto-created: it must already exist (or be mounted).
  JARVIS_VAULT_PATH=
  JARVIS_VAULT_INDEX_PATH=
  JARVIS_VAULT_SEARCH_LIMIT=5
  JARVIS_VAULT_READ_MAX_CHARS=16000
  ```

- [x] **Step 2: Update the README Vault section**
  Note under the existing paragraph: when `JARVIS_VAULT_PATH` is left unset the default `vault/` folder is created automatically on first run with a `Welcome.md` note.

- [x] **Step 3: Commit docs**
  `git commit -m "docs: document vault first-run bootstrap"`

---

### Task 5: Full Regression and Release Gate

- [x] **Step 1: Run the complete test suite**

  ```bash
  npm test
  ```

  Expected: all tests PASS, zero failures.

- [x] **Step 2: Run syntax/static checks**

  ```bash
  npm run check
  git diff --check
  ```

  Expected: both commands exit 0.

- [x] **Step 3: Review the diff for the safety boundary**

  ```bash
  git --no-pager diff main...HEAD -- src test .env.example README.md
  ```

  Verify: bootstrap runs only when `config.vaultPathConfigured === false` and the root is missing; explicit paths are never touched; no secrets/network changes; vault artifacts remain gitignored.

- [x] **Step 4: Final verification evidence and push**

  ```bash
  npm test
  npm run check
  git status --short
  git --no-pager log -5 --oneline
  git push origin main
  ```

  Expected: tests/check clean, worktree has no uncommitted changes, push succeeds.