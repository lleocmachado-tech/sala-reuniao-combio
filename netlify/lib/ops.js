'use strict';
// Operações sobre reservas. "sh" é a planilha aberta: { reservas, inserir, atualizar, excluir, recarregar }.
const C = require('./core');
const { Erro } = C;

const pub = (r) => ({ id: r.id, data: r.data, inicio: r.inicio, fim: r.fim, responsavel: r.responsavel, motivo: r.motivo, recorrente: !!r.recorrente });
const adm = (r) => ({ ...pub(r), status: r.status, criadoEm: r.criadoEm, origem: r.origem, obs: r.obs || '' });
const carimbo = (ag) => `${C.fmtData(ag.data)} ${C.toHHMM(ag.min)}`;

function achar(sh, id) {
  const r = sh.reservas.find((x) => x.id === String(id || '').trim().toUpperCase());
  if (!r) throw new Erro(404, 'Reserva não encontrada.');
  return r;
}

// reservas avulsas + ocorrências das séries recorrentes no período
const todas = (sh, de, ate) => [...sh.reservas, ...C.expandir(sh.recorrentes || [], de, ate)];

function checarConflito(sh, v, ignorarId, forcar) {
  const cs = C.conflitos(todas(sh, v.data, v.data), v, ignorarId);
  if (cs.length && !forcar) throw new Erro(409, C.mensagemConflito(cs), { conflitos: cs.map(pub) });
  return cs;
}

async function criar(sh, d, { origem, forcar = false, agora }) {
  const { v, erro } = C.normalizar(d);
  if (erro) throw new Erro(400, erro);
  if (!forcar) {
    const e = C.validarPassado(v.data, v.inicio, agora);
    if (e) throw new Erro(400, e);
  }
  const cs = checarConflito(sh, v, null, forcar);
  const id = C.gerarId(sh.reservas.map((r) => r.id));
  const pin = C.gerarPin();
  const r = {
    id, ...v, pinHash: C.hashPin(id, pin), status: 'Ativa', criadoEm: agora.iso, origem,
    obs: forcar ? `Criada pelo admin em ${carimbo(agora)} com "forçar"${cs.length ? ', ignorando conflito com ' + cs.map((c) => c.id).join(', ') : ''}.` : '',
  };
  r.rowId = await sh.inserir(r);

  if (!forcar) { // ponytail: sem transação no Google Sheets; releitura + regra "o mais antigo vence" reduz, não zera, a janela de corrida
    const sh2 = await sh.recarregar();
    if (!C.vence(todas(sh2, r.data, r.data), r)) {
      await sh2.atualizar(r.rowId, { status: 'Cancelada', obs: 'Cancelada automaticamente: conflito simultâneo com reserva mais antiga.' });
      const cs2 = C.conflitos(todas(sh2, v.data, v.data), v, id);
      throw new Erro(409, C.mensagemConflito(cs2), { conflitos: cs2.map(pub) });
    }
  }
  return { reserva: pub(r), pin };
}

async function editar(sh, d, { forcar = false, agora }) {
  const r = achar(sh, d.id);
  const { v, erro } = C.normalizar({
    data: d.data ?? r.data, inicio: d.inicio ?? r.inicio, fim: d.fim ?? r.fim,
    responsavel: d.responsavel ?? r.responsavel, motivo: d.motivo ?? r.motivo,
  });
  if (erro) throw new Erro(400, erro);
  const campos = ['data', 'inicio', 'fim', 'responsavel', 'motivo'].filter((k) => v[k] !== r[k]);
  if (!campos.length) throw new Erro(400, 'Nenhuma alteração informada.');
  if (!forcar && campos.some((k) => ['data', 'inicio', 'fim'].includes(k))) {
    const e = C.validarPassado(v.data, v.inicio, agora);
    if (e) throw new Erro(400, e);
  }
  const cs = r.status === 'Ativa' ? checarConflito(sh, v, r.id, forcar) : [];
  const dif = campos.map((k) => `${k}: ${r[k]} → ${v[k]}`).join('; ');
  const obs = C.addObs(r.obs, `Editada pelo admin em ${carimbo(agora)} (${dif})${forcar ? ' com "forçar"' + (cs.length ? ', ignorando conflito com ' + cs.map((c) => c.id).join(', ') : '') : ''}.`);
  await sh.atualizar(r.rowId, { ...v, obs });
  return { reserva: adm({ ...r, ...v, obs }) };
}

async function cancelarAdmin(sh, d, { agora }) {
  const r = achar(sh, d.id);
  if (r.status !== 'Ativa') throw new Erro(400, 'A reserva já está cancelada.');
  const motivo = C.limpar(d.motivo).slice(0, 200);
  const obs = C.addObs(r.obs, `Cancelada pelo admin em ${carimbo(agora)}${motivo ? ': ' + motivo : ''}.`);
  await sh.atualizar(r.rowId, { status: 'Cancelada', obs });
  return { reserva: adm({ ...r, status: 'Cancelada', obs }) };
}

async function reativar(sh, d, { forcar = false, agora }) {
  const r = achar(sh, d.id);
  if (r.status === 'Ativa') throw new Erro(400, 'A reserva já está ativa.');
  const cs = checarConflito(sh, r, r.id, forcar);
  const obs = C.addObs(r.obs, `Reativada pelo admin em ${carimbo(agora)}${forcar ? ' com "forçar"' + (cs.length ? ', ignorando conflito com ' + cs.map((c) => c.id).join(', ') : '') : ''}.`);
  await sh.atualizar(r.rowId, { status: 'Ativa', obs });
  return { reserva: adm({ ...r, status: 'Ativa', obs }) };
}

