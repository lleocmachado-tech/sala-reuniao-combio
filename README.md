# Marcador de Sala de Reunião — COMBIO

Dois painéis + back end numa planilha Google Sheets, intermediado por Netlify Functions.

| Peça | Arquivo | Onde roda |
|---|---|---|
| Painel 1 (público) | `public/index.html` | Netlify |
| Painel 2 (admin) | `local/admin_marcador_sala.html` | **Só no seu computador** (duplo clique) |
| API | `netlify/functions/*.js` (+ `netlify/lib/`) | Netlify |
| Ponte com a planilha | `apps-script/Code.gs` | Dentro da planilha Google (Apps Script) |
| Config | `netlify.toml` | Netlify |

> **O painel admin nunca vai para o Netlify.** O Netlify publica só a pasta `public/`, e a pasta `local/` está no `.gitignore`. Ao subir os arquivos pelo GitHub web, **não envie a pasta `local/`** nem os arquivos `.png` soltos.

Sem terminal e sem `npm`: as functions só usam recursos nativos do Node 18+.

---

## 1. Planilha (Google Sheets) — já criada

Planilha **Reservas Sala de Reunião COMBIO** (no seu Google Drive), ID:

`19mWMoBN8qbyrqofHEEZzXriDHUt7LhrNGnddsm5JE6E`

Duas abas (os títulos da linha 1 não podem ser mudados; a ordem das colunas pode):

- **Reservas** — `ID Reserva, Data, Início, Fim, Responsável, Motivo, PIN (hash), Status, Criado em, Origem, Observação admin`. Datas como `AAAA-MM-DD`, horas como `HH:MM` (texto).
- **Recorrentes** — `ID Série, Dia da semana, Início, Fim, Responsável, Motivo, Status, Vigência início, Vigência fim, Criado em, Observação admin`. Já contém as **12 reuniões da agenda semanal impressa**, todas com responsável "Planejamento Combio", vigência a partir de 17/11/2026 e **sem data final** (valem até você cancelar). Elas aparecem automaticamente em todas as semanas nos dois painéis e bloqueiam conflitos.

Para mudar o responsável (ou horário/motivo/dia) de uma delas: Painel admin → **Reuniões recorrentes → Editar**.

## 2. Ligar a planilha ao site (Apps Script) — sem Google Cloud

1. Abra a planilha → **Extensões → Apps Script**.
2. Apague o conteúdo do editor e cole **todo** o arquivo `apps-script/Code.gs` deste projeto.
3. Na 1ª linha de código, troque `TROQUE-ESTA-CHAVE-...` por uma chave longa e aleatória (30+ caracteres). **Anote-a**: será `APPS_SCRIPT_KEY` no Netlify. Salve (💾).
4. **Implantar → Nova implantação** → engrenagem ⚙ → **Aplicativo da Web**:
   - *Executar como*: **Eu**
   - *Quem pode acessar*: **Qualquer pessoa**
   - **Implantar** → **Autorizar acesso** → escolha sua conta → "Avançado" → "Acessar (nome do projeto) (não seguro)" → **Permitir** (é o seu próprio script).
5. Copie a **URL do app da Web** (termina em `/exec`): será `APPS_SCRIPT_URL`.
6. Se editar o código depois: **Implantar → Gerenciar implantações → ✏ → Versão: Nova versão → Implantar** (a URL continua a mesma).

A chave é o que protege a planilha: sem ela, a URL não devolve nada. Não a publique.

## 3. Subir os arquivos no GitHub (pela web)

1. github.com → **New repository** (ex.: `marcador-sala-combio`), **Private**, **Create**.
2. **Add file → Upload files** e arraste: `public/`, `netlify/`, `tests/`, `apps-script/`, `netlify.toml`, `README.md`, `CHECKLIST_TESTES.md`, `.gitignore` (mantendo as pastas — arrastar a pasta inteira preserva a estrutura).
   **Não envie `local/`.**
3. Mensagem do commit (Conventional Commits): `feat: adiciona marcador de sala de reunião` → **Commit changes**.

## 4. Ligar ao Netlify

