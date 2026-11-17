'use strict';
const { rota } = require('../lib/http');
const ops = require('../lib/ops');

exports.handler = rota({ metodo: 'POST', admin: true }, async ({ body, abrir }) => ops.excluir(await abrir(), body));
