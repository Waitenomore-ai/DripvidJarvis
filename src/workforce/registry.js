'use strict';

const { createEmployee } = require('./employee');
const { clone, snapshotEmployee } = require('./state');

const DEFAULT_EMPLOYEES = [
  { id:'jarvis', name:'JARVIS', role:'Team Leader', room:'command-centre', description:'Coordinates the AI workforce.', capabilities:['delegate','plan','coordinate'] },
  { id:'sosh', name:'Sosh', role:'Social Media Manager', room:'social-studio', description:'Creates and manages social campaigns.', capabilities:['social','campaigns','publishing'] },
  { id:'scout', name:'Scout', role:'Research & Trends', room:'research-lab', description:'Researches trends, audiences and useful sources.', capabilities:['research','web','knowledge'] },
  { id:'dev', name:'Dev', role:'Developer', room:'dev-workshop', description:'Builds, tests and improves DripVid.', capabilities:['development','testing','github'] },
  { id:'ops', name:'Ops', role:'Infrastructure & Operations', room:'ops-room', description:'Monitors services and operational health.', capabilities:['monitoring','incidents','infrastructure'] }
];

function createWorkforceRegistry(definitions = DEFAULT_EMPLOYEES) {
  const employees = new Map(definitions.map(def => {
    const employee = createEmployee(def);
    return [employee.id, employee];
  }));
  const runtime = new Map();
  return {
    list() { return [...employees.values()].map(e => snapshotEmployee(e, runtime.get(e.id))); },
    get(id) { const e = employees.get(id); return e ? snapshotEmployee(e, runtime.get(id)) : null; },
    setState(id, state, currentTaskId = null) {
      if (!employees.has(id)) throw new Error(`Unknown employee: ${id}`);
      runtime.set(id, { state, currentTaskId });
      return this.get(id);
    },
    snapshot() { return clone(this.list()); }
  };
}

module.exports = { DEFAULT_EMPLOYEES, createWorkforceRegistry };
