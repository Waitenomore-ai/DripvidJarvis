'use strict';

const fs = require('node:fs');
const path = require('node:path');

function createWorkforcePersistence({ statePath, now = () => new Date().toISOString() } = {}) {
  if (!statePath) return null;

  function load() {
    try {
      const raw = fs.readFileSync(statePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      return parsed;
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw new Error(`Workforce state could not be loaded: ${error.message}`);
    }
  }

  function save(state) {
    const directory = path.dirname(statePath);
    fs.mkdirSync(directory, { recursive: true, mode: 0o750 });

    const temporary = `${statePath}.tmp-${process.pid}`;
    const payload = JSON.stringify({
      version: 1,
      savedAt: now(),
      tasks: state.tasks || [],
      workflows: state.workflows || [],
      activity: (state.activity || []).slice(0, 30)
    }, null, 2);

    fs.writeFileSync(temporary, payload, { encoding: 'utf8', mode: 0o640 });
    fs.renameSync(temporary, statePath);
  }

  return { load, save };
}

module.exports = { createWorkforcePersistence };
