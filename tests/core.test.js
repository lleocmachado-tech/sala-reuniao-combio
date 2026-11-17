'use strict';
// Rodar: node --test tests/
process.env.PIN_SALT = 'sal-de-teste';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../netlify/lib/core');
const ops = require('../netlify/lib/ops');

const R = (o) => ({ id: 'A1', data: '2030-01-10', inicio: '09:00', fim: '10:30', responsavel: 'Ana', motivo: 'Kickoff', status: 'Ativa', criadoEm: '2030-01-01T10:00:00.000Z', ...o });
const N = (inicio, fim, data = '2030-01-10') => ({ data, inicio, fim });
const base = [R()];

test('conflito: sem sobreposição / encostadas NÃO conflitam', () => {
  assert.equal(C.conflitos(base, N('07:00', '09:00')).length, 0, 'termina quando a outra começa');
  assert.equal(C.conflitos(base, N('10:30', '11:30')).length, 0, 'começa quando a outra termina');
  assert.equal(C.conflitos(base, N('13:00', '14:00')).length, 0);
});
test('conflito: parcial, total, contido, contendo, idêntico', () => {
  assert.equal(C.conflitos(base, N('08:30', '09:30')).length, 1, 'parcial no início');
  assert.equal(C.conflitos(base, N('10:00', '11:00')).length, 1, 'parcial no fim');
  assert.equal(C.conflitos(base, N('09:00', '10:30')).length, 1, 'idêntico');
  assert.equal(C.conflitos(base, N('09:30', '10:00')).length, 1, 'contido');
  assert.equal(C.conflitos(base, N('08:00', '12:00')).length, 1, 'contendo');
});
test('conflito: outra data e canceladas são ignoradas; ignorarId funciona', () => {
  assert.equal(C.conflitos(base, N('09:00', '10:30', '2030-01-11')).length, 0);
  assert.equal(C.conflitos([R({ status: 'Cancelada' })], N('09:00', '10:30')).length, 0);
  assert.equal(C.conflitos(base, N('09:00', '10:30'), 'A1').length, 0);
});
test('conflito: vários listados em ordem e mensagem clara', () => {
  const l = [R({ id: 'B', inicio: '10:00', fim: '11:00', responsavel: 'Bia', motivo: 'Sprint' }), R()];
  const cs = C.conflitos(l, N('09:30', '10:30'));
  assert.deepEqual(cs.map((c) => c.id), ['A1', 'B']);
  assert.equal(C.mensagemConflito(cs.slice(0, 1)),
    'Não foi possível reservar: a sala já está ocupada das 09:00 às 10:30 por Ana (Kickoff). Escolha outro horário.');
  assert.match(C.mensagemConflito(cs), /por Ana \(Kickoff\); das 10:00 às 11:00 por Bia \(Sprint\)/);
});

test('horário: múltiplos de 30, 07–18, fim > início', () => {
  assert.equal(C.validarHorario('07:00', '07:30'), null);
  assert.equal(C.validarHorario('17:30', '18:00'), null);
  assert.match(C.validarHorario('06:30', '07:30'), /07:00 às 18:00/);
  assert.match(C.validarHorario('17:30', '18:30'), /07:00 às 18:00/);
  assert.match(C.validarHorario('09:15', '10:00'), /30 minutos/);
  assert.match(C.validarHorario('10:00', '10:00'), /depois/);
  assert.match(C.validarHorario('11:00', '10:00'), /depois/);
  assert.match(C.validarHorario('9:00', '10:00'), /HH:MM/);
  assert.match(C.validarHorario('25:00', '26:00'), /HH:MM/);
});

test('passado (fuso São Paulo)', () => {
  const ag = { data: '2030-01-10', min: 9 * 60 };
  assert.ok(C.validarPassado('2030-01-09', '15:00', ag), 'ontem');
  assert.ok(C.validarPassado('2030-01-10', '08:30', ag), 'hoje, já passou');
  assert.equal(C.validarPassado('2030-01-10', '09:00', ag), null, 'hoje, começando agora');
  assert.equal(C.validarPassado('2030-01-11', '07:00', ag), null);
  // 02:00 UTC de 11/jan = 23:00 de 10/jan em São Paulo (UTC-3)
  const a = C.agora(new Date('2030-01-11T02:00:00Z'));
  assert.deepEqual([a.data, a.min], ['2030-01-10', 23 * 60]);
});

