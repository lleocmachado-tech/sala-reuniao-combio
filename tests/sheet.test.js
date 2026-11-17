'use strict';
// Testa a ponte Apps Script com fetch simulado (sem rede): leitura por título, insert, update, delete, erros.
const test = require('node:test');
const assert = require('node:assert/strict');
Object.assign(process.env, { APPS_SCRIPT_URL: 'https://script.google.com/macros/s/X/exec', APPS_SCRIPT_KEY: 'k', PIN_SALT: 's' });
const { abrir } = require('../netlify/lib/sheet');
const ops = require('../netlify/lib/ops');

const CAB_R = ['Data', 'ID Reserva', 'Início', 'Fim', 'Responsável', 'Motivo', 'PIN (hash)', 'Status', 'Criado em', 'Origem', 'Observação admin'];
const CAB_S = ['ID Série', 'Dia da semana', 'Início', 'Fim', 'Responsável', 'Motivo', 'Status', 'Vigência início', 'Vigência fim', 'Criado em', 'Observação admin'];

function falso(resposta) {
  const chamadas = [];
  global.fetch = async (url, o) => {
    const corpo = JSON.parse(o.body); chamadas.push(corpo);
    const txt = typeof resposta === 'function' ? resposta(corpo) : resposta;
    return { status: 200, text: async () => (typeof txt === 'string' ? txt : JSON.stringify(txt)) };
  };
  return chamadas;
}

test('apps script: lê por título (colunas fora de ordem), conflita com série, insere/atualiza/exclui', async () => {
  const chamadas = falso((c) => c.acao === 'ler'
    ? { reservas: [CAB_R, ['2030-01-09', 'R1', '08:00', '09:00', 'Ana', 'X', 'h', 'Ativa', '2030-01-01T00:00:00Z', 'Painel', '']],
        recorrentes: [CAB_S, ['S1', 'Quarta-feira', '09:00', '10:00', 'Planejamento Combio', 'Seg', 'Ativa', '2030-01-01', '', '2030-01-01T00:00:00Z', '']] }
    : c.acao === 'inserir' ? { row: 3 } : { ok: true });
  const sh = await abrir();
  assert.equal(sh.reservas[0].id, 'R1'); assert.equal(sh.reservas[0].rowId, 2);
  assert.equal(sh.recorrentes[0].dia, 'Quarta-feira');
  await assert.rejects(ops.criar(sh, { data: '2030-01-09', inicio: '09:30', fim: '10:30', responsavel: 'B', motivo: 'M' }, { origem: 'Painel', agora: { data: '2030-01-01', min: 0, iso: 'i' } }), (e) => e.status === 409);
  assert.equal(await sh.inserir({ id: 'N1', data: '2030-01-10', inicio: '09:00', fim: '10:00', responsavel: 'B', motivo: 'M', status: 'Ativa' }), 3);
  const ins = chamadas.find((c) => c.acao === 'inserir');
  assert.equal(ins.chave, 'k'); assert.equal(ins.aba, 'Reservas');
  assert.equal(ins.linha[0], '2030-01-10', 'Data na 1ª coluna (ordem da planilha)'); assert.equal(ins.linha[1], 'N1');
  await sh.atualizar(2, { status: 'Cancelada' });
  assert.deepEqual(chamadas.at(-1), { chave: 'k', acao: 'atualizar', aba: 'Reservas', row: 2, celulas: [{ col: 7, valor: 'Cancelada' }] });
  await sh.excluirRec(5);
  assert.deepEqual(chamadas.at(-1), { chave: 'k', acao: 'excluir', aba: 'Recorrentes', row: 5 });
});

test('apps script: erro da planilha e resposta que não é JSON viram mensagens claras', async () => {
  falso({ erro: 'Chave inválida' });
  await assert.rejects(abrir(), (e) => e.status === 502 && /Chave inválida/.test(e.message));
  falso('<html>Faça login</html>');
  await assert.rejects(abrir(), (e) => e.status === 502 && /Qualquer pessoa/.test(e.message));
  falso({ reservas: [['Data']], recorrentes: [CAB_S] });
  await assert.rejects(abrir(), (e) => e.status === 500 && /Colunas ausentes/.test(e.message));
});
