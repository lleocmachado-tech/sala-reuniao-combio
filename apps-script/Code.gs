/**
 * BACKEND ÚNICO do Marcador de Sala de Reunião COMBIO.
 * Vive dentro da planilha Google (Extensões > Apps Script) e é implantado como "Aplicativo da Web"
 * (executar como: você · acesso: qualquer pessoa). O site (Netlify) só hospeda a parte visual e chama esta URL.
 *
 * ANTES DE IMPLANTAR: troque ADMIN_SENHA e PIN_SAL abaixo (ou deixe os valores já preenchidos).
 * Trocar PIN_SAL depois de existirem reservas invalida os PINs antigos.
 */
const ADMIN_SENHA = 'TROQUE-ESTA-SENHA';
const PIN_SAL = 'TROQUE-ESTE-SAL';

const TZ = 'America/Sao_Paulo';
const ABRE = 7 * 60, FECHA = 18 * 60, BLOCO = 30;
const LIM = { responsavel: 60, motivo: 120, obs: 1000 };
const RES = { nome: 'Reservas', cols: { 'ID Reserva': 'id', 'Data': 'data', 'Início': 'inicio', 'Fim': 'fim', 'Responsável': 'responsavel', 'Motivo': 'motivo', 'PIN (hash)': 'pinHash', 'Status': 'status', 'Criado em': 'criadoEm', 'Origem': 'origem', 'Observação admin': 'obs' } };
const REC = { nome: 'Recorrentes', cols: { 'ID Série': 'id', 'Dia da semana': 'dia', 'Início': 'inicio', 'Fim': 'fim', 'Responsável': 'responsavel', 'Motivo': 'motivo', 'Status': 'status', 'Vigência início': 'vigIni', 'Vigência fim': 'vigFim', 'Criado em': 'criadoEm', 'Observação admin': 'obs' } };

// ======================= ENTRADA (HTTP) =======================
function doGet(e) { return responder(Object.assign({}, e.parameter)); }
function doPost(e) {
  let d = {};
  try { d = JSON.parse(e.postData.contents || '{}'); } catch (x) { return saida({ status: 400, erro: 'Corpo da requisição inválido.' }); }
  return responder(Object.assign({}, e.parameter, d));
}
const saida = (o) => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);

function responder(d) {
  try {
    const rota = String(d.rota || '');
    const ag = agora();
    if (rota === 'reservas') return saida(rReservas(d, ag));
    if (rota === 'reservar') return saida(comTrava(() => criar(abrir(), d, { origem: 'Painel', agora: ag }), d.reqId));
    if (rota === 'cancelar') return saida(comTrava(() => cancelarPublico(abrir(), d, { agora: ag }), d.reqId));
    if (rota.indexOf('admin-') === 0) {
      conferirAdmin(d.senha);
      const f = d.forcar === true;
      if (rota === 'admin-listar') return saida(rListar(d));
      return saida(comTrava(() => {
        const sh = abrir();
        switch (rota) {
          case 'admin-criar': return criar(sh, d, { origem: 'Admin', forcar: f, agora: ag });
          case 'admin-editar': return editar(sh, d, { forcar: f, agora: ag });
          case 'admin-cancelar': return cancelarAdmin(sh, d, { agora: ag });
          case 'admin-reativar': return reativar(sh, d, { forcar: f, agora: ag });
          case 'admin-excluir': return excluir(sh, d);
          case 'admin-recorrente': return recorrente(sh, d, { agora: ag });
        }
        throw new Erro(404, 'Rota desconhecida.');
      }, d.reqId));
    }
    throw new Erro(404, 'Rota desconhecida.');
  } catch (e) {
    if (e instanceof Erro) return saida(Object.assign({ status: e.status, erro: e.message }, e.extra));
    console.error(e && e.stack || e);
    return saida({ status: 500, erro: 'Erro interno. Tente novamente em instantes.' });
  }
}

