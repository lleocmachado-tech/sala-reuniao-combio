'use strict';
const { rota } = require('../lib/http');
const ops = require('../lib/ops');

exports.handler = rota({ metodo: 'POST' }, async ({ body, agora, abrir }) =>
  ops.criar(await abrir(), body, { origem: 'Painel', agora }));
