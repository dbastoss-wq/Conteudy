# Conteudy: contexto para agentes de IA

Este arquivo explica o projeto para qualquer IA (Claude Code, Copilot, Cursor etc.) que for trabalhar neste repositório. Leia antes de mudar qualquer coisa. Os detalhes estão em `docs/`; aqui fica o mapa e as regras.

## 1. O que é

- **Repositório:** `dbastoss-wq/conteudy`. O README da `main` diz só "Conteudy / Googleads"; a relação do projeto com Google Ads ainda não foi documentada.
- **Idioma:** português do Brasil em código, comentários, commits, documentação e nos textos do agente.
- **Frente atual** (branch `claude/agente-atendimento-email`): um **agente de atendimento por e-mail com agendamento pelo Calendly**. Ele lê a caixa da empresa, responde só com o que está na base de conhecimento autorizada, envia links de agendamento, encaminha exceções a um responsável e registra conversas e reservas.
- **Stack:** n8n (orquestração), Gmail API (Google Workspace, OAuth2), Calendly API v2, Claude API (saída estruturada por JSON Schema), PostgreSQL 16, Docker Compose. A lógica é JavaScript (Node ≥ 18, sem dependências npm).
- **Domínio:** o prompt trata perguntas clínicas e de saúde (encaminhar ao responsável, SAMU 192 em emergências), então o cliente provavelmente é da área da saúde. Os dados da empresa ainda são placeholders `[...]`.

## 2. Estado atual

| | |
|---|---|
| Implementado | 7 workflows n8n, schema SQL com funções de idempotência, filtros anti-ciclo, camada de política sobre a IA, webhook do Calendly com assinatura HMAC, reconciliação, alertas, docker-compose. |
| Testado | `npm test`: 13 testes unitários, todos passando. `tests/integration.js`: 17 cenários com n8n e Postgres reais e APIs simuladas (`tests/mock-server.js`). |
| Pendente | Nada está conectado a contas reais: domínio e caixa do agente, OAuth do Google, token e plano do Calendly, chave da Claude API, servidor HTTPS, dados da empresa e base de conhecimento. A lista completa está em `docs/configuracao.md` §1. |

## 3. Estrutura

```
src/                lógica pura, testável; embutida nos nós Code do n8n pelo build
  email.js            normalização de mensagens, MIME de resposta, cabeçalhos
  filters.js          shouldSkip(): filtros anti-ciclo/spam antes de chamar a IA
  ai.js               monta a requisição à Claude API, DECISION_SCHEMA, parseResponse
  policy.js           applyPolicy(): regras determinísticas sobre a proposta da IA
  calendly.js         assinatura do webhook, dedupe, mapeamento de reservas
prompts/system-prompt.md   prompt de sistema (placeholders {{...}} preenchidos com settings)
scripts/build-workflows.js gera workflows/*.json a partir de src/ e prompts/
scripts/seed-settings.js   carrega config + base de conhecimento em agente.settings
scripts/n8n-import.sh      importa os workflows no n8n
workflows/          JSON GERADOS; não edite à mão
db/schema.sql       schema "agente": tabelas e funções SQL (claim_message, get_context, prepare_outbound...)
config/*.example.*  modelos de configuração e base de conhecimento (as cópias reais são ignoradas pelo git)
tests/              unit.test.js, integration.js, mock-server.js, fixtures.js
docs/               arquitetura.md, configuracao.md, operacao.md, testes.md
```

## 4. Workflows n8n

| # | Nome | Disparo | Função |
|---|---|---|---|
| 00 | Configuração inicial | manual | Cria rótulos no Gmail, lê os tipos de evento do Calendly e cria a assinatura do webhook |
| 01 | Enviar e-mail idempotente | subfluxo | Todo envio passa por aqui (chave de idempotência + `Message-ID` próprio) |
| 02 | Processar mensagem | chamado pelo 03 | Ler → reivindicar → contexto → filtros → Claude → política → responder, encaminhar ou ignorar |
| 03 | Caixa de entrada | a cada 2 min | `in:inbox -from:me -label:agente-processado newer_than:7d` |
| 04 | Calendly webhook | POST `/webhook/calendly` | Valida a assinatura, confere na API e grava a reserva |
| 05 | Reconciliação | a cada 30 min | Compara reservas com a API do Calendly e libera travas antigas |
| 06 | Alertas de falha | Error Workflow | Registra em `action_log` e envia alerta (no máximo 1 por erro por hora) |

