# Marcador de Sala de Reunião · COMBIO

Simples assim:

- **GitHub Pages** hospeda só a parte visual (pasta `public`: painel e admin).
- **Google Sheets** guarda tudo (abas `Reservas` e `Recorrentes`).
- **Google Apps Script** (`apps-script/Code.gs`) é o backend: roda dentro da planilha, aplica as regras e lê/grava as linhas.
- **Painel admin** (`public/admin.html`) fica no mesmo site e abre pelo botão discreto ⚙ no canto superior direito do painel (senha `007`).

O painel público e o admin conversam direto com a URL do Apps Script. Não há servidor nem variável de ambiente. A senha do admin (`007`) está embutida no site: só impede acesso casual, quem ler o código-fonte a vê.

## Como funciona

| Quem | O que faz |
|---|---|
| Painel público (Pages) | Vê a semana (livre/ocupado, uma cor por responsável), reserva e cancela sem PIN (o cancelamento libera o horário e vira uma pendência no admin) |
| Painel admin (local) | Calendário da semana: clicar cria, clicar numa reunião edita, arrastar remaneja, puxar a borda muda o fim. Reuniões recorrentes (para sempre, por N semanas ou até uma data) e senha de admin |
| Apps Script | Valida 07:00–18:00 em blocos de 30 min, sem passado, sem conflito (encostar vale), uma gravação por vez |

## Configurar (uma vez)

1. **Planilha:** abas `Reservas` e `Recorrentes` com os cabeçalhos da linha 1 (veja `Code.gs`, constantes `RES` e `REC`).
2. **Apps Script:** na planilha, Extensões → Apps Script. Cole `apps-script/Code.gs`, troque `ADMIN_SENHA` no topo por `007` (igual à do painel) e salve. A coluna `PIN (hash)` da planilha continua existindo, mas fica vazia.
   - Implantar → Nova implantação → Aplicativo da Web → executar como **você**, acesso **Qualquer pessoa**.
   - Copie a URL (termina em `/exec`).
   - Depois de qualquer mudança no código: Implantar → Gerenciar implantações → lápis → **Nova versão** (a URL continua a mesma).
3. **Painel público:** em `public/index.html`, a constante `API` recebe essa URL.
4. **Hospedagem (GitHub Pages):** o site é publicado pela pasta `public` por `.github/workflows/pages.yml`; cada push na `main` publica sozinho. Endereço: https://lleocmachado-tech.github.io/sala-reuniao-combio/
5. **Painel admin:** nada a configurar; `public/admin.html` já usa a mesma `API` e a senha `007`.

## Observações

- Datas em `dd/mm/aaaa`, fuso America/Sao_Paulo.
- A leitura pública tem cache de 15 s no Apps Script; qualquer gravação limpa o cache.
- O Google às vezes trava uma chamada. Os painéis desistem em 10 s e repetem até 3 vezes; cada gravação leva um código (`reqId`) e o servidor nunca grava duas vezes o mesmo envio.
- Testes: `node --test tests/backend.test.js` roda o `Code.gs` de verdade, com uma planilha falsa em memória.
- Checklist manual: `CHECKLIST_TESTES.md`. Teste contra a planilha real: `node local/checklist_vivo.js` (cria e apaga reservas de teste).