async function excluir(sh, d) {
  const r = achar(sh, d.id);
  await sh.excluir(r.rowId);
  return { ok: true, id: r.id };
}

// Mensagem igual para "não existe" e "PIN errado" (não revela quais IDs existem).
async function cancelarPublico(sh, d, { agora }) {
  const id = String(d.id || '').trim().toUpperCase();
  const r = sh.reservas.find((x) => x.id === id);
  if (!r || !C.pinConfere(r.id, d.pin, r.pinHash)) throw new Erro(403, 'Reserva não encontrada ou PIN incorreto.');
  if (r.status !== 'Ativa') throw new Erro(400, 'Esta reserva já estava cancelada.');
  const obs = C.addObs(r.obs, `Cancelada pelo painel público em ${carimbo(agora)}.`);
  await sh.atualizar(r.rowId, { status: 'Cancelada', obs });
  return { ok: true, reserva: pub(r) };
}

// ---- Reuniões recorrentes (semanais, até serem canceladas) ----
const serie = (r) => ({ id: r.id, dia: r.dia, inicio: r.inicio, fim: r.fim, responsavel: r.responsavel, motivo: r.motivo, status: r.status, vigIni: r.vigIni, vigFim: r.vigFim, criadoEm: r.criadoEm, obs: r.obs || '' });
const achaSerie = (sh, id) => {
  const r = (sh.recorrentes || []).find((x) => x.id === String(id || '').trim().toUpperCase());
  if (!r) throw new Erro(404, 'Reunião recorrente não encontrada.');
  return r;
};
function conflitoSerie(sh, v, ignorarId, forcar, agora) {
  const cs = C.conflitosRec(v, { reservas: sh.reservas, series: sh.recorrentes || [] }, agora.data, ignorarId);
  if (cs.length && !forcar) throw new Erro(409, C.mensagemConflitoRec(cs));
  return cs;
}
const sufixo = (forcar, cs) => (forcar ? ' com "forçar"' + (cs.length ? ', ignorando conflito com ' + cs.map((c) => c.id).join(', ') : '') : '');

async function recorrente(sh, d, { agora }) {
  const forcar = d.forcar === true, acao = d.acao;
  if (acao === 'criar') {
    const { v, erro } = C.normalizarRec(d, agora);
    if (erro) throw new Erro(400, erro);
    const cs = conflitoSerie(sh, v, null, forcar, agora);
    const r = { id: C.gerarId([...sh.reservas, ...(sh.recorrentes || [])].map((x) => x.id)), ...v, status: 'Ativa', criadoEm: agora.iso, obs: `Criada pelo admin em ${carimbo(agora)}${sufixo(forcar, cs)}.` };
    await sh.inserirRec(r);
    return { recorrente: serie(r) };
  }
  const r = achaSerie(sh, d.id);
  if (acao === 'excluir') { await sh.excluirRec(r.rowId); return { ok: true, id: r.id }; }
  if (acao === 'cancelar') {
    if (r.status !== 'Ativa') throw new Erro(400, 'A série já está cancelada.');
    const obs = C.addObs(r.obs, `Cancelada pelo admin em ${carimbo(agora)}.`);
    await sh.atualizarRec(r.rowId, { status: 'Cancelada', obs });
    return { recorrente: serie({ ...r, status: 'Cancelada', obs }) };
  }
  if (acao === 'reativar') {
    if (r.status === 'Ativa') throw new Erro(400, 'A série já está ativa.');
    const cs = conflitoSerie(sh, r, r.id, forcar, agora);
    const obs = C.addObs(r.obs, `Reativada pelo admin em ${carimbo(agora)}${sufixo(forcar, cs)}.`);
    await sh.atualizarRec(r.rowId, { status: 'Ativa', obs });
    return { recorrente: serie({ ...r, status: 'Ativa', obs }) };
  }
  if (acao === 'editar') {
    const { v, erro } = C.normalizarRec({ ...r, ...Object.fromEntries(['dia', 'inicio', 'fim', 'responsavel', 'motivo', 'vigIni', 'vigFim'].filter((k) => d[k] !== undefined).map((k) => [k, d[k]])) }, agora);
    if (erro) throw new Erro(400, erro);
    const campos = Object.keys(v).filter((k) => v[k] !== r[k]);
    if (!campos.length) throw new Erro(400, 'Nenhuma alteração informada.');
    const cs = r.status === 'Ativa' ? conflitoSerie(sh, v, r.id, forcar, agora) : [];
    const obs = C.addObs(r.obs, `Editada pelo admin em ${carimbo(agora)} (${campos.map((k) => `${k}: ${r[k] || '—'} → ${v[k] || '—'}`).join('; ')})${sufixo(forcar, cs)}.`);
    await sh.atualizarRec(r.rowId, { ...v, obs });
    return { recorrente: serie({ ...r, ...v, obs }) };
  }
  throw new Erro(400, 'Ação inválida.');
}

module.exports = { todas, serie, recorrente, pub, adm, criar, editar, cancelarAdmin, reativar, excluir, cancelarPublico };
