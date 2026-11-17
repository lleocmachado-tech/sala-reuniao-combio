'use strict';
// Regras de negócio PURAS (sem rede, sem planilha). Testadas em tests/core.test.js.
const crypto = require('crypto');

const ABRE = 7 * 60;   // 07:00
const FECHA = 18 * 60; // 18:00
const BLOCO = 30;
const LIM = { responsavel: 60, motivo: 120, obs: 1000 };

class Erro extends Error {
  constructor(status, msg, extra) { super(msg); this.status = status; this.extra = extra || {}; }
}

const pad = (n) => String(n).padStart(2, '0');
const toMin = (s) => {
  const m = /^(\d{2}):(\d{2})$/.exec(String(s || ''));
  if (!m || +m[1] > 23 || +m[2] > 59) return NaN;
  return +m[1] * 60 + +m[2];
};
const toHHMM = (n) => pad(Math.floor(n / 60)) + ':' + pad(n % 60);
const fmtData = (iso) => iso.split('-').reverse().join('/');
const isData = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;

// "Agora" no fuso de São Paulo.
function agora(d = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(d).map((x) => [x.type, x.value])
  );
  return { data: `${p.year}-${p.month}-${p.day}`, min: +p.hour * 60 + +p.minute, iso: d.toISOString() };
}

// Texto livre: remove controles, colapsa espaços e tira caracteres iniciais que o Google Sheets poderia ler como fórmula.
function limpar(v) {
  return String(v == null ? '' : v)
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[=+\-@\s]+/, '');
}

function validarHorario(inicio, fim) {
  const i = toMin(inicio), f = toMin(fim);
  if (isNaN(i) || isNaN(f)) return 'Horário inválido. Use o formato HH:MM.';
  if (i % BLOCO || f % BLOCO) return 'Início e fim devem ser múltiplos de 30 minutos.';
  if (i < ABRE || f > FECHA) return 'A sala funciona das 07:00 às 18:00.';
  if (f <= i) return 'O horário de fim deve ser depois do horário de início.';
  return null;
}

function validarPassado(data, inicio, ag) {
  if (data < ag.data || (data === ag.data && toMin(inicio) < ag.min))
    return 'Não é possível reservar em data ou horário que já passou.';
  return null;
}

// Retorna { v } (campos limpos) ou { erro }.
function normalizar(d) {
  const v = {
    data: String(d.data || '').trim(),
    inicio: String(d.inicio || '').trim(),
    fim: String(d.fim || '').trim(),
    responsavel: limpar(d.responsavel),
    motivo: limpar(d.motivo),
  };
  if (!v.responsavel) return { erro: 'Informe o nome do responsável.' };
  if (!v.motivo) return { erro: 'Informe o motivo da reunião.' };
  if (v.responsavel.length > LIM.responsavel) return { erro: `Responsável: máximo de ${LIM.responsavel} caracteres.` };
  if (v.motivo.length > LIM.motivo) return { erro: `Motivo: máximo de ${LIM.motivo} caracteres.` };
  if (!isData(v.data)) return { erro: 'Data inválida.' };
  const h = validarHorario(v.inicio, v.fim);
  if (h) return { erro: h };
  return { v };
}

// Conflito: mesma data, só reservas Ativas, novoIni < fimExist E novoFim > iniExist.
function conflitos(lista, { data, inicio, fim }, ignorarId) {
  const i = toMin(inicio), f = toMin(fim);
  return lista
    .filter((r) => r.status === 'Ativa' && r.data === data && r.id !== ignorarId && i < toMin(r.fim) && f > toMin(r.inicio))
    .sort((a, b) => toMin(a.inicio) - toMin(b.inicio));
}

function mensagemConflito(cs) {
  if (!cs.length) return 'Não foi possível reservar: outra reserva foi feita ao mesmo tempo para este horário. Escolha outro horário.';
  const t = cs.map((c) => `das ${c.inicio} às ${c.fim} por ${c.responsavel} (${c.motivo})`).join('; ');
  return `Não foi possível reservar: a sala já está ocupada ${t}. Escolha outro horário.`;
}

// Corrida: entre reservas Ativas da mesma data, valem as mais antigas ("Criado em", depois ID).
// Aceita as reservas em ordem de criação, pulando as que sobrepõem alguma já aceita. true = "mine" venceu.
function vence(lista, mine) {
  const aceitas = [];
  const ordem = lista
    .filter((r) => r.status === 'Ativa' && r.data === mine.data)
    .sort((a, b) => (a.criadoEm + a.id < b.criadoEm + b.id ? -1 : 1));
  for (const r of ordem) {
    if (aceitas.some((a) => toMin(r.inicio) < toMin(a.fim) && toMin(r.fim) > toMin(a.inicio))) continue;
    aceitas.push(r);
    if (r.id === mine.id) return true;
  }
  return false;
}