// Só uma gravação por vez: validação + gravação ficam atômicas (sem corrida entre dois envios simultâneos).
// reqId (gerado pelo painel): se a resposta se perder e o painel repetir o envio, devolve o resultado já gravado em vez de gravar de novo.
function comTrava(fn, reqId) {
  const lock = LockService.getScriptLock(), c = CacheService.getScriptCache(), k = reqId ? 'rq' + String(reqId).slice(0, 64) : null;
  try { lock.waitLock(20000); } catch (e) { throw new Erro(503, 'Sistema ocupado. Tente novamente em instantes.'); }
  try {
    const antes = k && c.get(k);
    if (antes) return JSON.parse(antes);
    const r = fn(); invalidar();
    if (k) { try { c.put(k, JSON.stringify(r), 600); } catch (e) {} }
    return r;
  } finally { lock.releaseLock(); }
}

// Senha admin + bloqueio após tentativas erradas (global, 10 erros / 15 min).
function conferirAdmin(senha) {
  const c = CacheService.getScriptCache(), n = +(c.get('admfalhas') || 0);
  if (n >= 10) throw new Erro(429, 'Muitas tentativas incorretas. Aguarde alguns minutos.');
  if (!ADMIN_SENHA || ADMIN_SENHA.indexOf('TROQUE') === 0) throw new Erro(500, 'Defina ADMIN_SENHA no Apps Script.');
  if (String(senha || '') !== ADMIN_SENHA) { c.put('admfalhas', String(n + 1), 900); throw new Erro(401, 'Senha de admin incorreta.'); }
}

// Cache da leitura pública (15 s); qualquer gravação invalida tudo mudando a "versão".
const versao = () => CacheService.getScriptCache().get('ver') || '0';
const invalidar = () => CacheService.getScriptCache().put('ver', String(Date.now()), 21600);

// ======================= ROTAS DE LEITURA =======================
function rReservas(d, ag) {
  const de = d.data || d.de, ate = d.data || d.ate || de;
  if (!isData(de || '') || !isData(ate || '')) throw new Erro(400, 'Informe data=AAAA-MM-DD ou de=...&ate=...');
  if (ate < de || (Date.parse(ate) - Date.parse(de)) / 864e5 > 62) throw new Erro(400, 'Período inválido (máximo de 62 dias).');
  const c = CacheService.getScriptCache(), k = 'r' + versao() + de + ate;
  let lista = null;
  try { lista = JSON.parse(c.get(k)); } catch (e) {}
  if (!lista) {
    const sh = abrir();
    lista = sh.reservas.concat(expandir(sh.recorrentes, de, ate))
      .filter((r) => r.status === 'Ativa' && r.data >= de && r.data <= ate)
      .sort((a, b) => (a.data + a.inicio).localeCompare(b.data + b.inicio)).map(pub);
    try { c.put(k, JSON.stringify(lista), 15); } catch (e) {}
  }
  return { reservas: lista, agora: { data: ag.data, hora: toHHMM(ag.min) } };
}

function rListar(d) {
  const busca = String(d.q || '').trim().toLowerCase(), sh = abrir();
  let lista = sh.reservas;
  if (String(d.expandir) === '1' && isData(d.de || '') && isData(d.ate || '')) lista = lista.concat(expandir(sh.recorrentes, d.de, d.ate));
  const reservas = lista
    .filter((r) => (!d.de || r.data >= d.de) && (!d.ate || r.data <= d.ate))
    .filter((r) => !d.status || d.status === 'todas' || r.status === d.status)
    .filter((r) => !busca || r.responsavel.toLowerCase().indexOf(busca) >= 0)
    .sort((a, b) => (a.data + a.inicio).localeCompare(b.data + b.inicio)).map(adm);
  const recorrentes = sh.recorrentes.slice().sort((a, b) => diaIdx(a.dia) - diaIdx(b.dia) || a.inicio.localeCompare(b.inicio)).map(serie);
  return { reservas: reservas, recorrentes: recorrentes };
}

