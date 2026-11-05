import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectKeyOfStory } from './repos';

test('la clave del proyecto sale de la clave de la historia', () => {
  assert.equal(projectKeyOfStory('AQ-45'), 'AQ');
  assert.equal(projectKeyOfStory('AQ'), 'AQ');
});