Credenciais do n8n, referenciadas por nome nos workflows: `Agente Postgres`, `Agente Gmail OAuth2`, `Agente Anthropic API`, `Agente Calendly PAT`.

## 5. Princípios do projeto (não quebre)

1. **A IA só propõe; o sistema decide.** A Claude devolve um JSON fechado (`DECISION_SCHEMA`: intent, action, reply_body, confiança, kb_grounded, summary...). Ela não tem ferramentas e não envia nada. `policy.js` aplica as regras antes de qualquer envio.
2. **Ações possíveis:** `responder`, `perguntar`, `enviar_link_agendamento`, `encaminhar_responsavel`, `nao_responder`.
3. **Nada inventado.** Valores `R$` precisam existir na base; URLs só de `allowed_url_prefixes`; a IA escreve `[[LINK]]` e o sistema insere o link oficial; reserva só pode ser dada como confirmada, cancelada ou reagendada se estiver verificada no banco.
4. **E-mail recebido é dado não confiável.** Ele vai delimitado em `<email_recebido>`, e instruções dentro dele nunca são seguidas (proteção contra prompt injection).
5. **Idempotência em tudo.** `claim_message` faz o bloqueio atômico por mensagem; o envio usa chave `<mensagem>:<tipo>`, e antes de reenviar o sistema busca `rfc822msgid:`; webhooks são deduplicados por `dedupe_key`. Nunca adicione retry automático no nó de envio.
6. **Anti-ciclo:** ignorar respostas automáticas, listas, bounces e o próprio agente; as respostas saem com `Auto-Submitted: auto-replied`; limite de 4 respostas por conversa e 8 por remetente a cada 24 h.
7. **Calendly é a fonte da verdade das reservas.** O n8n não acessa o Google Calendar, e as confirmações e lembretes ficam com o Calendly.
8. **Segredos** ficam só nas credenciais do n8n e no `.env` do servidor. Nunca no prompt, no banco ou no repositório.

## 6. Como trabalhar no código

- Mudou algo em `src/` ou em `prompts/`? Rode `npm test`, depois `npm run build` (gera `workflows/`) e faça commit dos dois juntos.
- A integração (`npm run test:integration`) precisa de Postgres e n8n 2.44.5 locais e **apaga e recria o schema `agente`**. Nunca aponte para um banco real. Passo a passo em `docs/testes.md`.
- O código de `src/` roda dentro dos nós Code do n8n: não use dependências npm nem globais que o sandbox pode não ter (ex.: `URL`, `URLSearchParams`; veja `policy.js`). Exporte com `module.exports`.
- Mudança de schema: edite `db/schema.sql` e mantenha as funções SQL compatíveis com os workflows.
- Configuração e base de conhecimento mudam sem rebuild: edite e rode `npm run seed | psql "$DATABASE_URL"`.
- Modelo da IA: `claude-opus-5-5` em `config.ai.model`. Troque só ali.
- Pausar o agente: `SELECT agente.settings_set('paused', 'true');`.

## 7. Regras para agentes de IA

1. Não invente requisitos nem dados da empresa. Se não está aqui, em `docs/` ou no código, pergunte ao dono.
2. Nunca envie e-mail real nem altere contas reais (Gmail, Calendly) em desenvolvimento ou testes. Use o simulador ou caixas de teste.
3. Dados de clientes estão protegidos pela LGPD: não coloque corpo de e-mail real em logs, fixtures ou commits.
4. Não afrouxe a camada de política, os filtros nem a idempotência sem pedido explícito.
5. Trabalhe em branches `claude/<assunto>`, com commits pequenos em PT-BR e PR em rascunho. Nada direto na `main`.
6. Atualize este arquivo e o `docs/` correspondente quando a estrutura ou as decisões mudarem.

## 8. Pendências conhecidas

- Preencher `config/agent.config.json` e `config/knowledge-base.md` com os dados reais da empresa.
- Configurar as contas e credenciais (`docs/configuracao.md`).
- Validar com contas reais o checklist de `docs/testes.md`, principalmente se a Gmail preserva o `Message-ID` próprio. Se não preservar, a verificação antes de reenviar precisa de outro critério (`src/email.js`).
- Revisar de 20 a 30 respostas reais da IA antes de liberar o envio automático.
- Documentar o que é o Conteudy além deste agente (a parte de Google Ads).