// PIN: HMAC-SHA256 com o sal (PIN_SALT) e o ID da reserva. Nunca guardamos o PIN.
function hashPin(id, pin) {
  const sal = process.env.PIN_SALT;
  if (!sal) throw new Erro(500, 'Servidor sem configuração: variável PIN_SALT ausente.');
  return crypto.createHmac('sha256', sal).update(`${id}:${pin}`).digest('hex');
}
function pinConfere(id, pin, hash) {
  const a = Buffer.from(hashPin(id, String(pin || '')));
  const b = Buffer.from(String(hash || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const gerarPin = () => String(crypto.randomInt(0, 10000)).padStart(4, '0');
function gerarId(existentes) {
  let id;
  do id = crypto.randomBytes(4).toString('hex').toUpperCase(); while (existentes.includes(id));
  return id;
}

const addObs = (antiga, nova) => [antiga, nova].filter(Boolean).join(' | ').slice(-LIM.obs);


// ---------- Recorrência (reuniões semanais fixas, valem até serem canceladas) ----------
const DIAS = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const diaIdx = (nome) => { const n = semAcento(nome).replace('-feira', ''); return DIAS.findIndex((d) => semAcento(d).replace('-feira', '') === n); };
const dow = (iso) => new Date(iso + 'T12:00:00Z').getUTCDay();
const addDias = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const sobrepoe = (a, b) => toMin(a.inicio) < toMin(b.fim) && toMin(a.fim) > toMin(b.inicio);

// Gera as ocorrências (como reservas Ativas) das séries ativas entre as datas [de, ate].
function expandir(series, de, ate) {
  const out = [];
  for (const s of series) {
    const k = diaIdx(s.dia);
    if (s.status !== 'Ativa' || k < 0) continue;
    for (let d = de; d <= ate; d = addDias(d, 1)) {
      if (dow(d) !== k || (s.vigIni && d < s.vigIni) || (s.vigFim && d > s.vigFim)) continue;
      out.push({ id: s.id, data: d, inicio: s.inicio, fim: s.fim, responsavel: s.responsavel, motivo: s.motivo, status: 'Ativa', criadoEm: s.criadoEm, origem: 'Recorrente', obs: '', recorrente: true });
    }
  }
  return out;
}

function normalizarRec(d, ag) {
  const k = diaIdx(d.dia);
  if (k < 0) return { erro: 'Dia da semana inválido.' };
  const v = {
    dia: DIAS[k], inicio: String(d.inicio || '').trim(), fim: String(d.fim || '').trim(),
    responsavel: limpar(d.responsavel), motivo: limpar(d.motivo),
    vigIni: String(d.vigIni || ag.data).trim(), vigFim: String(d.vigFim || '').trim(),
  };
  if (!v.responsavel) return { erro: 'Informe o nome do responsável.' };
  if (!v.motivo) return { erro: 'Informe o motivo da reunião.' };
  if (v.responsavel.length > LIM.responsavel) return { erro: `Responsável: máximo de ${LIM.responsavel} caracteres.` };
  if (v.motivo.length > LIM.motivo) return { erro: `Motivo: máximo de ${LIM.motivo} caracteres.` };
  const h = validarHorario(v.inicio, v.fim);
  if (h) return { erro: h };
  if (!isData(v.vigIni) || (v.vigFim && !isData(v.vigFim))) return { erro: 'Data de vigência inválida.' };
  if (v.vigFim && v.vigFim < v.vigIni) return { erro: 'O fim da vigência deve ser depois do início.' };
  return { v };
}

// Conflitos de uma série com reservas avulsas futuras e com outras séries.
function conflitosRec(rec, { reservas, series }, hoje, ignorarId) {
  const k = diaIdx(rec.dia), de = rec.vigIni > hoje ? rec.vigIni : hoje;
  const avulsas = reservas.filter((r) => r.status === 'Ativa' && r.data >= de && (!rec.vigFim || r.data <= rec.vigFim) && dow(r.data) === k && sobrepoe(rec, r));
  const outras = series.filter((o) => o.status === 'Ativa' && o.id !== ignorarId && diaIdx(o.dia) === k && sobrepoe(rec, o)
    && (!rec.vigFim || o.vigIni <= rec.vigFim) && (!o.vigFim || rec.vigIni <= o.vigFim)).map((o) => ({ ...o, serie: true }));
  return [...avulsas, ...outras];
}
function mensagemConflitoRec(cs) {
  const t = cs.slice(0, 5).map((c) =>
    (c.serie ? `toda ${c.dia.toLowerCase()} ${c.inicio}–${c.fim} (recorrente)` : `${fmtData(c.data)} ${c.inicio}–${c.fim}`) +
    ` por ${c.responsavel} (${c.motivo})`);
  return 'Conflito de horário com: ' + t.join('; ') + (cs.length > 5 ? `; e mais ${cs.length - 5}` : '') + '.';
}

module.exports = {
  DIAS, diaIdx, dow, addDias, expandir, normalizarRec, conflitosRec, mensagemConflitoRec,
  ABRE, FECHA, BLOCO, LIM, Erro, toMin, toHHMM, fmtData, isData, agora, limpar,
  validarHorario, validarPassado, normalizar, conflitos, mensagemConflito, vence,
  hashPin, pinConfere, gerarPin, gerarId, addObs,
};
