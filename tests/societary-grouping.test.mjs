import test from 'node:test'
import assert from 'node:assert/strict'
import { groupByProcess,processGroupKey } from '../src/lib/societaryGrouping.ts'

test('Agrupa CNJ equivalente com e sem pontuação ou espaços',()=>{
  const list=[{id:'1',processo:'0101234-56.2026.5.01.0001'},{id:'2',processo:'01012345620265010001'},{id:'3',processo:' 0101234 56 2026 5 01 0001 '}]
  const group=groupByProcess(list)
  assert.equal(group.length,1)
  assert.equal(group[0].length,3)
})
test('Não funde dois documentos sem CNJ',()=>{
  assert.notEqual(processGroupKey('', 'abc'),processGroupKey('', 'def'))
})
test('Não confunde processos distintos',()=>{
  assert.equal(groupByProcess([{id:'1',processo:'0101234-56.2026.5.01.0001'},{id:'2',processo:'0101234-56.2026.5.01.0002'}]).length,2)
})
