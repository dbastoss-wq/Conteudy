# Arquitetura

```
                ┌───────────────────────── n8n ─────────────────────────────────────────┐
 Gmail (caixa   │ 03 Caixa de entrada ──(cada msg)──> 02 Processar mensagem ──> 01 Enviar │──> Gmail API (send)
 do agente) ───>│   a cada 2 min                       │ ler → reivindicar → contexto   e-mail     │
  messages.list │                                      │ filtros → Claude API → política idempot.  │
                │                                      └─> responder | encaminhar | ignorar        │
 Calendly ─────>│ 04 Calendly webhook (assinatura HMAC) ──> verifica na API ──> grava reserva    │
  webhook       │ 05 Reconciliação (30 min): Calendly API + travas antigas                       │
                │ 06 Alertas de falha (Error Workflow)   00 Configuração inicial (manual)        │
                └───────────────┬────────────────────────────────────────────────────────────────┘
                                │ funções SQL (jsonb)
                       PostgreSQL — schema "agente"
```

## Componentes

| Peça | Papel |
|---|---|
| **Gmail API** (OAuth2 oficial do Google) | Leitura (`messages.list/get`), envio na mesma conversa (`messages.send` com `threadId`, `In-Reply-To`, `References`), rótulos de estado. |
| **Calendly API v2** (token pessoal) | Fonte da verdade das reservas. Webhooks `invitee.created` / `invitee.canceled` quando o plano permite; reconciliação periódica sempre. |
| **Google Calendar** | Não é acessado pelo n8n. O Calendly lê a disponibilidade e cria o evento no calendário conectado; o agente só registra o `external_id` que o Calendly devolve (`calendar_event.external_id`). Assim não há eventos duplicados. |
| **Claude API** (`claude-opus-5-5`, saída estruturada JSON Schema) | Interpreta a mensagem e propõe ação + texto. Nunca envia nada por conta própria. |
| **Camada de política** (`src/policy.js`) | Regras determinísticas aplicadas sobre a proposta da IA antes de qualquer envio. |
| **PostgreSQL** | Contatos, conversas, mensagens, envios, reservas, eventos de webhook, log de ações e configuração. |

## Fluxo de e-mail

1. **03 Caixa de entrada** busca `in:inbox -from:me -label:agente-processado newer_than:7d` e chama **02** para cada mensagem (uma execução isolada por mensagem).
2. **02 Processar mensagem**
   - lê a mensagem completa e normaliza cabeçalhos, remetente e corpo (remove o histórico citado);
   - `agente.claim_message`: grava contato/conversa/mensagem e faz o **bloqueio atômico** (só uma execução processa cada `gmail_message_id`; contador de tentativas);
   - `agente.get_context`: resumo da conversa, últimas 10 mensagens, reservas verificadas do contato, contadores anti-ciclo das últimas 24 h;
   - **filtros** (`src/filters.js`), sem chamar a IA: próprio agente/aliases, `X-Agente-Atendimento`, `Auto-Submitted`, `X-Autoreply`, `Precedence: bulk/list`, `List-Id/List-Unsubscribe`, bounces (`multipart/report`), `no-reply`/`mailer-daemon`, assuntos de resposta automática, SPAM/Promoções, domínios de sistema (Calendly), remetentes internos, conversa já escalada a humano e limites de respostas por conversa/remetente;
   - **Claude API** com o e-mail delimitado por `<email_recebido>` como dado não confiável e resposta forçada ao schema `DECISION_SCHEMA` (`src/ai.js`);
   - **política** (`src/policy.js`): confiança mínima; URLs só do sistema; valores `R$` precisam existir na base; nenhuma afirmação de reserva confirmada/cancelada sem registro verificado; tipo de reunião precisa existir; links de agendamento, reagendamento e cancelamento são inseridos pelo sistema (nunca escritos pela IA);
   - **resultado**: responder na conversa, encaminhar ao responsável (+ confirmação curta ao contato) ou ignorar. Rótulos `agente-processado` + `agente-escalado`/`agente-ignorado`/`agente-erro`.