// ======================= PLANILHA =======================
const norm = (s) => String(s || '').normalize('NFC').trim().toLowerCase();
function lerAba(ss, def) {
  const aba = ss.getSheetByName(def.nome);
  if (!aba) throw new Erro(500, 'Aba não encontrada: ' + def.nome);
  const linhas = aba.getDataRange().getDisplayValues(), cab = linhas[0] || [], idx = {};
  cab.forEach((t, i) => { const e = Object.keys(def.cols).filter((tit) => norm(tit) === norm(t))[0]; if (e) idx[def.cols[e]] = i; });
  const faltam = Object.keys(def.cols).filter((tit) => idx[def.cols[tit]] === undefined);
  if (faltam.length) throw new Erro(500, 'Colunas ausentes na aba "' + def.nome + '": ' + faltam.join(', '));
  const itens = [];
  for (let i = 1; i < linhas.length; i++) {
    const o = { rowId: i + 1 };
    for (const k in idx) o[k] = linhas[i][idx[k]] == null ? '' : String(linhas[i][idx[k]]);
    if (o.id) itens.push(o);
  }
  return { aba: aba, itens: itens, idx: idx };
}
function abrir() {
  const ss = SpreadsheetApp.getActive(), a = lerAba(ss, RES), b = lerAba(ss, REC);
  a.itens.forEach((r) => { r.data = r.data.slice(0, 10); });
  const ins = (x) => (obj) => {
    const linha = new Array(Math.max.apply(null, Object.values(x.idx)) + 1).fill('');
    for (const k in x.idx) if (obj[k] != null) linha[x.idx[k]] = String(obj[k]);
    const row = x.aba.getLastRow() + 1, rg = x.aba.getRange(row, 1, 1, linha.length);
    rg.setNumberFormat('@'); rg.setValues([linha]);
    return row;
  };
  const upd = (x) => (row, campos) => {
    Object.keys(campos).forEach((k) => { if (x.idx[k] === undefined) return; const rg = x.aba.getRange(row, x.idx[k] + 1); rg.setNumberFormat('@'); rg.setValue(String(campos[k])); });
  };
  return {
    reservas: a.itens, recorrentes: b.itens,
    inserir: ins(a), atualizar: upd(a), excluir: (row) => a.aba.deleteRow(row),
    inserirRec: ins(b), atualizarRec: upd(b), excluirRec: (row) => b.aba.deleteRow(row),
  };
}

