'use strict';
// GET /api/admin-listar?de=&ate=&status=Ativa|Cancelada|todas&q=texto[&expandir=1]
// expandir=1 inclui as ocorrências das reuniões recorrentes (usado na linha do tempo). Sempre devolve também as séries.
const { rota } = require('../lib/http');
const C = require('../lib/core');
const { adm, serie } = require('../lib/ops');

exports.handler = rota({ metodo: 'GET', admin: true }, async ({ query, abrir }) => {
  const { de, ate, status, q, expandir } = query;
  const busca = String(q || '').trim().toLowerCase();
  const sh = await abrir();
  let lista = sh.reservas;
  if (expandir === '1' && C.isData(de || '') && C.isData(ate || '')) lista = [...lista, ...C.expandir(sh.recorrentes, de, ate)];
  const reservas = lista
    .filter((r) => (!de || r.data >= de) && (!ate || r.data <= ate))
    .filter((r) => !status || status === 'todas' || r.status === status)
    .filter((r) => !busca || r.responsavel.toLowerCase().includes(busca))
    .sort((a, b) => (a.data + a.inicio).localeCompare(b.data + b.inicio))
    .map(adm);
  const recorrentes = sh.recorrentes.sort((a, b) => C.diaIdx(a.dia) - C.diaIdx(b.dia) || a.inicio.localeCompare(b.inicio)).map(serie);
  return { reservas, recorrentes };
});