test('normalizar: obrigatórios, limites e injeção de fórmula', () => {
  const ok = { data: '2030-01-10', inicio: '09:00', fim: '10:00', responsavel: 'Ana', motivo: 'X' };
  assert.ok(C.normalizar(ok).v);
  for (const k of ['data', 'inicio', 'fim', 'responsavel', 'motivo']) assert.ok(C.normalizar({ ...ok, [k]: '' }).erro, k);
  assert.ok(C.normalizar({ ...ok, responsavel: 'a'.repeat(61) }).erro);
  assert.ok(C.normalizar({ ...ok, motivo: 'a'.repeat(121) }).erro);
  assert.ok(C.normalizar({ ...ok, data: '2030-02-31' }).erro, 'data inexistente');
  assert.equal(C.normalizar({ ...ok, responsavel: '=HYPERLINK("x")' }).v.responsavel, 'HYPERLINK("x")');
  assert.equal(C.normalizar({ ...ok, motivo: ' +@-= teste\n\tlinha ' }).v.motivo, 'teste linha');
  assert.ok(C.normalizar({ ...ok, motivo: '=+-@' }).erro, 'só símbolos vira vazio');
});

test('corrida: vence o "Criado em" mais antigo; encadeado correto', () => {
  const a = R({ id: 'A', criadoEm: '2030-01-01T10:00:00.000Z' });
  const b = R({ id: 'B', criadoEm: '2030-01-01T10:00:00.050Z', inicio: '10:00', fim: '11:00' });
  assert.equal(C.vence([a, b], a), true);
  assert.equal(C.vence([a, b], b), false);
  const c = R({ id: 'C', criadoEm: '2030-01-01T10:00:00.090Z', inicio: '11:00', fim: '12:00' }); // só sobrepõe B (que perdeu)
  assert.equal(C.vence([a, b, c], c), true);
  assert.equal(C.vence([a, R({ id: 'Z', criadoEm: a.criadoEm, inicio: '09:30', fim: '10:00' })], a), true, 'empate: menor ID');
  assert.equal(C.vence([a, b, R({ id: 'D', data: '2030-01-11', inicio: '09:00' })], b), false);
});

test('PIN: 4 dígitos, hash com sal, confere só o correto', () => {
  for (let i = 0; i < 200; i++) assert.match(C.gerarPin(), /^\d{4}$/);
  const h = C.hashPin('A1', '1234');
  assert.notEqual(h, '1234');
  assert.ok(C.pinConfere('A1', '1234', h));
  assert.ok(!C.pinConfere('A1', '1235', h));
  assert.ok(!C.pinConfere('A2', '1234', h), 'preso ao ID');
  assert.ok(!C.pinConfere('A1', '1234', ''));
});

// ---- Operações com planilha falsa em memória ----
function falsa(reservas = []) {
  const sh = {
    reservas, n: 100,
    async inserir(r) { sh.reservas.push({ ...r, rowId: ++sh.n }); return sh.n; },
    async atualizar(rowId, c) { Object.assign(sh.reservas.find((x) => x.rowId === rowId), c); },
    async excluir(rowId) { sh.reservas = sh.reservas.filter((x) => x.rowId !== rowId); },
    async recarregar() { return sh; },
  };
  return sh;
}
const AG = { data: '2030-01-01', min: 8 * 60, iso: '2030-01-01T11:00:00.000Z' };
const D = (o) => ({ data: '2030-01-10', inicio: '09:00', fim: '10:00', responsavel: 'Leo', motivo: 'Teste', ...o });

