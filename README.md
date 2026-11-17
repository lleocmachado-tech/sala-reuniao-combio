# Marcador de Sala de Reunião · COMBIO

Simples assim:

- **Netlify** hospeda só a parte visual (`public/index.html`).
- **Google Sheets** guarda tudo (abas `Reservas` e `Recorrentes`).
- **Google Apps Script** (`apps-script/Code.gs`) é o backend: roda dentro da planilha, aplica as regras e lê/grava as linhas.
- **Painel admin** (`local/admin_marcador_sala.html`) é um arquivo no seu computador. Nunca vai para o Netlify nem para o GitHub.

O painel público e o admin conversam direto com a URL do Apps Script. Não há servidor, variável de ambiente nem chave secreta no site.

## Como funciona

| Quem | O que faz |
|---|---|
| Painel público (Netlify) | Vê a semana (livre/ocupado, uma cor por responsável), reserva (recebe um PIN de 4 dígitos) e cancela com o PIN |
| Painel admin (local) | Calendário da semana: clicar cria, clicar numa reunião edita, arrastar remaneja, puxar a borda muda o fim. Reuniões recorrentes (para sempre, por N semanas ou até uma data) e senha de admin |
| Apps Script | Valida 07:00–18:00 em blocos de 30 min, sem passado, sem conflito (encostar vale), PIN só como hash, limite de tentativas, uma gravação por vez |

## Configurar (uma vez)

1. **Planilha:** abas `Reservas` e `Recorrentes` com os cabeçalhos da linha 1 (veja `Code.gs`, constantes `RES` e `REC`).
2. **Apps Script:** na planilha, Extensões → Apps Script. Cole `apps-script/Code.gs`, troque `ADMIN_SENHA` e `PIN_SAL` no topo e salve.
   - Implantar → Nova implantação → Aplicativo da Web → executar como **você**, acesso **Qualquer pessoa**.
   - Copie a URL (termina em `/exec`).
   - Depois de qualquer mudança no código: Implantar → Gerenciar implantações → lápis → **Nova versão** (a URL continua a mesma).
3. **Painel público:** em `public/index.html`, a constante `API` recebe essa URL.
4. **Netlify:** o site está ligado ao repositório do GitHub; cada push na `main` publica sozinho (publicar a pasta `public`).
5. **Painel admin:** abra `local/admin_marcador_sala.html`, informe a URL do Apps Script e a senha de admin.

## Observações

- Datas em `dd/mm/aaaa`, fuso America/Sao_Paulo.
- A leitura pública tem cache de 15 s no Apps Script; qualquer gravação limpa o cache.
- O Google às vezes trava uma chamada. Os painéis desistem em 10 s e repetem até 3 vezes; cada gravação leva um código (`reqId`) e o servidor nunca grava duas vezes o mesmo envio.
- Testes: `node --test tests/backend.test.js` roda o `Code.gs` de verdade, com uma planilha falsa em memória.
- Checklist manual: `CHECKLIST_TESTES.md`. Teste contra a planilha real: `node local/checklist_vivo.js` (cria e apaga reservas de teste).
