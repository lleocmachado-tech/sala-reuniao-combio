'use strict';
// Agendada (netlify.toml): lê a planilha a cada poucos minutos para o Apps Script não "esfriar" (a 1ª chamada após ociosidade chega a travar 25 s+).
const { abrir } = require('../lib/sheet');
exports.handler = async () => { try { await abrir(); return { statusCode: 200, body: 'ok' }; } catch (e) { return { statusCode: 200, body: 'falhou: ' + e.message }; } };