// ======================= REGRAS (puras) =======================
class Erro extends Error { constructor(status, msg, extra) { super(msg); this.status = status; this.extra = extra || {}; } }
const pad = (n) => String(n).padStart(2, '0');
function toMin(s) { const m = /^(\d{2}):(\d{2})$/.exec(String(s || '')); return (!m || +m[1] > 23 || +m[2] > 59) ? NaN : +m[1] * 60 + +m[2]; }
const toHHMM = (n) => pad(Math.floor(n / 60)) + ':' + pad(n % 60);
const fmtData = (iso) => iso.split('-').reverse().join('/');
const isData = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
function agora() {
  const d = new Date(), s = Utilities.formatDate(d, TZ, 'yyyy-MM-dd HH:mm');
  return { data: s.slice(0, 10), min: +s.slice(11, 13) * 60 + +s.slice(14, 16), iso: d.toISOString() };
}
function limpar(v) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^[=+\-@\s]+/, '');
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
  return (data < ag.data || (data === ag.data && toMin(inicio) < ag.min)) ? 'Não é possível reservar em data ou horário que já passou.' : null;
}
function normalizar(d) {
  const v = { data: String(d.data || '').trim(), inicio: String(d.inicio || '').trim(), fim: String(d.fim || '').trim(), responsavel: limpar(d.responsavel), motivo: limpar(d.motivo) };
  if (!v.responsavel) return { erro: 'Informe o nome do responsável.' };
  if (!v.motivo) return { erro: 'Informe o motivo da reunião.' };
  if (v.responsavel.length > LIM.responsavel) return { erro: 'Responsável: máximo de ' + LIM.responsavel + ' caracteres.' };
  if (v.motivo.length > LIM.motivo) return { erro: 'Motivo: máximo de ' + LIM.motivo + ' caracteres.' };
  if (!isData(v.data)) return { erro: 'Data inválida.' };
  const h = validarHorario(v.inicio, v.fim);
  if (h) return { erro: h };
  return { v: v };
}
// Conflito: mesma data, só Ativas, novoIni < fimExist E novoFim > iniExist (encostar é permitido).
function conflitos(lista, n, ignorarId) {
  const i = toMin(n.inicio), f = toMin(n.fim);
  return lista.filter((r) => r.status === 'Ativa' && r.data === n.data && r.id !== ignorarId && i < toMin(r.fim) && f > toMin(r.inicio))
    .sort((a, b) => toMin(a.inicio) - toMin(b.inicio));
}
function mensagemConflito(cs) {
  if (!cs.length) return 'Não foi possível reservar: outra reserva foi feita ao mesmo tempo para este horário. Escolha outro horário.';
  return 'Não foi possível reservar: a sala já está ocupada ' + cs.map((c) => 'das ' + c.inicio + ' às ' + c.fim + ' por ' + c.responsavel + ' (' + c.motivo + ')').join('; ') + '. Escolha outro horário.';
}
function hashPin(id, pin) {
  return Utilities.computeHmacSha256Signature(id + ':' + pin, PIN_SAL).map((b) => ('0' + (b & 255).toString(16)).slice(-2)).join('');
}
const pinConfere = (id, pin, hash) => hashPin(id, String(pin || '')) === String(hash || '');
const gerarPin = () => String(parseInt(Utilities.getUuid().replace(/-/g, '').slice(0, 8), 16) % 10000).padStart(4, '0');
function gerarId(existentes) { let id; do id = Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase(); while (existentes.indexOf(id) >= 0); return id; }
const addObs = (antiga, nova) => [antiga, nova].filter(Boolean).join(' | ').slice(-LIM.obs);

