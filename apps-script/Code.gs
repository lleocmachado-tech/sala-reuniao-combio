/**
 * Ponte entre o site (Netlify) e esta planilha.
 * Cole este código em: Extensões > Apps Script (dentro da planilha), troque a CHAVE e implante como Aplicativo da Web.
 * A mesma CHAVE deve ser cadastrada no Netlify na variável APPS_SCRIPT_KEY.
 */
const CHAVE = 'TROQUE-ESTA-CHAVE-POR-UM-TEXTO-LONGO-E-ALEATORIO';

function doPost(e) {
  let r;
  try {
    const d = JSON.parse(e.postData.contents);
    if (d.chave !== CHAVE) throw new Error('Chave inválida');
    r = executar(d);
  } catch (err) {
    r = { erro: String(err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(r)).setMimeType(ContentService.MimeType.JSON);
}

function aba(nome) {
  const s = SpreadsheetApp.getActive().getSheetByName(nome);
  if (!s) throw new Error('Aba não encontrada: ' + nome);
  return s;
}

function executar(d) {
  if (d.acao === 'ler') {
    return {
      reservas: aba('Reservas').getDataRange().getDisplayValues(),
      recorrentes: aba('Recorrentes').getDataRange().getDisplayValues(),
    };
  }
  const lock = LockService.getScriptLock(); // grava uma operação por vez
  lock.waitLock(15000);
  try {
    const s = aba(d.aba);
    if (d.acao === 'inserir') {
      const row = s.getLastRow() + 1;
      const rg = s.getRange(row, 1, 1, d.linha.length);
      rg.setNumberFormat('@'); // tudo como texto (datas e horas não são convertidas)
      rg.setValues([d.linha]);
      SpreadsheetApp.flush();
      return { row: row, reservas: aba('Reservas').getDataRange().getDisplayValues(), recorrentes: aba('Recorrentes').getDataRange().getDisplayValues() };
    }
    if (d.acao === 'atualizar') {
      d.celulas.forEach(function (c) {
        const rg = s.getRange(d.row, c.col + 1);
        rg.setNumberFormat('@');
        rg.setValue(c.valor);
      });
      SpreadsheetApp.flush();
      return { ok: true };
    }
    if (d.acao === 'excluir') {
      s.deleteRow(d.row);
      return { ok: true };
    }
    throw new Error('Ação inválida');
  } finally {
    lock.releaseLock();
  }
}