3. **01 Enviar e-mail idempotente**: `prepare_outbound` com chave `<mensagem>:<tipo>` e `Message-ID` gerado antes do envio. Se uma tentativa anterior terminou sem resultado (timeout/5xx), busca `rfc822msgid:` na caixa antes de reenviar. O resultado real (id da Gmail ou erro HTTP) é gravado por `record_send_result`. Envios nunca são repetidos automaticamente pelo nó HTTP.

## Área de psiquiatria e protocolo de risco

Detecção de risco determinística (`src/risk.js`) logo após a normalização, antes dos filtros e da IA; alerta urgente e modelo fixo, sem texto da IA; roteamento clínico/administrativo. Detalhes em [psiquiatria.md](psiquiatria.md).

## Fluxo de agendamento

- A IA escolhe `enviar_link_agendamento` + `meeting_type_key`; o sistema monta o link do tipo configurado com `name`, `email` (pré-preenchimento) e `utm_content=<id da conversa>`.
- **04 Calendly webhook**: valida `Calendly-Webhook-Signature` (HMAC-SHA256 de `t.corpo`, tolerância de 180 s), deduplica por `evento + invitee + created_at`, responde 200, **consulta o convidado e o evento na API** e só então grava a reserva (`verified_at`). Liga a reserva à conversa por `utm_content`; sem ele, pela reserva antiga (reagendamento) ou pela conversa mais recente do contato.
- Reagendamento no Calendly = `invitee.canceled` (`rescheduled: true`) + `invitee.created` com `old_invitee`; a antiga vira `reagendado` e aponta para a nova.
- Pedidos de cancelar/reagendar por e-mail recebem o `cancel_url`/`reschedule_url` oficial da reserva ativa verificada.
- Confirmações e lembretes ficam com o Calendly (que já os envia); o agente não manda confirmação própria, evitando mensagens repetidas. Se o contato perguntar se a reunião foi marcada, a IA responde com base em `<agendamentos_verificados>`.

## Confiabilidade

| Risco | Tratamento |
|---|---|
| Mensagem processada duas vezes (polling concorrente, rótulo perdido) | `claim_message` com `UPDATE ... WHERE status` atômico; rótulos reaplicados para mensagens já concluídas. |
| E-mail enviado duas vezes | Chave de idempotência + `Message-ID` próprio + verificação `rfc822msgid:` antes de qualquer reenvio. |
| Webhook repetido | `webhook_events.dedupe_key` único. |
| Webhook perdido / plano sem webhooks | **05 Reconciliação** a cada 30 min lê eventos e convidados (com paginação) e faz upsert idempotente. |
| Falha temporária (rede, 429, 5xx) | Leituras e IA: 3 tentativas no nó; depois a mensagem fica `falhou` e volta no próximo ciclo, até `max_attempts`. |
| Tentativas esgotadas | Mensagem `descartada`, rótulo `agente-erro`, alerta por e-mail (uma vez). |
| Interrupção do n8n | `reset_stale` libera travas antigas e marca envios em andamento como `desconhecido` (verificados antes de reenviar). A busca da caixa cobre 7 dias. |
| Erro não tratado em qualquer workflow | **06 Alertas de falha** (Error Workflow): grava em `action_log` e envia alerta. |
| Ciclos de resposta com outros robôs | Filtros de cabeçalho, `Auto-Submitted: auto-replied` nas respostas, limite de respostas por conversa (4/24 h) e remetente (8/24 h) com escalonamento. |
| Injeção de instruções no e-mail | E-mail tratado como dado delimitado, saída por schema fechado, política determinística e nenhuma ferramenta à disposição da IA. |

## Modelo de dados (schema `agente`)

`contacts` · `conversations` (status `aberta`/`aguardando_contato`/`escalada`/`encerrada`, resumo, próxima ação) · `messages` (entrada e saída, ids Gmail e RFC 822, status, tentativas, erro) · `outbound_emails` (idempotência e resultado real de cada envio) · `bookings` (URIs do Calendly, `google_event_id`, início, fim, fuso, status, links oficiais, reagendamento) · `webhook_events` · `action_log` (histórico de ações, falhas e tentativas) · `settings` (configuração sem segredos e base de conhecimento).