// ---- recorrência ----
const DIAS = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const diaIdx = (nome) => { const n = semAcento(nome).replace('-feira', ''); return DIAS.findIndex((d) => semAcento(d).replace('-feira', '') === n); };
const dow = (iso) => new Date(iso + 'T12:00:00Z').getUTCDay();
const addDias = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const sobrepoe = (a, b) => toMin(a.inicio) < toMin(b.fim) && toMin(a.fim) > toMin(b.inicio);
function expandir(series, de, ate) {
  const out = [];
  series.forEach((s) => {
    const k = diaIdx(s.dia);
    if (s.status !== 'Ativa' || k < 0) return;
    for (let d = de; d <= ate; d = addDias(d, 1)) {
      if (dow(d) !== k || (s.vigIni && d < s.vigIni) || (s.vigFim && d > s.vigFim)) continue;
      out.push({ id: s.id, data: d, inicio: s.inicio, fim: s.fim, responsavel: s.responsavel, motivo: s.motivo, status: 'Ativa', criadoEm: s.criadoEm, origem: 'Recorrente', obs: '', recorrente: true });
    }
  });
  return out;
}
function normalizarRec(d, ag) {
  const k = diaIdx(d.dia);
  if (k < 0) return { erro: 'Dia da semana inválido.' };
  const v = { dia: DIAS[k], inicio: String(d.inicio || '').trim(), fim: String(d.fim || '').trim(), responsavel: limpar(d.responsavel), motivo: limpar(d.motivo), vigIni: String(d.vigIni || ag.data).trim(), vigFim: String(d.vigFim || '').trim() };
  if (!v.responsavel) return { erro: 'Informe o nome do responsável.' };
  if (!v.motivo) return { erro: 'Informe o motivo da reunião.' };
  if (v.responsavel.length > LIM.responsavel) return { erro: 'Responsável: máximo de ' + LIM.responsavel + ' caracteres.' };
  if (v.motivo.length > LIM.motivo) return { erro: 'Motivo: máximo de ' + LIM.motivo + ' caracteres.' };
  const h = validarHorario(v.inicio, v.fim);
  if (h) return { erro: h };
  if (!isData(v.vigIni) || (v.vigFim && !isData(v.vigFim))) return { erro: 'Data de vigência inválida.' };
  if (v.vigFim && v.vigFim < v.vigIni) return { erro: 'O fim da vigência deve ser depois do início.' };
  return { v: v };
}
function conflitosRec(rec, ctx, hoje, ignorarId) {
  const k = diaIdx(rec.dia), de = rec.vigIni > hoje ? rec.vigIni : hoje;
  const avulsas = ctx.reservas.filter((r) => r.status === 'Ativa' && r.data >= de && (!rec.vigFim || r.data <= rec.vigFim) && dow(r.data) === k && sobrepoe(rec, r));
  const outras = ctx.series.filter((o) => o.status === 'Ativa' && o.id !== ignorarId && diaIdx(o.dia) === k && sobrepoe(rec, o) && (!rec.vigFim || o.vigIni <= rec.vigFim) && (!o.vigFim || rec.vigIni <= o.vigFim)).map((o) => Object.assign({}, o, { serie: true }));
  return avulsas.concat(outras);
}
function mensagemConflitoRec(cs) {
  const t = cs.slice(0, 5).map((c) => (c.serie ? 'toda ' + c.dia.toLowerCase() + ' ' + c.inicio + '–' + c.fim + ' (recorrente)' : fmtData(c.data) + ' ' + c.inicio + '–' + c.fim) + ' por ' + c.responsavel + ' (' + c.motivo + ')');
  return 'Conflito de horário com: ' + t.join('; ') + (cs.length > 5 ? '; e mais ' + (cs.length - 5) : '') + '.';
}