test('criar: livre → PIN, hash salvo (nunca o PIN)', async () => {
  const sh = falsa();
  const { reserva, pin } = await ops.criar(sh, D(), { origem: 'Painel', agora: AG });
  assert.match(pin, /^\d{4}$/);
  assert.equal(sh.reservas.length, 1);
  assert.ok(!JSON.stringify(sh.reservas[0]).includes(`"${pin}"`));
  assert.equal(reserva.pinHash, undefined);
});
test('criar: conflito → 409 com mensagem; encostada passa; passado/fora de horário → 400', async () => {
  const sh = falsa([R({ id: 'X', rowId: 1 })]);
  await assert.rejects(ops.criar(sh, D({ inicio: '10:00', fim: '11:00' }), { origem: 'Painel', agora: AG }),
    (e) => e.status === 409 && /ocupada das 09:00 às 10:30 por Ana \(Kickoff\)/.test(e.message));
  await ops.criar(sh, D({ inicio: '10:30', fim: '11:00' }), { origem: 'Painel', agora: AG });
  await ops.criar(sh, D({ inicio: '08:00', fim: '09:00' }), { origem: 'Painel', agora: AG });
  await assert.rejects(ops.criar(sh, D({ data: '2029-12-31' }), { origem: 'Painel', agora: AG }), (e) => e.status === 400);
  await assert.rejects(ops.criar(sh, D({ inicio: '18:00', fim: '18:30' }), { origem: 'Painel', agora: AG }), (e) => e.status === 400);
});
test('criar: dois envios simultâneos → só um fica Ativo', async () => {
  const sh = falsa();
  const t = (ms) => ({ ...AG, iso: new Date(Date.parse(AG.iso) + ms).toISOString() });
  // ambos validam com a planilha vazia, ambos inserem; depois relêem
  const pre = { reservas: [], inserir: sh.inserir, atualizar: sh.atualizar, recarregar: sh.recarregar };
  const rA = ops.criar({ ...pre, reservas: [] }, D({ responsavel: 'A' }), { origem: 'Painel', agora: t(0) });
  const rB = ops.criar({ ...pre, reservas: [] }, D({ responsavel: 'B', inicio: '09:30', fim: '10:30' }), { origem: 'Painel', agora: t(40) });
  const res = await Promise.allSettled([rA, rB]);
  assert.equal(res.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(res.find((r) => r.status === 'rejected').reason.status, 409);
  assert.equal(sh.reservas.filter((r) => r.status === 'Ativa').length, 1);
  assert.equal(sh.reservas.find((r) => r.status === 'Ativa').responsavel, 'A', 'o mais antigo vence');
});
test('cancelar público: PIN certo cancela, errado não, mensagem igual p/ ID inexistente', async () => {
  const sh = falsa();
  const { reserva, pin } = await ops.criar(sh, D(), { origem: 'Painel', agora: AG });
  const errado = pin === '0000' ? '0001' : '0000';
  await assert.rejects(ops.cancelarPublico(sh, { id: reserva.id, pin: errado }, { agora: AG }), (e) => e.status === 403);
  await assert.rejects(ops.cancelarPublico(sh, { id: 'NAOEXISTE', pin }, { agora: AG }), (e) => e.status === 403);
  assert.equal(sh.reservas[0].status, 'Ativa');
  await ops.cancelarPublico(sh, { id: reserva.id.toLowerCase(), pin }, { agora: AG });
  assert.equal(sh.reservas[0].status, 'Cancelada');
  await assert.rejects(ops.cancelarPublico(sh, { id: reserva.id, pin }, { agora: AG }), (e) => e.status === 400);
});
test('admin: editar valida conflito; forçar passa e registra; reativar valida; excluir', async () => {
  const sh = falsa([R({ id: 'A', rowId: 1 }), R({ id: 'B', rowId: 2, inicio: '11:00', fim: '12:00', responsavel: 'Bia' })]);
  await assert.rejects(ops.editar(sh, { id: 'B', inicio: '10:00', fim: '12:00' }, { agora: AG }), (e) => e.status === 409);
  await assert.rejects(ops.editar(sh, { id: 'B' }, { agora: AG }), (e) => e.status === 400, 'sem alteração');
  await ops.editar(sh, { id: 'B', responsavel: 'Beatriz' }, { agora: AG });
  await ops.editar(sh, { id: 'A', fim: '11:00' }, { agora: AG }); // encosta em B, ok
  await ops.editar(sh, { id: 'B', inicio: '10:30', fim: '12:00', forcar: true }, { forcar: true, agora: AG });
  assert.match(sh.reservas[1].obs, /forçar.*conflito com A/);
  await ops.cancelarAdmin(sh, { id: 'A', motivo: '=teste' }, { agora: AG });
  assert.equal(sh.reservas[0].status, 'Cancelada');
  await assert.rejects(ops.reativar(sh, { id: 'A' }, { agora: AG }), (e) => e.status === 409);
  await ops.reativar(sh, { id: 'A' }, { forcar: true, agora: AG });
  assert.equal(sh.reservas[0].status, 'Ativa');
  await ops.excluir(sh, { id: 'A' });
  assert.equal(sh.reservas.length, 1);
});

// ---- Recorrência ----
const S = (o) => ({ rowId: 50, id: 'S1', dia: 'Quarta-feira', inicio: '09:00', fim: '10:30', responsavel: 'Planejamento Combio', motivo: 'Integração/SSMA', status: 'Ativa', vigIni: '2030-01-01', vigFim: '', criadoEm: '2030-01-01T00:00:00Z', obs: '', ...o });
// 2030-01-02 é quarta-feira
test('expandir: só o dia da semana, dentro da vigência, só séries ativas', () => {
  const o = C.expandir([S()], '2030-01-01', '2030-01-21');
  assert.deepEqual(o.map((x) => x.data), ['2030-01-02', '2030-01-09', '2030-01-16']);
  assert.equal(C.expandir([S({ vigIni: '2030-01-09' })], '2030-01-01', '2030-01-21').length, 2);
  assert.equal(C.expandir([S({ vigFim: '2030-01-09' })], '2030-01-01', '2030-01-21').length, 2);
  assert.equal(C.expandir([S({ status: 'Cancelada' })], '2030-01-01', '2030-01-21').length, 0);
  assert.equal(C.diaIdx('terca'), 2); assert.equal(C.diaIdx('Sexta-feira'), 5); assert.equal(C.diaIdx('x'), -1);
});
test('reserva avulsa conflita com ocorrência de série; encostada não', async () => {
  const sh = falsa(); sh.recorrentes = [S()];
  await assert.rejects(ops.criar(sh, D({ data: '2030-01-09', inicio: '10:00', fim: '11:00' }), { origem: 'Painel', agora: AG }),
    (e) => e.status === 409 && /09:00 às 10:30 por Planejamento Combio \(Integração\/SSMA\)/.test(e.message));
  await ops.criar(sh, D({ data: '2030-01-09', inicio: '10:30', fim: '11:00' }), { origem: 'Painel', agora: AG });
  await ops.criar(sh, D({ data: '2030-01-10', inicio: '09:00', fim: '10:00' }), { origem: 'Painel', agora: AG }); // quinta: livre
});
test('série: criar/editar/cancelar/reativar/excluir com conflitos e forçar', async () => {
  const sh = falsa([R({ id: 'A', rowId: 1, data: '2030-01-09' })]); // quarta 09:00–10:30 avulsa
  sh.recorrentes = []; sh.inserirRec = async (r) => { sh.recorrentes.push({ ...r, rowId: 60 + sh.recorrentes.length }); };
  sh.atualizarRec = async (rowId, c) => Object.assign(sh.recorrentes.find((x) => x.rowId === rowId), c);
  sh.excluirRec = async (rowId) => { sh.recorrentes = sh.recorrentes.filter((x) => x.rowId !== rowId); };
  const base = { acao: 'criar', dia: 'Quarta-feira', inicio: '09:00', fim: '10:00', responsavel: 'Planejamento Combio', motivo: 'Seguimento', vigIni: '2030-01-01' };
  await assert.rejects(ops.recorrente(sh, base, { agora: AG }), (e) => e.status === 409 && /09\/01\/2030/.test(e.message));
  const { recorrente: ok } = await ops.recorrente(sh, { ...base, inicio: '10:30', fim: '11:30' }, { agora: AG });
  assert.equal(ok.status, 'Ativa');
  await assert.rejects(ops.recorrente(sh, { ...base, inicio: '11:00', fim: '12:00' }, { agora: AG }), (e) => e.status === 409 && /recorrente/.test(e.message), 'série x série');
  await assert.rejects(ops.recorrente(sh, { ...base, inicio: '10:00', fim: '10:30', vigIni: '2030-02-01' }, { agora: AG }).then(() => { throw new Error('ok?'); }), /ok\?/, 'sem conflito (vigência após a avulsa e encostada) cria');
  await ops.recorrente(sh, { acao: 'editar', id: ok.id, responsavel: 'Maria' }, { agora: AG });
  assert.equal(sh.recorrentes[0].responsavel, 'Maria');
  assert.match(sh.recorrentes[0].obs, /responsavel: Planejamento Combio → Maria/);
  await ops.recorrente(sh, { acao: 'cancelar', id: ok.id }, { agora: AG });
  assert.equal(C.expandir(sh.recorrentes, '2030-01-01', '2030-01-31').length, 0);
  await ops.recorrente(sh, { acao: 'reativar', id: ok.id }, { agora: AG });
  await ops.recorrente(sh, { acao: 'excluir', id: ok.id }, { agora: AG });
  assert.equal(sh.recorrentes.length, 1); // sobrou a da vigência a partir de fev
});
