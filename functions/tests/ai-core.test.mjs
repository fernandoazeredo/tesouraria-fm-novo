import test from 'node:test';
import assert from 'node:assert/strict';
import {isMasterClaim,isAppQuestion,inScope,safeRecord} from '../ai-core.js';
test('bloqueia master com e-mail não verificado',()=>assert.equal(isMasterClaim({email:'fernandoazeredo64@gmail.com',email_verified:false},{email:'fernandoazeredo64@gmail.com',role:'master',status:'active'}),false));
test('permite apenas master verificado e ativo',()=>assert.equal(isMasterClaim({email:'fernandoazeredo64@gmail.com',email_verified:true},{email:'fernandoazeredo64@gmail.com',role:'master',status:'active'}),true));
test('nega outros usuários',()=>assert.equal(isMasterClaim({email:'outro@example.com',email_verified:true},{email:'outro@example.com',role:'master',status:'active'}),false));
test('restringe perguntas externas',()=>assert.equal(isAppQuestion('Qual é a temperatura amanhã?'),false));
test('reconhece comissões',()=>assert.ok(inScope('Quais comissões foram pagas?').includes('comissoes')));
test('não expõe CPF ou dados bancários',()=>assert.deepEqual(safeRecord('abc',{cpf:'123',bankAccountNumber:'789',status:'pago',valorTotal:200}),{id:'abc',status:'pago',valorTotal:200}));