// ======================= OPERAÇÕES =======================
const pub = (r) => ({ id: r.id, data: r.data, inicio: r.inicio, fim: r.fim, responsavel: r.responsavel, motivo: r.motivo, recorrente: !!r.recorrente });
const adm = (r) => Object.assign(pub(r), { status: r.status, criadoEm: r.criadoEm, origem: r.origem, obs: r.obs || '' });
const serie = (r) => ({ id: r.id, dia: r.dia, inicio: r.inicio, fim: r.fim, responsavel: r.responsavel, motivo: r.motivo, status: r.status, vigIni: r.vigIni, vigFim: r.vigFim, criadoEm: r.criadoEm, obs: r.obs || '' });
const carimbo = (ag) => fmtData(ag.data) + ' ' + toHHMM(ag.min);
const forcarTxt = (forcar, cs) => forcar ? ' com "forçar"' + (cs.length ? ', ignorando conflito com ' + cs.map((c) => c.id).join(', ') : '') : '';
const todas = (sh, de, ate) => sh.reservas.concat(expandir(sh.recorrentes, de, ate));
function achar(sh, id) {
  const r = sh.reservas.filter((x) => x.id === String(id || '').trim().toUpperCase())[0];
  if (!r) throw new Erro(404, 'Reserva não encontrada.');
  return r;
}
function checarConflito(sh, v, ignorarId, forcar) {
  const cs = conflitos(todas(sh, v.data, v.data), v, ignorarId);
  if (cs.length && !forcar) throw new Erro(409, mensagemConflito(cs), { conflitos: cs.map(pub) });
  return cs;
}
function criar(sh, d, o) {
  const n = normalizar(d);
  if (n.erro) throw new Erro(400, n.erro);
  const v = n.v, forcar = o.forcar === true;
  if (!forcar) { const e = validarPassado(v.data, v.inicio, o.agora); if (e) throw new Erro(400, e); }
  const cs = checarConflito(sh, v, null, forcar);
  const id = gerarId(sh.reservas.map((r) => r.id).concat(sh.recorrentes.map((r) => r.id))), pin = gerarPin();
  const r = Object.assign({ id: id }, v, { pinHash: hashPin(id, pin), status: 'Ativa', criadoEm: o.agora.iso, origem: o.origem, obs: forcar ? 'Criada pelo admin em ' + carimbo(o.agora) + forcarTxt(true, cs) + '.' : '' });
  sh.inserir(r);
  return { reserva: pub(r), pin: pin };
}
function editar(sh, d, o) {
  const r = achar(sh, d.id), forcar = o.forcar === true;
  const n = normalizar({ data: d.data != null ? d.data : r.data, inicio: d.inicio != null ? d.inicio : r.inicio, fim: d.fim != null ? d.fim : r.fim, responsavel: d.responsavel != null ? d.responsavel : r.responsavel, motivo: d.motivo != null ? d.motivo : r.motivo });
  if (n.erro) throw new Erro(400, n.erro);
  const v = n.v, campos = ['data', 'inicio', 'fim', 'responsavel', 'motivo'].filter((k) => v[k] !== r[k]);
  if (!campos.length) throw new Erro(400, 'Nenhuma alteração informada.');
  if (!forcar && campos.some((k) => ['data', 'inicio', 'fim'].indexOf(k) >= 0)) { const e = validarPassado(v.data, v.inicio, o.agora); if (e) throw new Erro(400, e); }
  const cs = r.status === 'Ativa' ? checarConflito(sh, v, r.id, forcar) : [];
  const obs = addObs(r.obs, 'Editada pelo admin em ' + carimbo(o.agora) + ' (' + campos.map((k) => k + ': ' + r[k] + ' → ' + v[k]).join('; ') + ')' + forcarTxt(forcar, cs) + '.');
  sh.atualizar(r.rowId, Object.assign({}, v, { obs: obs }));
  return { reserva: adm(Object.assign({}, r, v, { obs: obs })) };
}
function cancelarAdmin(sh, d, o) {
  const r = achar(sh, d.id);
  if (r.status !== 'Ativa') throw new Erro(400, 'A reserva já está cancelada.');
  const motivo = limpar(d.motivo).slice(0, 200), obs = addObs(r.obs, 'Cancelada pelo admin em ' + carimbo(o.agora) + (motivo ? ': ' + motivo : '') + '.');
  sh.atualizar(r.rowId, { status: 'Cancelada', obs: obs });
  return { reserva: adm(Object.assign({}, r, { status: 'Cancelada', obs: obs })) };
}
function reativar(sh, d, o) {
  const r = achar(sh, d.id), forcar = o.forcar === true;
  if (r.status === 'Ativa') throw new Erro(400, 'A reserva já está ativa.');
  const cs = checarConflito(sh, r, r.id, forcar), obs = addObs(r.obs, 'Reativada pelo admin em ' + carimbo(o.agora) + forcarTxt(forcar, cs) + '.');
  sh.atualizar(r.rowId, { status: 'Ativa', obs: obs });
  return { reserva: adm(Object.assign({}, r, { status: 'Ativa', obs: obs })) };
}
function excluir(sh, d) { const r = achar(sh, d.id); sh.excluir(r.rowId); return { ok: true, id: r.id }; }

// PIN errado e "não existe" têm a mesma mensagem. Limite: 5 erros por reserva em 15 min.
function cancelarPublico(sh, d, o) {
  const id = String(d.id || '').trim().toUpperCase(), c = CacheService.getScriptCache(), k = 'pin' + id, n = +(c.get(k) || 0);
  if (n >= 5) throw new Erro(429, 'Muitas tentativas incorretas. Aguarde alguns minutos.');
  const r = sh.reservas.filter((x) => x.id === id)[0];
  if (!r || !pinConfere(r.id, d.pin, r.pinHash)) { c.put(k, String(n + 1), 900); throw new Erro(403, 'Reserva não encontrada ou PIN incorreto.'); }
  if (r.status !== 'Ativa') throw new Erro(400, 'Esta reserva já estava cancelada.');
  const obs = addObs(r.obs, 'Cancelada pelo painel público em ' + carimbo(o.agora) + '.');
  sh.atualizar(r.rowId, { status: 'Cancelada', obs: obs });
  return { ok: true, reserva: pub(r) };
}