1. app.netlify.com → **Add new site → Import an existing project → GitHub** → escolha o repositório.
2. Configurações de build: o `netlify.toml` já define tudo (publish `public`, functions `netlify/functions`). Deixe o *Build command* vazio. **Deploy**.
3. Em **Site configuration → Environment variables → Add a variable**, crie as 4 (valores sem aspas):

| Variável | Valor |
|---|---|
| `APPS_SCRIPT_URL` | URL `/exec` do passo 2.5 |
| `APPS_SCRIPT_KEY` | a chave do passo 2.3 |
| `ADMIN_PASSWORD` | senha longa que só você sabe |
| `PIN_SALT` | texto aleatório longo (ex.: 40 caracteres). **Não mude depois**, ou os PINs antigos deixam de valer |

4. **Deploys → Trigger deploy → Deploy site** (variáveis só valem após novo deploy).
5. (Opcional) **Domain management** para trocar o nome `xxxx.netlify.app`.

## 5. Usar e testar

- **Painel 1:** abra `https://SEU-SITE.netlify.app/`. Para TV, deixe em tela cheia (F11).
- **Painel 2:** dê duplo clique em `local/admin_marcador_sala.html`, preencha **URL do site Netlify** (`https://SEU-SITE.netlify.app`) e **Senha admin** → *Salvar e carregar*.
- Siga o `CHECKLIST_TESTES.md`.
- Se aparecer erro de "Colunas ausentes", confira os títulos da planilha. Se aparecer "O Apps Script não respondeu corretamente", confira a URL (/exec) e se o acesso está como "Qualquer pessoa". "Chave inválida" = `APPS_SCRIPT_KEY` diferente da chave do código.

### Logo
A logo (`logo_combio_branco_transparente(1).png`) já está embutida em base64 nos dois HTML (atributo `src` da `<img class="logo">`). Para trocar, gere o base64 do novo PNG e substitua o trecho depois de `base64,`.

---

## Como funcionam as regras (resumo)

- **Recorrentes:** cada série (dia da semana + horário, com vigência) vira ocorrências virtuais em todas as semanas. Reservas avulsas e outras séries passam pela mesma validação de conflito. Não há exceção por ocorrência: para uma semana específica, edite/cancele a série (ou use "forçar"). Cancelar a série vale para todas as próximas ocorrências.

- Validação **sempre no servidor**: 07:00–18:00, blocos de 30 min, sem passado, campos obrigatórios e limites (responsável 60, motivo 120 caracteres), caracteres `= + - @` no começo do texto são removidos (anti-fórmula).
- **Conflito:** mesma data, só reservas Ativas, `novoInício < fimExistente E novoFim > inícioExistente`. Reservas encostadas não conflitam. Resposta `409` com mensagem listando todos os conflitos.
- **Concorrência:** valida → insere → relê a data → se houver sobreposição, vale o "Criado em" mais antigo e a outra é cancelada automaticamente (o usuário recebe a mensagem de conflito). O Google Sheets não tem transações; isto reduz a janela de corrida ao mínimo, mas não a elimina por completo.
- **PIN:** 4 dígitos, mostrado uma única vez, guardado só como HMAC-SHA256 com `PIN_SALT` + ID.
- **Admin:** senha em cabeçalho `X-Admin-Password`; após 5 senhas erradas em 15 min o IP é bloqueado temporariamente (contador em memória, por instância da function). Edições passam pela mesma validação; "forçar" exige confirmação explícita e fica registrado em "Observação admin".
- **Endpoints** (`/api/...`): `reservas` (GET), `reservar`, `cancelar`, `admin-listar` (GET), `admin-criar`, `admin-editar`, `admin-cancelar`, `admin-reativar`, `admin-excluir`. Também: `admin-excluir` (ação "excluir" do painel) e `admin-recorrente` (criar/editar/cancelar/reativar/excluir reuniões recorrentes).

## Testes automáticos (opcional)

Regras de conflito/horário/PIN/corrida e as operações (contra uma planilha falsa em memória):

```
node --test tests/core.test.js
```
