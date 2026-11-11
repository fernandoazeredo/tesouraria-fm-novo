import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';
import { changeClassification } from '../financial-actions.js';
import { classificationTarget } from '../financial-query.js';

const account = classificationTarget('Classifique a conta de luz na conta 4.07.05');
const version = new Timestamp(100, 0);
const appliedVersion = new Timestamp(110, 0);
const expense = { competencia: '2026-11', fornecedor: 'Light', status: 'pago', valorTotal: 12.34 };
const previous = { confirmed: true, accountCode: '4.05.27', accountName: 'Telefonia Fixa e Internet' };
const profile = { displayName: 'Master', email: 'master@example.com' };
const targets = [
  { sourceId: 'a', sourceVersion: version, classificationVersion: version },
  { sourceId: 'b', sourceVersion: version, classificationVersion: null },
];

function fixture(data, time) {
  const writes = [];
  const collection = prefix => ({ doc: (id = 'audit') => ({
    id, path: prefix + '/' + id, collection: name => collection(prefix + '/' + id + '/' + name),
  }) });
  const db = { collection };
  const tx = {
    getAll: async (...refs) => refs.map(ref => {
      const found = data[ref.path];
      return { exists: Boolean(found), data: () => found?.value, updateTime: found?.version };
    }),
  };
  for (const op of ['set', 'create', 'update', 'delete']) tx[op] = (ref, value) => writes.push({ op, path: ref.path, value });
  return { db, tx, writes, snapshot: { ref: db.collection('executiveAiProposals').doc('proposal'), updateTime: time } };
}

test('confirmar salva cada classificação, os valores anteriores e a auditoria na mesma transação', async () => {
  const { db, tx, writes, snapshot } = fixture({
    'expenses/a': { value: expense, version },
    'expenses/b': { value: expense, version },
    'managerialClassifications/expense__a': { value: previous, version },
  }, version);
  await changeClassification(db, tx, snapshot, { account, targets, uid: 'master' }, profile, 'apply');
  assert.deepEqual(writes.filter(write => write.path.startsWith('managerialClassifications/')).map(write => write.value.accountCode), ['4.07.05', '4.07.05']);
  assert.deepEqual(writes.find(write => write.path.endsWith('/anteriores/a')).value, { existed: true, data: previous });
  assert.equal(writes.find(write => write.path === 'executiveAiProposals/proposal').value.status, 'aplicada');
  assert.equal(writes.at(-1).path, 'auditLogs/audit');
});

test('desfazer restaura a classificação anterior, remove a criada e registra auditoria', async () => {
  const { db, tx, writes, snapshot } = fixture({
    'managerialClassifications/expense__a': { value: account, version: appliedVersion },
    'managerialClassifications/expense__b': { value: account, version: appliedVersion },
    'executiveAiProposals/proposal/anteriores/a': { value: { existed: true, data: previous }, version: appliedVersion },
    'executiveAiProposals/proposal/anteriores/b': { value: { existed: false, data: null }, version: appliedVersion },
  }, appliedVersion);
  await changeClassification(db, tx, snapshot, { account, targets, uid: 'master' }, profile, 'undo');
  assert.deepEqual(writes.find(write => write.path === 'managerialClassifications/expense__a').value, previous);
  assert.equal(writes.find(write => write.path === 'managerialClassifications/expense__b').op, 'delete');
  assert.equal(writes.find(write => write.path === 'executiveAiProposals/proposal').value.status, 'desfeita');
  assert.equal(writes.at(-1).path, 'auditLogs/audit');
});

test('qualquer mudança concorrente impede a gravação de todo o lote', async () => {
  const { db, tx, writes, snapshot } = fixture({
    'expenses/a': { value: expense, version },
    'expenses/b': { value: expense, version: appliedVersion },
    'managerialClassifications/expense__a': { value: previous, version },
  }, version);
  await assert.rejects(changeClassification(db, tx, snapshot, { account, targets, uid: 'master' }, profile, 'apply'), { code: 'aborted' });
  assert.equal(writes.length, 0);
});
