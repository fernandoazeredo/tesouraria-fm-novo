import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';
import { changeClassification, runFinancial } from '../financial-actions.js';
import { classificationTarget, financialRequest } from '../financial-query.js';

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


test('responde receitas e despesas com todos os registros fictícios do período', async () => {
  const expenseDocs = Array.from({ length: 504 }, (_, index) => ({
    id: String(index),
    data: () => ({ ...expense, competencia: index === 503 ? '2025-11' : '2026-11', valorTotal: index === 503 ? 1000 : 10 }),
  }));
  const classDocs = expenseDocs.map(doc => ({
    id: 'expense__' + doc.id,
    data: () => ({ confirmed: true, accountCode: account.code, accountName: account.name, accountDre: account.dre }),
  }));
  const alvara = { origem: 'Alvará Judicial', natureza: 'Trabalhista', status: 'recebido_tesouraria', processo: 'Fictício', reclamante: 'Pessoa' };
  const revenueDocs = [
    { data: () => ({ ...alvara, receiptDate: '2026-01-14', valorAlvara: 32500 }) },
    { data: () => ({ ...alvara, receiptDate: '2025-01-14', valorAlvara: 7000 }) },
    { data: () => ({ tipoRecebimento: 'acordo_trabalhista', status: 'encerrado', parcelas: [{ dataRealizada: '2026-03-14', valorParcela: 12500 }] }) },
  ];
  const docs = { expenses: expenseDocs, managerialClassifications: classDocs, receivables: revenueDocs };
  const query = (rows, offset = 0) => ({
    orderBy: () => query(rows),
    startAfter: last => query(rows, rows.indexOf(last) + 1),
    limit: count => ({ get: async () => ({ docs: rows.slice(offset, offset + count) }) }),
  });
  const request = financialRequest('Quanto recebemos de acordos e alvarás trabalhistas no ano de 26 e quanto gastamos com conta de luz?', '2026-11-11');
  const response = await runFinancial({ collection: name => query(docs[name]) }, request);
  assert.deepEqual(response.sources.map(source => [source.modulo, source.registros]), [['Receitas', 2], ['DRE Gerencial', 503]]);
  assert.deepEqual(response.details.slice(0, 2).map(row => row.value).sort((a, b) => a - b), [12500, 32500]);
  assert.equal(response.details.slice(2).reduce((sum, row) => sum + row.value, 0), 5030);
  assert.match(response.answer, /Recebimentos confirmados[\s\S]*Despesas na DRE por competência/);
});
