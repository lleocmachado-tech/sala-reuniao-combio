'use strict';
// POST /api/admin-recorrente  { acao: criar|editar|cancelar|reativar|excluir, id?, dia, inicio, fim, responsavel, motivo, vigIni?, vigFim?, forcar? }
const { rota } = require('../lib/http');
const ops = require('../lib/ops');

exports.handler = rota({ metodo: 'POST', admin: true }, async ({ body, agora, abrir }) =>
  ops.recorrente(await abrir(), body, { agora }));
