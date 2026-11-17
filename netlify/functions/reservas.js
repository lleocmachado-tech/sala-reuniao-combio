'use strict';
// GET /api/reservas?data=AAAA-MM-DD  ou  ?de=AAAA-MM-DD&ate=AAAA-MM-DD  -> só reservas ATIVAS, sem PIN/hash.
const { rota } = require('../lib/http');
const C = require('../lib/core');
const { pub } = require('../lib/ops');

exports.handler = rota({ metodo: 'GET', cdn: 20 }, async ({ query, agora, abrir }) => {
  const de = query.data || query.de, ate = query.data || query.ate || de;
  if (!C.isData(de || '') || !C.isData(ate || '')) throw new C.Erro(400, 'Informe ?data=AAAA-MM-DD ou ?de=...&ate=...');
  if (ate < de || (Date.parse(ate) - Date.parse(de)) / 864e5 > 62) throw new C.Erro(400, 'Período inválido (máximo de 62 dias).');
  const sh = await abrir();
  const reservas = [...sh.reservas, ...C.expandir(sh.recorrentes, de, ate)]
    .filter((r) => r.status === 'Ativa' && r.data >= de && r.data <= ate)
    .sort((a, b) => (a.data + a.inicio).localeCompare(b.data + b.inicio))
    .map(pub); // inclui ocorrências das reuniões recorrentes
  return { reservas, agora: { data: agora.data, hora: C.toHHMM(agora.min) } };
});
