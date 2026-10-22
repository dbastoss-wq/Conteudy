# Operação

## Rotina

| Workflow | Disparo | O que faz |
|---|---|---|
| Agente \| Caixa de entrada (polling) | a cada 2 min | Busca mensagens novas e processa uma a uma |
| Agente \| Processar mensagem | chamado pelo anterior | Decide e executa resposta, encaminhamento ou descarte |
| Agente \| Enviar e-mail idempotente | subfluxo | Todo envio passa por aqui |
| Agente \| Calendly webhook | POST `/webhook/calendly` | Registra reservas, cancelamentos e reagendamentos |
| Agente \| Reconciliação | a cada 30 min | Compara reservas com a Calendly API e libera travas antigas |
| Agente \| Alertas de falha | erro em qualquer workflow | Registra e envia alerta (máx. 1 por erro/hora) |
| Agente \| Configuração inicial | manual | Rótulos do Gmail, dados do Calendly, assinatura do webhook |

Rótulos no Gmail: `agente-prioridade` (sinal de risco: alerta urgente enviado à equipe clínica), `agente-processado` (concluída), `agente-escalado` (com humano), `agente-ignorado` (automática/spam/interna), `agente-erro` (precisa de resposta manual).

## Atender uma conversa encaminhada

1. O responsável recebe `[Encaminhado pelo agente] <assunto>` com motivo, resumo e link da conversa.
2. Responda pela caixa do agente (delegação de e-mail no Gmail) ou mantenha o agente em cópia, para que o histórico fique registrado.
3. Enquanto a conversa estiver `escalada`, o agente não responde nela. Para devolvê-la ao agente:

```sql
UPDATE agente.conversations SET status = 'aberta' WHERE gmail_thread_id = '<id da conversa>';
```

## Consultas úteis

```sql
-- Mensagens que precisam de atenção
SELECT received_at, from_email, subject, status, attempts, last_error
FROM agente.messages WHERE direction = 'in' AND status IN ('falhou','descartada') ORDER BY received_at DESC;

-- Envios sem confirmação
SELECT created_at, kind, to_emails, status, attempts, last_error FROM agente.outbound_emails WHERE status <> 'enviado';

-- Próximas reuniões
SELECT b.start_time AT TIME ZONE 'America/Sao_Paulo' AS inicio, b.event_name, c.email, b.status, b.google_event_id
FROM agente.bookings b JOIN agente.contacts c ON c.id = b.contact_id
WHERE b.start_time > now() ORDER BY b.start_time;

-- Histórico de uma conversa
SELECT at, action, status, detail FROM agente.action_log
WHERE entity_id IN (SELECT id::text FROM agente.messages WHERE conversation_id = '<uuid>') ORDER BY at;
```

## Reprocessar uma mensagem descartada

Depois de corrigir a causa:

```sql
UPDATE agente.messages SET status = 'pendente', attempts = 0, last_error = NULL WHERE gmail_message_id = '<id>';
-- se o problema foi no envio, libere também as tentativas do envio (o já enviado continua protegido)
UPDATE agente.outbound_emails SET attempts = 0 WHERE status = 'falhou'
  AND source_message_id = (SELECT id FROM agente.messages WHERE gmail_message_id = '<id>');
```

e remova os rótulos `agente-processado` e `agente-erro` da mensagem no Gmail. Envios já feitos não se repetem (chave de idempotência).

## Pausar

**Atenção:** pausar o agente também pausa a detecção de risco da área de psiquiatria. Enquanto o agente estiver pausado ou fora do ar, a caixa precisa de cobertura humana.

`SELECT agente.settings_set('paused', 'true');` suspende o polling (o webhook continua registrando reservas). Volte com `'false'`.

## Atualizar regras, prompt ou código

- Base de conhecimento e configuração: `seed-settings` (efeito imediato, sem reiniciar).
- Prompt (`prompts/system-prompt.md`) ou código (`src/`): `npm test`, `node scripts/build-workflows.js`, reimportar com `scripts/n8n-import.sh` e reiniciar o n8n.

## Após uma interrupção

Nada manual é necessário: na volta, a reconciliação libera travas de mais de 15 min, marca envios em andamento como `desconhecido` e relê o Calendly; o polling retoma mensagens dos últimos 7 dias sem o rótulo de processado, e envios `desconhecido` são verificados na caixa antes de qualquer reenvio. Se a parada passou de 7 dias, aumente temporariamente `newer_than` em `gmail.query`.

## Custos e limites

- Claude API: uma chamada por mensagem que passa pelos filtros (o prompt de sistema é cacheado). O uso de tokens fica em `action_log.detail.extra.usage`.
- Gmail API: cota ampla para este volume; o polling a cada 2 min usa 1 `messages.list` por ciclo.
- Calendly API: reconciliação = 1 chamada por página de eventos + 1 por evento na janela (2 dias para trás, 60 à frente).
