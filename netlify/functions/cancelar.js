'use strict';
const { rota, bloqueado, registrarFalha } = require('../lib/http');
const { Erro } = require('../lib/core');
const ops = require('../lib/ops');

exports.handler = rota({ metodo: 'POST' }, async ({ body, agora, ip, abrir }) => {
  const chave = `pin:${ip}`;
  if (bloqueado(chave, 8)) throw new Erro(429, 'Muitas tentativas incorretas. Aguarde alguns minutos.');
  try {
    return await ops.cancelarPublico(await abrir(), body, { agora });
  } catch (e) {
    if (e.status === 403) registrarFalha(chave);
    throw e;
  }
});
