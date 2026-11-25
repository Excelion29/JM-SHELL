import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEpicsJql, buildStoriesJql, filterByProject, isValidProjectKey, sortByKey, toBrowseItem } from './browse';
import { isValidIssueKey } from './state';

test('buildEpicsJql arma el JQL con un proyecto válido', () => {
  assert.equal(buildEpicsJql('AQ'), 'project = AQ AND issuetype = Epic ORDER BY rank ASC');
});

test('buildEpicsJql rechaza claves de proyecto inválidas o con inyección', () => {
  for (const bad of ['', 'aq', 'A', '1AQ', 'AQ" OR 1=1', 'AQ-1']) {
    assert.throws(() => buildEpicsJql(bad), /no es válida/, bad);
  }
  assert.equal(isValidProjectKey('AQ2'), true);
});

test('buildStoriesJql cubre épica y sin épica, excluyendo subtareas', () => {
  assert.equal(
    buildStoriesJql('AQ', 'AQ-1'),
    'parent = AQ-1 AND issuetype not in subtaskIssueTypes() ORDER BY updated DESC',
  );
  const orphan = buildStoriesJql('AQ', null);
  assert.ok(orphan.includes('parent is EMPTY') && orphan.includes('issuetype != Epic'));
});

test('buildStoriesJql rechaza claves de épica inválidas', () => {
  assert.throws(() => buildStoriesJql('AQ', 'AQ-1 OR project = X'), /no es válida/);
  assert.throws(() => buildStoriesJql('aq', null), /no es válida/);
});

test('claves con guion bajo son válidas, la inyección sigue rechazada', () => {
  assert.equal(isValidProjectKey('MY_APP'), true);
  assert.equal(isValidIssueKey('MY_APP-12'), true);
  assert.equal(buildEpicsJql('MY_APP'), 'project = MY_APP AND issuetype = Epic ORDER BY rank ASC');
  assert.equal(buildStoriesJql('MY_APP', 'MY_APP-12').startsWith('parent = MY_APP-12'), true);
  assert.throws(() => buildEpicsJql('MY_APP" OR 1=1'), /no es válida/);
  assert.equal(isValidIssueKey('MY_APP-12 OR x'), false);
});

test('filterByProject deja solo las historias del proyecto indicado', () => {
  const all = [{ key: 'AQ-1' }, { key: 'AQX-2' }, { key: 'ZX-3' }];
  assert.deepEqual(filterByProject(all, 'AQ'), [{ key: 'AQ-1' }]);
  assert.deepEqual(filterByProject(all, null), all);
});

test('sortByKey ordena por el número de la clave, de menor a mayor', () => {
  const items = ['PGC-25', 'PGC-24', 'PGC-100', 'PGC-15', 'PGC-9'].map((key) => ({ key }));
  assert.deepEqual(
    sortByKey(items).map((item) => item.key),
    ['PGC-9', 'PGC-15', 'PGC-24', 'PGC-25', 'PGC-100'],
  );
  assert.equal(items[0].key, 'PGC-25', 'no cambia el arreglo original');
});

test('toBrowseItem guarda el tipo de Jira para pintar la clave', () => {
  const issue = {
    id: '1',
    key: 'PGC-325',
    fields: {
      summary: 'Falla al exportar',
      status: { name: 'Por hacer' },
      assignee: null,
      duedate: null,
      timeoriginalestimate: null,
      issuetype: { name: 'Error' },
    },
  };
  assert.deepEqual(toBrowseItem(issue), {
    key: 'PGC-325',
    summary: 'Falla al exportar',
    status: 'Por hacer',
    type: 'Error',
  });
});
