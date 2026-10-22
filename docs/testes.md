# Testes

## O que foi testado, e como

**Ambiente:** n8n 2.44.5 (servidor real, Node 24) + PostgreSQL 16 real + Gmail API, Calendly API e Claude API **simuladas** por `tests/mock-server.js`. Os workflows rodados são exatamente os de `workflows/`, apontados para o simulador apenas pela configuração `api.*_base` e por credenciais de teste.

Isso valida a lógica dos workflows, o banco, a idempotência e a recuperação de falhas. **Não** valida a autenticação real com Google e Calendly, o comportamento real da Gmail API (por exemplo, preservação do `Message-ID`) nem a qualidade das decisões do modelo de IA — o simulador devolve decisões fixas por palavra-chave.

### Testes unitários — `npm test` (13/13 aprovados)

Normalização de mensagens, MIME de resposta, filtros anti-ciclo, montagem da requisição de IA (isolamento do e-mail), interpretação de recusa/truncamento, política (preço fora da base, URL não autorizada, reserva não verificada, tipo de reunião inválido, baixa confiança, links oficiais), assinatura do webhook do Calendly e mapeamento de status.

### Área de psiquiatria — `tests/psiquiatria.test.js` (18/18 aprovados)

Risco (acentos, variações, falsos positivos), precedência do risco, modelos fixos, alerta sem conteúdo, roteamento clínico/administrativo, bloqueio de dose/CID/remédio/promessa, termo de consentimento, área, filtros anti-loop com risco, injeção, schema e prompt. O schema e as funções SQL novas foram verificados em PostgreSQL 16 (migração reaplicável, área não volta para geral, risco só sobe, retenção anonimiza, `action_log` sem corpo). **Os cenários de integração com n8n da área ainda não foram rodados** (n8n não disponível no ambiente).

### Integração — `node tests/integration.js` (17/17 aprovados)

| Cenário | Resultado |
|---|---|
| Configuração inicial: rótulos, dados do Calendly, assinatura do webhook com chave; reexecução idempotente | OK |
| Recebimento e resposta na mesma conversa (`threadId`, `In-Reply-To`, `Auto-Submitted`, rótulo) | OK |
| Mensagem já processada reaparece na busca: sem novo envio nem nova chamada de IA; rótulo reaplicado | OK |
| Link de agendamento com nome, e-mail e `utm_content` = conversa | OK |
| Resposta automática, newsletter e mensagem do próprio agente ignoradas sem chamar a IA | OK |
| IA propõe valor que não está na base → encaminhado ao responsável, confirmação ao contato, conversa com humano não recebe mais respostas automáticas | OK |
| Webhook `invitee.created`: assinatura validada, reserva consultada na API, ligada à conversa; entrega duplicada ignorada | OK |
| Webhook com assinatura inválida ou ausente → 401, nada gravado | OK |
| Pedido de reagendamento por e-mail → link oficial da reserva verificada | OK |
| Reagendamento no Calendly → antiga `reagendado`, nova `ativo`, mesma conversa | OK |
| Cancelamento no Calendly → `cancelado` com motivo | OK |
| Reconciliação com paginação recupera reservas sem webhook; reexecução idempotente | OK |
| Envio aceito com resposta perdida (503) → não reenvia; confirma por `rfc822msgid:` | OK |
| IA indisponível (3 falhas) → falha temporária; próximo ciclo conclui | OK |
| Rejeição definitiva repetida → descarte após 3 tentativas, rótulo de erro, um único alerta | OK |
| Interrupção no meio do processamento → trava liberada, próximo ciclo conclui | OK |
| Duas execuções simultâneas do polling → um único envio | OK |

### Alertas de falha (servidor n8n, gatilho agendado real)

Com a configuração propositalmente incompleta e o polling ativo no servidor, o workflow de erro registrou a falha em `agente.action_log` e enviou o alerta. Com erro persistente, foi enviado um único alerta por hora (deduplicação por workflow + mensagem de erro).

### Leitura da conta Calendly conectada a esta sessão (somente leitura)

Feita pelo conector do Calendly desta sessão, não pelo n8n: conta ativa no fuso `America/Sao_Paulo`, com um tipo de evento ativo de 30 minutos. Nenhuma alteração foi feita na conta.

## O que ainda precisa ser testado com contas reais

Use uma **caixa de teste** do Workspace e um **calendário de teste** conectado a um usuário Calendly de teste. Marque cada item:

- [ ] OAuth da Gmail conectado com a conta do agente (credencial `Agente Gmail OAuth2`).
- [ ] **Configuração inicial**: rótulos criados na caixa; `calendly_event_types_discovered` confere com `meeting_types`; assinatura de webhook criada (ou 403 se o plano não permitir — então `webhooks_enabled: false`).
- [ ] Enviar de uma conta externa uma pergunta coberta pela base → resposta em até 2 min na mesma conversa, texto correto, sem inventar dados.
- [ ] Pergunta fora da base → encaminhamento ao responsável + confirmação ao contato.
- [ ] Pedido de reunião → link correto; agendar pelo link; conferir no banco a reserva `ativo` ligada à conversa e o evento criado **uma única vez** no Google Calendar (`google_event_id`).
- [ ] Reagendar pelo link do e-mail de confirmação do Calendly → antiga `reagendado`, nova `ativo`.
- [ ] Cancelar → `cancelado`.
- [ ] Responder a uma mensagem do agente com resposta automática de férias → ignorada.
- [ ] Confirmar na Gmail real que o `Message-ID` enviado é preservado: em "Mostrar original", o `Message-ID` deve ser `<agente.…@dominio>`; e `rfc822msgid:agente.…` na busca deve encontrar a mensagem. **Se a Gmail substituir o cabeçalho, a verificação antes de reenvio não funciona e é preciso ajustar o critério de busca** (ver `src/email.js`).
- [ ] Parar o n8n por 10 min com mensagens chegando, religar e conferir que tudo foi processado uma única vez.
- [ ] Revisar 20–30 respostas reais da IA antes de liberar o envio automático para clientes (opcional: rodar inicialmente com `min_confidence` alto, que encaminha mais ao responsável).

## Como rodar localmente

```bash
npm test                                   # unitários, sem dependências
# integração: PostgreSQL local, n8n 2.44.5 instalado, credenciais de teste importadas
#   (Gmail OAuth com token fictício, Header Auth x-api-key e Authorization: Bearer)
export N8N_BLOCK_ENV_ACCESS_IN_NODE=false NODE_FUNCTION_ALLOW_BUILTIN=crypto CALENDLY_WEBHOOK_SIGNING_KEY=segredo-de-teste
sh scripts/n8n-import.sh --sem-agendamentos && n8n start &
DATABASE_URL=postgresql://agente:agente@localhost:5432/agente node tests/integration.js
```

O teste de integração **apaga e recria** o schema `agente` do banco indicado. Nunca aponte para o banco de produção.
