'use strict';
// Casca comum das functions: método, CORS (admin), senha admin, limite de tentativas, erros em JSON.
const crypto = require('crypto');
const C = require('./core');
const { abrir } = require('./sheet');

const CORS = {
  'Access-Control-Allow-Origin': '*', // painel admin roda via file://
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Password',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const resp = (status, obj, cors) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...(cors ? CORS : {}) },
  body: status === 204 ? '' : JSON.stringify(obj),
});

// ponytail: contador em memória (por instância da function); basta contra tentativas casuais, use um WAF/serviço externo se precisar de mais.
const tentativas = new Map();
const JANELA = 15 * 60 * 1000;
const recentes = (k) => { const a = (tentativas.get(k) || []).filter((t) => Date.now() - t < JANELA); tentativas.set(k, a); return a; };
const bloqueado = (k, max = 5) => recentes(k).length >= max;
const registrarFalha = (k) => recentes(k).push(Date.now());

const hash = (s) => crypto.createHash('sha256').update(String(s)).digest();
const iguais = (a, b) => crypto.timingSafeEqual(hash(a), hash(b));

// fn({ query, body, agora, ip, abrir }) -> objeto JSON
function rota({ metodo, admin = false }, fn) {
  return async (event) => {
    try {
      if (event.httpMethod === 'OPTIONS') return resp(204, null, admin);
      if (event.httpMethod !== metodo) throw new C.Erro(405, 'Método não permitido.');
      const h = event.headers || {};
      const ip = h['x-nf-client-connection-ip'] || String(h['x-forwarded-for'] || '').split(',')[0].trim() || 'ip?';

      if (admin) {
        const chave = 'adm:' + ip;
        if (bloqueado(chave)) throw new C.Erro(429, 'Muitas tentativas incorretas. Aguarde alguns minutos.');
        if (!process.env.ADMIN_PASSWORD) throw new C.Erro(500, 'Servidor sem configuração: variável ADMIN_PASSWORD ausente.');
        if (!iguais(h['x-admin-password'] || '', process.env.ADMIN_PASSWORD)) {
          registrarFalha(chave);
          throw new C.Erro(401, 'Senha de admin incorreta.');
        }
      }
      let body = {};
      if (metodo === 'POST') {
        try { body = JSON.parse(event.body || '{}'); } catch { throw new C.Erro(400, 'Corpo da requisição inválido.'); }
      }
      const out = await fn({ query: event.queryStringParameters || {}, body, agora: C.agora(), ip, abrir });
      return resp(200, out, admin);
    } catch (e) {
      if (e instanceof C.Erro) return resp(e.status, { erro: e.message, ...e.extra }, admin);
      console.error(e);
      return resp(500, { erro: 'Erro interno. Tente novamente em instantes.' }, admin);
    }
  };
}

module.exports = { rota, bloqueado, registrarFalha };
