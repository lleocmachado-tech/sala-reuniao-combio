'use strict';
// Acesso à planilha Google via Apps Script (web app), sem npm e sem conta de serviço.
// Colunas são resolvidas pelo TÍTULO da linha 1 de cada aba (nunca por posição fixa).
const { Erro } = require('./core');

const RES = {
  nome: 'Reservas',
  cols: { 'ID Reserva': 'id', 'Data': 'data', 'Início': 'inicio', 'Fim': 'fim', 'Responsável': 'responsavel', 'Motivo': 'motivo', 'PIN (hash)': 'pinHash', 'Status': 'status', 'Criado em': 'criadoEm', 'Origem': 'origem', 'Observação admin': 'obs' },
};
const REC = {
  nome: 'Recorrentes',
  cols: { 'ID Série': 'id', 'Dia da semana': 'dia', 'Início': 'inicio', 'Fim': 'fim', 'Responsável': 'responsavel', 'Motivo': 'motivo', 'Status': 'status', 'Vigência início': 'vigIni', 'Vigência fim': 'vigFim', 'Criado em': 'criadoEm', 'Observação admin': 'obs' },
};
const norm = (s) => String(s || '').normalize('NFC').trim().toLowerCase();

// Chamada à ponte Apps Script (apps-script/Code.gs). Uma única URL, ação no corpo.
async function chamar(dados) {
  const url = process.env.APPS_SCRIPT_URL, chave = process.env.APPS_SCRIPT_KEY;
  if (!url || !chave) throw new Erro(500, 'Servidor sem configuração: variáveis APPS_SCRIPT_URL / APPS_SCRIPT_KEY ausentes.');
  let j, r, txt;
  // ponytail: o Apps Script falha de vez em quando (HTML de erro/rede). Repetimos só o que é seguro repetir:
  // leitura e atualização (idempotentes). Inserir/excluir não, para não duplicar nem apagar a linha errada.
  const tentativas = ['ler', 'atualizar'].includes(dados.acao) ? 3 : 1;
  for (let t = 0; t < tentativas && !j; t++) {
    if (t) await new Promise((ok) => setTimeout(ok, 700));
    try {
      r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ chave, ...dados }), redirect: 'follow', signal: AbortSignal.timeout(12000) });
      txt = await r.text();
      try { j = JSON.parse(txt); } catch { console.error('Apps Script resposta não-JSON', r.status, txt.slice(0, 200)); }
    } catch (e) { console.error('Apps Script rede', e.name); }
  }
  if (!j) throw new Erro(502, 'A planilha não respondeu agora. Tente de novo; se persistir, confira se o Apps Script está implantado com acesso "Qualquer pessoa" e se a URL termina em /exec.');
  if (j.erro) { console.error('Apps Script', j.erro); throw new Erro(502, 'Planilha recusou a operação: ' + j.erro); }
  return j;
}

function parse(def, linhas) {
  const [cab = [], ...resto] = linhas || [];
  const idx = {};
  cab.forEach((t, i) => { const e = Object.entries(def.cols).find(([tit]) => norm(tit) === norm(t)); if (e) idx[e[1]] = i; });
  const faltam = Object.entries(def.cols).filter(([, k]) => idx[k] === undefined).map(([t]) => t);
  if (faltam.length) throw new Erro(500, `Colunas ausentes na aba "${def.nome}": ${faltam.join(', ')}`);
  const itens = [];
  resto.forEach((l, i) => {
    const o = { rowId: i + 2 };
    for (const k in idx) o[k] = l[idx[k]] == null ? '' : String(l[idx[k]]);
    if (o.id) itens.push(o);
  });
  return { itens, idx };
}

async function abrir() { return montar(await chamar({ acao: 'ler' })); }

function montar(j) {
  let snap = null; // retrato devolvido pelo último 'inserir' (evita reler a planilha na checagem de corrida)
  const a = parse(RES, j.reservas), b = parse(REC, j.recorrentes);
  a.itens.forEach((r) => { r.data = r.data.slice(0, 10); });

  const inserir = (def, idx) => async (obj) => {
    const linha = Array(Math.max(...Object.values(idx)) + 1).fill('');
    for (const k in idx) if (obj[k] != null) linha[idx[k]] = String(obj[k]);
    const r = await chamar({ acao: 'inserir', aba: def.nome, linha });
    if (r.reservas) snap = { reservas: r.reservas, recorrentes: r.recorrentes };
    return r.row;
  };
  const atualizar = (def, idx) => async (rowId, campos) => {
    const celulas = Object.entries(campos).filter(([k]) => idx[k] !== undefined).map(([k, v]) => ({ col: idx[k], valor: String(v) }));
    await chamar({ acao: 'atualizar', aba: def.nome, row: rowId, celulas });
  };
  const excluir = (def) => async (rowId) => { await chamar({ acao: 'excluir', aba: def.nome, row: rowId }); };

  return {
    reservas: a.itens, recorrentes: b.itens,
    inserir: inserir(RES, a.idx), atualizar: atualizar(RES, a.idx), excluir: excluir(RES),
    inserirRec: inserir(REC, b.idx), atualizarRec: atualizar(REC, b.idx), excluirRec: excluir(REC),
    recarregar: async () => { const x = snap; snap = null; return x ? montar(x) : abrir(); },
  };
}

module.exports = { abrir };
