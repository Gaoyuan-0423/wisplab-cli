import assert from 'node:assert/strict';
import { readEngineLock, checkEngineRevision } from '../../engine-lock.mjs';

export function assertVerifiedEngine(name, path, externalRevision) {
  const entry = readEngineLock().engines[name];
  const lock = externalRevision ? { ...entry, revision: externalRevision } : entry;
  const state = checkEngineRevision(path, lock);
  assert.equal(state.verified, true, `Expected a clean locked ${name} engine: ${JSON.stringify(state)}`);
  return state;
}
