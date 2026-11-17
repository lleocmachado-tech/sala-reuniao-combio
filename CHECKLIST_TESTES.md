# Checklist de testes manuais

Use datas **futuras** (ex.: daqui a 3 dias), exceto onde indicado. Marque ✔ / ✖.
Base: crie primeiro a reserva **A**: dia D, **09:00–10:30**, "Ana", "Kickoff".

| # | Teste | Como | Esperado | OK |
|---|---|---|---|---|
| 1 | Reserva livre | Painel 1 → Reservar → dia D, 13:00–14:00 | Sucesso; mostra resumo, ID e PIN de 4 dígitos (botão copiar); aparece na linha do tempo/lista; linha criada na planilha com hash (sem PIN) | |
| 2 | Conflito parcial | Dia D, 10:00–11:00 | Aviso em tempo real "Conflito"; ao enviar, erro 409 em destaque: "a sala já está ocupada das 09:00 às 10:30 por Ana (Kickoff)…"; campos preenchidos não somem | |
| 3 | Conflito total | Dia D, 09:00–10:30 e também 08:00–12:00 e 09:30–10:00 | Todos recusados com a mesma mensagem | |
| 4 | Conflito com vários | Crie B 11:00–12:00; tente 10:00–11:30 | Mensagem lista A **e** B | |
| 5 | Reservas encostadas | Dia D, 10:30–11:00 e 08:00–09:00 | Ambas aceitas (sem conflito) | |
| 6 | Horário no passado | **Hoje**, início anterior a agora; e uma data de ontem (pelo seletor ou direto) | Recusado: "já passou" | |
| 7 | Fora de 07–18 | Selects não oferecem; teste direto abaixo* (06:30–07:30, 17:30–18:30, 09:15–10:00) | Servidor responde 400 | |
| 8 | Campos obrigatórios | Enviar sem nome ou sem motivo | Mensagem pedindo o campo | |
| 9 | Fórmula na planilha | Motivo `=1+1` e responsável `@teste` | Na planilha aparece `1+1` e `teste` (sem `=`/`@` iniciais) | |
| 10 | Cancelar com PIN certo | "Cancelar minha reserva" → escolher a reserva do teste 1 → PIN | "Reserva cancelada"; some do painel; Status = Cancelada | |
| 11 | Cancelar com PIN errado | Outra reserva + PIN errado | "Reserva não encontrada ou PIN incorreto"; continua Ativa. Após ~8 erros: bloqueio temporário | |
| 12 | Dois envios quase simultâneos | Abra o Painel 1 em 2 abas/celulares, mesmo dia/horário livre (ex.: 15:00–16:00), preencha ambos e clique Confirmar ao mesmo tempo | **Só uma** fica Ativa (a de "Criado em" mais antigo); a outra recebe a mensagem de conflito e fica Cancelada na planilha com obs "Cancelada automaticamente…" | |
| 13 | Clique duplo | Clique rápido 2× em Confirmar | Apenas 1 reserva criada | |
| 14 | Sem internet | Desligue a rede e abra/atualize | Faixa amarela de aviso; dados antigos mantidos; ao enviar, mensagem de rede | |
| 15 | Status AGORA | Crie reserva que cubra o horário atual | Card vermelho OCUPADA com responsável, motivo e "ocupada até"; ao liberar, LIVRE + "livre até" + próxima reserva | |
| 16 | Navegação | ◀ Hoje ▶, seletor de data, clique em dia da semana | Linha do tempo, lista e semana acompanham; atualiza sozinho a cada 60 s | |
| 17 | Admin: senha errada | Painel 2 com senha incorreta | "Senha de admin incorreta"; após 5 erros, bloqueio temporário | |
| 18 | Admin: editar | Editar A para 08:30–09:30 (conflita com outra) | Mensagem de conflito; botão "Forçar mesmo assim…" só aparece aí | |
| 19 | Admin: editar ok | Mudar A para outro horário livre | Salvo; "Observação admin" registra data, campos e valores antigos → novos | |
| 20 | Admin: forçar | Forçar uma sobreposição → confirmar a caixa de aviso | Salva; obs registra `forçar` e os IDs ignorados | |
| 21 | Admin: cancelar/reativar | Cancelar (com motivo); depois Reativar | Reativar valida conflito (409 se o horário foi ocupado; pede confirmação para forçar) | |
| 22 | Admin: criar | "+ Nova reserva" | Criada com Origem = Admin e PIN mostrado uma vez | |
| 23 | Admin: excluir | Excluir uma reserva de teste | Confirmação; linha some da planilha | |
| 24 | Admin: filtros | Período, status (inclui Canceladas), responsável | Lista conforme filtros; linha do tempo do dia igual à do Painel 1 | |
| 26 | Recorrentes na grade | Painel 1, em uma terça/quarta/quinta futura | Aparecem as reuniões da agenda impressa (ex.: quarta 09:00–10:30 Integração/SSMA) com responsável "Planejamento Combio" | |
| 27 | Conflito com recorrente | Tentar reservar quarta 10:00–11:00 | Recusado citando "Integração/SSMA"; quarta 10:30–11:00 é aceita | |
| 28 | Editar responsável (admin) | Painel 2 → Reuniões recorrentes → Editar → trocar responsável | Painel 1 mostra o novo nome nas próximas semanas; obs. registra a mudança | |
| 29 | Cancelar/reativar série | Cancelar uma série; conferir Painel 1; reativar | Some e volta em todas as semanas | |
| 25 | Privacidade | Abra `https://SEU-SITE/api/reservas?data=AAAA-MM-DD` | JSON só com id, data, início, fim, responsável, motivo — **sem PIN/hash**, sem canceladas | |

\* Teste 7 sem terminal: no Painel 2 também só há selects válidos; use o endereço de teste no navegador **não** serve (é POST). Alternativa: confie nos testes automáticos (`node --test tests/core.test.js`, caso "horário"), que cobrem 06:30, 18:30, 09:15 e fim ≤ início.

## Visão semanal e calendário (novo)

| # | Teste | Esperado |
|---|---|---|
| 30 | Painel 1: "Visão da semana" | Grade seg–sáb 07:00–18:00; ocupados coloridos por responsável; livres claros; passado hachurado; ◀ Semana / Semana ▶ mostram semanas futuras |
| 31 | Painel 1: clicar em horário livre | Abre "Reservar sala" já com data e início preenchidos |
| 32 | Painel 2: arrastar uma reserva avulsa | Muda dia/horário; conflito pede confirmação para forçar; Observação admin registra |
| 33 | Painel 2: puxar a borda de baixo | Altera só o horário de fim |
| 34 | Painel 2: arrastar reunião recorrente (faixa amarela) | Pede confirmação e altera a série inteira |
| 35 | Painel 2: clicar em horário vazio → Repetir "por 4 semanas" | Cria série com última ocorrência 3 semanas depois da primeira; "para sempre" cria sem fim |
| 36 | Painel 2: recorrente → Termina (nunca / N semanas / data) | Vigência gravada conforme escolhido |
