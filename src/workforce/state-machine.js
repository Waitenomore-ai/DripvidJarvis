'use strict';

const STATES = Object.freeze([
  'idle',
  'thinking',
  'researching',
  'working',
  'waiting',
  'needs-input',
  'alert',
  'complete'
]);

const TRANSITIONS = Object.freeze({
  idle: Object.freeze(['thinking', 'alert']),
  thinking: Object.freeze([
    'researching',
    'working',
    'waiting',
    'needs-input',
    'alert',
    'complete',
    'idle'
  ]),
  researching: Object.freeze([
    'thinking',
    'working',
    'alert',
    'complete',
    'idle'
  ]),
  working: Object.freeze([
    'thinking',
    'waiting',
    'needs-input',
    'alert',
    'complete'
  ]),
  waiting: Object.freeze([
    'thinking',
    'working',
    'needs-input',
    'complete'
  ]),
  'needs-input': Object.freeze([
    'thinking',
    'working',
    'waiting',
    'complete',
    'idle'
  ]),
  alert: Object.freeze(['thinking', 'working', 'idle', 'complete']),
  complete: Object.freeze(['idle', 'thinking'])
});

function isState(value) {
  return STATES.includes(value);
}

function allowedFrom(from) {
  const next = TRANSITIONS[from];
  return next ? next.slice() : [];
}

function canTransition(from, to) {
  if (!isState(from) || !isState(to)) {
    return false;
  }

  if (from === to) {
    return true;
  }

  return TRANSITIONS[from].includes(to);
}

function assertTransition(from, to) {
  if (!isState(from)) {
    throw new Error(`unknown workforce state: ${from}`);
  }

  if (!isState(to)) {
    throw new Error(`unknown workforce state: ${to}`);
  }

  if (!canTransition(from, to)) {
    throw new Error(`invalid workforce transition: ${from} -> ${to}`);
  }

  return to;
}

module.exports = {
  STATES,
  TRANSITIONS,
  isState,
  canTransition,
  assertTransition,
  allowedFrom
};
