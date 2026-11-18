'use strict';
// Roda o apps-script/Code.gs de verdade (em vm), com uma planilha falsa em memória. Uso: node --test tests/backend.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), vm = require('vm'), crypto = require('crypto'), path = require('path');

const CAB_RES = ['ID Reserva', 'Data', 'Início', 'Fim', 'Responsável', 'Motivo', 'PIN (hash)', 'Status', 'Criado em', 'Origem', 'Observação admin'];
const CAB_REC = ['ID Série', 'Dia da semana', 'Início', 'Fim', 'Responsável', 'Motivo', 'Status', 'Vigência início', 'Vigência fim', 'Criado em', 'Observação admin'];

const CAB_SOL = ['ID Solicitação', 'ID Reunião', 'Data', 'Início', 'Fim', 'Reunião', 'Solicitante', 'Motivo do cancelamento', 'Status', 'Criado em', 'Decidido em'];

function ambiente() {
  const dados = { Reservas: [CAB_RES.slice()], Recorrentes: [CAB_REC.slice()], 'Solicitações': [CAB_SOL.slice()] };
  const aba = (nome) => ({
    getDataRange: () => ({ getDisplayValues: () => dados[nome].map((l) => l.slice()) }),
    getLastRow: () => dados[nome].length,
    getRange: (row, col, nr = 1, nc = 1) => ({
      setNumberFormat() {},
      setValues: (v) => { dados[nome][row - 1] = v[0].slice(); },
      setValue: (v) => { dados[nome][row - 1][col - 1] = v; },
    }),
    deleteRow: (row) => dados[nome].splice(row - 1, 1),
  });
  const cache = new Map();
  const ctx = {
    console, Date, Math, JSON, Intl, Object, Array, String, Number, Error, Map, parseInt,
    Utilities: {
      formatDate: (d, tz, f) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((x) => [x.type, x.value])); return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`; },
      computeHmacSha256Signature: (txt, sal) => [...crypto.createHmac('sha256', sal).update(txt).digest()].map((b) => (b > 127 ? b - 256 : b)),
      getUuid: () => crypto.randomUUID(),
    },
    CacheService: { getScriptCache: () => ({ get: (k) => (cache.has(k) ? cache.get(k) : null), put: (k, v) => cache.set(k, v) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: { MimeType: { JSON: 1 }, createTextOutput: (t) => ({ t, setMimeType() { return this; } }) },
    SpreadsheetApp: { getActive: () => ({ getSheetByName: aba }) },
  };
  vm.createContext(ctx);
  let src = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
  src = src.replace("const ADMIN_SENHA = 'TROQUE-ESTA-SENHA';", "const ADMIN_SENHA = 'senha-teste';");
  vm.runInContext(src, ctx);
  const chama = (d, admin) => JSON.parse(ctx.doPost({ parameter: {}, postData: { contents: JSON.stringify(admin ? { senha: 'senha-teste', ...d } : d) } }).t);
  return { chama, dados };
}
const R = (o) => ({ rota: 'reservar', data: '2030-01-10', inicio: '09:00', fim: '10:30', responsavel: 'Ana', motivo: 'Kickoff', ...o });

test('reserva livre; conflito parcial/total/vários; encostar é permitido', () => {
  const { chama } = ambiente();
  const a = chama(R());
  assert.equal(a.pin, undefined); assert.ok(a.reserva.id);
  for (const [i, f] of [['10:00', '11:00'], ['09:00', '10:30'], ['08:00', '12:00'], ['09:30', '10:00']]) {
    const e = chama(R({ inicio: i, fim: f }));
    assert.equal(e.status, 409, `${i}-${f}`); assert.match(e.erro, /09:00 às 10:30 por Ana \(Kickoff\)/);
  }
  assert.ok(chama(R({ inicio: '11:00', fim: '12:00', responsavel: 'Bia', motivo: 'B' })).reserva);
  assert.match(chama(R({ inicio: '10:00', fim: '11:30' })).erro, /Ana.*Bia/);
  assert.ok(chama(R({ inicio: '10:30', fim: '11:00', responsavel: 'C' })).reserva, 'encostada depois');
  assert.ok(chama(R({ inicio: '08:00', fim: '09:00', responsavel: 'D' })).reserva, 'encostada antes');
});

test('validações: passado, fora do expediente, múltiplos de 30, campos, fórmula', () => {
  const { chama } = ambiente();
  assert.match(chama(R({ data: '2020-01-01' })).erro, /já passou/);
  for (const [i, f] of [['06:30', '07:30'], ['17:30', '18:30'], ['09:15', '10:00'], ['10:00', '10:00'], ['12:00', '11:00']]) assert.equal(chama(R({ inicio: i, fim: f })).status, 400, `${i}-${f}`);
  assert.match(chama(R({ responsavel: '' })).erro, /responsável/);
  assert.match(chama(R({ motivo: '' })).erro, /motivo/);
  const r = chama(R({ responsavel: '@teste', motivo: '=1+1', inicio: '15:00', fim: '15:30' })).reserva;
  assert.equal(r.responsavel, 'teste'); assert.equal(r.motivo, '1+1');
});

const C = (o) => ({ rota: 'cancelar', nome: 'Ana', motivo: 'mudou', ...o });
test('cancelar: só vira solicitação (calendário intacto); admin aprova ou recusa', () => {
  const { chama } = ambiente(), ad = (d) => chama(d, true);
  const { reserva } = chama(R());
  assert.equal(chama(C({ id: 'NAOEXIST', data: '2030-01-10' })).status, 404);
  assert.equal(chama(C({ id: reserva.id, nome: '' })).status, 400);
  assert.equal(chama(C({ id: reserva.id, motivo: '' })).status, 400);
  assert.equal(chama(C({ id: reserva.id })).ok, true);
  assert.equal(chama({ rota: 'reservas', data: '2030-01-10' }).reservas.length, 1, 'continua no calendário público');
  assert.equal(chama(C({ id: reserva.id })).status, 400, 'duplicada');
  const p = ad({ rota: 'admin-listar' }).solicitacoes;
  assert.equal(p.length, 1); assert.equal(p[0].nome, 'Ana');
  ad({ rota: 'admin-decidir', id: p[0].id, decisao: 'recusar' });
  assert.equal(chama({ rota: 'reservas', data: '2030-01-10' }).reservas.length, 1, 'recusada: segue');
  chama(C({ id: reserva.id }));
  const q = ad({ rota: 'admin-listar' }).solicitacoes;
  assert.equal(q.length, 1);
  ad({ rota: 'admin-decidir', id: q[0].id, decisao: 'aprovar' });
  assert.equal(chama({ rota: 'reservas', data: '2030-01-10' }).reservas.length, 0, 'aprovada: sai');
  assert.equal(ad({ rota: 'admin-decidir', id: q[0].id, decisao: 'aprovar' }).status, 400, 'já decidida');
});

test('cancelar ocorrência de reunião recorrente: aprovação tira só aquela data', () => {
  const { chama } = ambiente(), ad = (d) => chama(d, true);
  const s = ad({ rota: 'admin-recorrente', acao: 'criar', dia: 'Quarta-feira', inicio: '09:00', fim: '10:00', responsavel: 'Time', motivo: 'Semanal', vigIni: '2030-01-01' }).recorrente;
  const dia = (d) => chama({ rota: 'reservas', data: d }).reservas.length;
  assert.equal(chama(C({ id: s.id, data: '2030-01-10' })).status, 404, 'data fora da série (quinta)');
  assert.equal(chama(C({ id: s.id, data: '2030-01-16' })).ok, true);
  assert.equal(dia('2030-01-16'), 1, 'pendente: segue');
  ad({ rota: 'admin-decidir', id: ad({ rota: 'admin-listar' }).solicitacoes[0].id, decisao: 'aprovar' });
  assert.equal(dia('2030-01-16'), 0, 'só esse dia some');
  assert.equal(dia('2030-01-09'), 1); assert.equal(dia('2030-01-23'), 1);
  assert.ok(chama(R({ data: '2030-01-16', inicio: '09:00', fim: '10:00' })).reserva, 'horário liberado');
});

test('privacidade: leitura pública sem PIN/hash/canceladas', () => {
  const { chama } = ambiente(), ad = (d) => chama(d, true);
  const a = chama(R()); chama(R({ inicio: '13:00', fim: '14:00' }));
  chama(C({ id: a.reserva.id }));
  ad({ rota: 'admin-decidir', id: ad({ rota: 'admin-listar' }).solicitacoes[0].id, decisao: 'aprovar' });
  const g = chama({ rota: 'reservas', data: '2030-01-10' }).reservas;
  assert.equal(g.length, 1);
  assert.deepEqual(Object.keys(g[0]).sort(), ['data', 'fim', 'id', 'inicio', 'motivo', 'recorrente', 'responsavel']);
});

test('admin: senha, editar (conflito → forçar), cancelar/reativar, criar, excluir', () => {
  const { chama } = ambiente();
  assert.equal(chama({ rota: 'admin-listar' }).status, 401);
  const A = chama(R()).reserva.id; chama(R({ inicio: '11:00', fim: '12:00', responsavel: 'Bia' }));
  const ad = (d) => chama(d, true);
  assert.equal(ad({ rota: 'admin-editar', id: A, inicio: '10:30', fim: '11:30' }).status, 409);
  const f = ad({ rota: 'admin-editar', id: A, inicio: '10:30', fim: '11:30', forcar: true });
  assert.match(f.reserva.obs, /forçar/);
  assert.match(ad({ rota: 'admin-editar', id: A, inicio: '13:00', fim: '14:00' }).reserva.obs, /inicio: 10:30 → 13:00/);
  assert.equal(ad({ rota: 'admin-cancelar', id: A, motivo: 'teste' }).reserva.status, 'Cancelada');
  ad({ rota: 'admin-criar', data: '2030-01-10', inicio: '13:00', fim: '14:00', responsavel: 'X', motivo: 'ocupa' });
  assert.equal(ad({ rota: 'admin-reativar', id: A }).status, 409);
  const c = ad({ rota: 'admin-criar', data: '2030-01-11', inicio: '08:00', fim: '09:00', responsavel: 'Adm', motivo: 'm' });
  assert.equal(c.reserva.id.length, 8);
  assert.equal(ad({ rota: 'admin-excluir', id: c.reserva.id }).ok, true);
  assert.equal(ad({ rota: 'admin-listar', status: 'todas' }).reservas.some((r) => r.id === c.reserva.id), false);
});

test('recorrentes: aparecem na grade, conflitam, N semanas, editar, cancelar/reativar', () => {
  const { chama } = ambiente();
  const ad = (d) => chama(d, true);
  const s = ad({ rota: 'admin-recorrente', acao: 'criar', dia: 'Quarta-feira', inicio: '09:00', fim: '10:30', responsavel: 'Planejamento Combio', motivo: 'Integração', vigIni: '2030-01-01', vigFim: '2030-01-30' }).recorrente;
  assert.equal(s.vigFim, '2030-01-30');
  const dia = (d) => chama({ rota: 'reservas', data: d }).reservas;
  assert.equal(dia('2030-01-09').length, 1); assert.equal(dia('2030-01-09')[0].recorrente, true);
  assert.equal(dia('2030-01-30').length, 1, 'última ocorrência');
  assert.equal(dia('2030-02-06').length, 0, 'depois do fim');
  assert.match(chama(R({ data: '2030-01-09', inicio: '10:00', fim: '11:00' })).erro, /Integração/);
  assert.ok(chama(R({ data: '2030-01-09', inicio: '10:30', fim: '11:00' })).reserva, 'encostado');
  assert.equal(ad({ rota: 'admin-recorrente', acao: 'editar', id: s.id, responsavel: 'Novo' }).recorrente.responsavel, 'Novo');
  assert.equal(dia('2030-01-16')[0].responsavel, 'Novo');
  assert.equal(ad({ rota: 'admin-recorrente', acao: 'editar', id: s.id, vigFim: '' }).recorrente.vigFim, '', 'para sempre');
  assert.equal(dia('2030-02-06').length, 1);
  ad({ rota: 'admin-recorrente', acao: 'cancelar', id: s.id }); assert.equal(dia('2030-01-16').length, 0);
  ad({ rota: 'admin-recorrente', acao: 'reativar', id: s.id }); assert.equal(dia('2030-01-16').length, 1);
  assert.equal(ad({ rota: 'admin-recorrente', acao: 'criar', dia: 'Quarta-feira', inicio: '10:00', fim: '11:00', responsavel: 'X', motivo: 'Y', vigIni: '2030-01-01' }).status, 409);
});

test('reqId: repetir o mesmo envio não grava duas vezes e devolve o mesmo resultado', () => {
  const { chama, dados } = ambiente();
  const a = chama(R({ reqId: 'abc' })), b = chama(R({ reqId: 'abc' }));
  assert.equal(b.reserva.id, a.reserva.id);
  assert.equal(dados.Reservas.length, 2, 'uma única linha gravada');
  assert.equal(chama(R({ reqId: 'outro' })).status, 409, 'outro envio no mesmo horário conflita');
});