function achaSerie(sh, id) {
  const r = sh.recorrentes.filter((x) => x.id === String(id || '').trim().toUpperCase())[0];
  if (!r) throw new Erro(404, 'Reunião recorrente não encontrada.');
  return r;
}
function conflitoSerie(sh, v, ignorarId, forcar, ag) {
  const cs = conflitosRec(v, { reservas: sh.reservas, series: sh.recorrentes }, ag.data, ignorarId);
  if (cs.length && !forcar) throw new Erro(409, mensagemConflitoRec(cs));
  return cs;
}
function recorrente(sh, d, o) {
  const forcar = d.forcar === true, acao = d.acao, ag = o.agora;
  if (acao === 'criar') {
    const n = normalizarRec(d, ag);
    if (n.erro) throw new Erro(400, n.erro);
    const cs = conflitoSerie(sh, n.v, null, forcar, ag);
    const r = Object.assign({ id: gerarId(sh.reservas.map((x) => x.id).concat(sh.recorrentes.map((x) => x.id))) }, n.v, { status: 'Ativa', criadoEm: ag.iso, obs: 'Criada pelo admin em ' + carimbo(ag) + forcarTxt(forcar, cs) + '.' });
    sh.inserirRec(r);
    return { recorrente: serie(r) };
  }
  const r = achaSerie(sh, d.id);
  if (acao === 'excluir') { sh.excluirRec(r.rowId); return { ok: true, id: r.id }; }
  if (acao === 'cancelar') {
    if (r.status !== 'Ativa') throw new Erro(400, 'A série já está cancelada.');
    const obs = addObs(r.obs, 'Cancelada pelo admin em ' + carimbo(ag) + '.');
    sh.atualizarRec(r.rowId, { status: 'Cancelada', obs: obs });
    return { recorrente: serie(Object.assign({}, r, { status: 'Cancelada', obs: obs })) };
  }
  if (acao === 'reativar') {
    if (r.status === 'Ativa') throw new Erro(400, 'A série já está ativa.');
    const cs = conflitoSerie(sh, r, r.id, forcar, ag), obs = addObs(r.obs, 'Reativada pelo admin em ' + carimbo(ag) + forcarTxt(forcar, cs) + '.');
    sh.atualizarRec(r.rowId, { status: 'Ativa', obs: obs });
    return { recorrente: serie(Object.assign({}, r, { status: 'Ativa', obs: obs })) };
  }
  if (acao === 'editar') {
    const base = Object.assign({}, r);
    ['dia', 'inicio', 'fim', 'responsavel', 'motivo', 'vigIni', 'vigFim'].forEach((k) => { if (d[k] !== undefined) base[k] = d[k]; });
    const n = normalizarRec(base, ag);
    if (n.erro) throw new Erro(400, n.erro);
    const v = n.v, campos = Object.keys(v).filter((k) => v[k] !== r[k]);
    if (!campos.length) throw new Erro(400, 'Nenhuma alteração informada.');
    const cs = r.status === 'Ativa' ? conflitoSerie(sh, v, r.id, forcar, ag) : [];
    const obs = addObs(r.obs, 'Editada pelo admin em ' + carimbo(ag) + ' (' + campos.map((k) => k + ': ' + (r[k] || '—') + ' → ' + (v[k] || '—')).join('; ') + ')' + forcarTxt(forcar, cs) + '.');
    sh.atualizarRec(r.rowId, Object.assign({}, v, { obs: obs }));
    return { recorrente: serie(Object.assign({}, r, v, { obs: obs })) };
  }
  throw new Erro(400, 'Ação inválida.');
}
