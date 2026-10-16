# Secretária Virtual de WhatsApp — Consultório de Teleconsultas

Atende pacientes no WhatsApp profissional (API **oficial** da Meta), envia a mensagem
de apresentação, agenda consultas no Google Agenda com **disponibilidade real** e
**sem risco de duplicidade**, pergunta a forma de pagamento e passa a conversa para o
médico quando o assunto sai do roteiro.

> **Princípio central:** a IA só **interpreta** mensagens e **redige textos curtos**.
> Toda decisão de disponibilidade e todo agendamento são feitos por **código
> determinístico** — nunca pela IA.

---

## Sumário

- [Arquitetura](#arquitetura)
- [Stack](#stack)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Como rodar (desenvolvimento)](#como-rodar-desenvolvimento)
- [Modo de teste (sem WhatsApp real)](#modo-de-teste-sem-whatsapp-real)
- [Testes automatizados](#testes-automatizados)
- [Deploy em produção](#deploy-em-produção)
- [Configuração do WhatsApp Cloud API](#configuração-do-whatsapp-cloud-api)
- [Configuração do Google Calendar](#configuração-do-google-calendar)
- [Painel administrativo](#painel-administrativo)
- [Segurança e LGPD](#segurança-e-lgpd)
- [Como as regras críticas são garantidas](#como-as-regras-críticas-são-garantidas)

---

## Arquitetura

```
WhatsApp (paciente)
   │ webhook POST (assinatura HMAC verificada)
   ▼
Webhook receiver ──► fila serial POR CONVERSA ──► Camada de segurança ──► NLU (LLM, só extração)
   (dedup por id)      (mensagens em ordem)         (urgência/clínica/           │
                                                      fora do roteiro)            ▼
                                                                     Máquina de estados (determinística)
                                                                                 │
                                   ┌─────────────────────────────────────────────┤
                                   ▼                                             ▼
                      Motor de horários livres                       Serviço de reserva
                      (settings − eventos ocupados)                  · trava por slot
                                   │                                 · idempotência
                                   ▼                                 · re-checa freebusy
                            Google Calendar  ◄──────────────────────· só confirma após sucesso
                            (freebusy / insert)
                                   │
                                   ▼
                      Postgres  +  Notificador (WhatsApp pessoal + e-mail)  +  Painel admin
```

Camadas (em `src/`):

| Pasta | Responsabilidade |
|---|---|
| `whatsapp/` | Verificação de assinatura e envio pela Cloud API (ou captura, em modo de teste) |
| `llm/` | Adapter Anthropic/OpenAI + NLU (extração em JSON validado por schema) |
| `conversation/` | Máquina de estados, textos, segurança (urgência/handoff) |
| `scheduling/` | Geração determinística de horários e serviço de reserva com lock/idempotência |
| `calendar/` | Cliente Google Calendar (produção) e agenda falsa (teste) |
| `db/` | Pool, migrações, repositórios e stores de reserva/consulta |
| `admin/` | Painel web (login, conversas, agendamentos, configurações) |
| `notify/` | Alertas ao médico |
| `jobs/` | Retenção de dados (LGPD) |

---

## Stack

- **Node.js 20 + TypeScript**, **Fastify**
- **PostgreSQL** (estado das conversas, configurações, consultas, trava de slot, auditoria)
- **Google Calendar API** (`freebusy` + `events.insert`) via OAuth (refresh token)
- **WhatsApp Business Cloud API** (Meta) — somente API oficial
- **LLM configurável** (Anthropic **ou** OpenAI) — só interpreta/redige
- **Luxon** (fuso `America/Sao_Paulo` em todo o sistema)
- **Vitest** (testes)

---

## Variáveis de ambiente

Copie `.env.example` para `.env` e preencha. Resumo:

| Grupo | Variáveis |
|---|---|
| App | `APP_BASE_URL`, `PORT`, `NODE_ENV`, `TZ` |
| WhatsApp | `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_API_VERSION` |
| Google | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`, `GOOGLE_REFRESH_TOKEN`, `GOOGLE_CALENDAR_ID` |
| LLM | `LLM_PROVIDER` (`anthropic`/`openai`), `LLM_API_KEY`, `LLM_MODEL` |
| Banco | `DATABASE_URL` |
| Segurança | `JWT_SECRET`, `ENCRYPTION_KEY` (32 bytes base64), `ADMIN_EMAIL`, `ADMIN_PASSWORD` |
| Negócio | `CONSULT_PRICE_CENTS` (7000), `PIX_KEY` |
| LGPD | `DATA_RETENTION_DAYS` |
| Alertas | `DOCTOR_NOTIFY_CHANNEL` (`both`), `DOCTOR_WHATSAPP_NUMBER`, `DOCTOR_EMAIL`, `SMTP_*` |
| Teste | `SIMULATE_WHATSAPP`, `SIMULATE_CALENDAR` |

Gere a chave de criptografia:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Os parâmetros de atendimento (dias, horários, duração **padrão 15 min**, intervalo,
antecedência, agenda e textos das mensagens) ficam **no banco** e são editados pelo
**painel** — não precisam de redeploy.

---

## Como rodar (desenvolvimento)

```bash
# 1. Suba um Postgres (via Docker, por exemplo)
docker compose up -d db

# 2. Instale as dependências
npm install

# 3. Configure o .env (DATABASE_URL apontando para localhost:5432)
cp .env.example .env && $EDITOR .env

# 4. Migre o banco e crie o admin inicial
npm run migrate
npm run seed        # usa ADMIN_EMAIL / ADMIN_PASSWORD do .env

# 5. Suba em modo dev (hot reload)
npm run dev
```

Painel em `http://localhost:3000/admin`, webhook em `http://localhost:3000/webhook`.

---

## Modo de teste (sem WhatsApp real)

O simulador injeta mensagens no **mesmo fluxo** do webhook, sem tocar no WhatsApp.
Com `SIMULATE_CALENDAR=true` ele também usa uma **agenda falsa em memória** (não cria
eventos reais no Google) — ideal para experimentar o roteiro ponta a ponta.

```bash
SIMULATE_WHATSAPP=true SIMULATE_CALENDAR=true npm run sim
```

Exemplo de sessão:

```
> oi
🤖 Oi, tudo bem? Aqui é o Dr. Daniel, obrigado pelo contato 😊 ...

> quero marcar quinta às 14h, é dor de garganta
🤖 Consegui o horário de qui, 22/10 às 14:00. Posso confirmar pra você?

> meu nome é Maria Silva
> pode confirmar
🤖 Consulta agendada! 😊 O valor é R$ 70,00 e você pode pagar no crédito, débito ou Pix...

> pix
🤖 Perfeito, Pix então 😊 ... Quando puder, me envie o comprovante por aqui.
```

Comandos: `/phone <numero>` troca o paciente simulado; `/sair` encerra.
(O simulador usa o Postgres, então as conversas aparecem no painel.)

---

## Testes automatizados

```bash
npm test
```

Cobrem exatamente os cenários pedidos, **sem WhatsApp nem Google reais** (usam agenda
falsa e stores em memória):

- **Horário ocupado** → não agenda e oferece 3 alternativas próximas (`tests/slots.test.ts`)
- **Pedido fora do expediente** → rejeita (após expediente, dia não atendido, almoço) (`tests/slots.test.ts`)
- **Duas mensagens simultâneas pelo mesmo horário** → agenda só uma vez; a segunda recebe
  `slot_taken`; o Google é chamado **uma única vez** (`tests/booking.test.ts`)
- **Falha da API do Google** → não confirma, não persiste, libera o slot e permite nova
  tentativa (`tests/booking.test.ts`)
- Extra: assinatura do webhook e parsing do payload (`tests/webhook.test.ts`)

---

## Deploy em produção

### Opção A — Docker Compose (app + banco)

```bash
cp .env.example .env    # preencha credenciais reais; SIMULATE_*=false
docker compose up -d --build
docker compose run --rm app node dist/db/seed.js   # cria o admin (uma vez)
```

O serviço `app` roda as migrações e sobe na porta 3000. Coloque um proxy HTTPS
(Caddy/Nginx) na frente — o webhook da Meta exige HTTPS público.

### Opção B — Node direto (ex.: VM / PaaS)

```bash
npm ci
npm run build
npm run migrate
npm run seed
NODE_ENV=production node dist/server.js
```

Aponte o webhook da Meta para `https://seu-dominio.com/webhook` e configure TLS.

---

## Configuração do WhatsApp Cloud API

1. No **Meta for Developers**, crie um app com o produto **WhatsApp**.
2. Pegue o **Phone Number ID** (→ `WHATSAPP_PHONE_NUMBER_ID`) e um **token de acesso**
   permanente (System User) (→ `WHATSAPP_ACCESS_TOKEN`).
3. Em **App Secret** copie o segredo (→ `WHATSAPP_APP_SECRET`) — valida a assinatura.
4. Configure o **webhook**: URL `https://seu-dominio.com/webhook`, verify token igual a
   `WHATSAPP_VERIFY_TOKEN`, e assine o campo **messages**.
5. **Não** use bibliotecas não oficiais (whatsapp-web.js, Baileys) — risco de banimento.

> Mensagens livres ao paciente só podem ser enviadas dentro da janela de 24h após a
> última mensagem dele (regra da Meta). Como o paciente sempre inicia o contato, o fluxo
> opera dentro da janela. Os **alertas ao médico** via WhatsApp dependem dessa janela;
> por isso o canal de e-mail é usado em paralelo (`DOCTOR_NOTIFY_CHANNEL=both`).

---

## Configuração do Google Calendar

1. No **Google Cloud Console**, habilite a **Google Calendar API** e crie credenciais
   **OAuth 2.0** (tipo Web). Preencha `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET`.
2. Cadastre o **Redirect URI** (ex.: `http://localhost:3000/oauth/google/callback`) e
   coloque o mesmo valor em `GOOGLE_OAUTH_REDIRECT_URI`.
3. Gere o refresh token (uma vez):

   ```bash
   npm run oauth:google
   ```

   Abra a URL impressa, autorize com a conta do médico e copie o valor para
   `GOOGLE_REFRESH_TOKEN`.
4. Defina `GOOGLE_CALENDAR_ID` (`primary` ou o ID da agenda específica).

---

## Painel administrativo

`/admin` (login com `ADMIN_EMAIL` / `ADMIN_PASSWORD`):

- **Conversas** com status (novo, aguardando horário, aguardando confirmação,
  aguardando pagamento, urgência, transferido).
- **Detalhe da conversa** com histórico e botões **Pausar bot e assumir** /
  **Devolver ao bot**.
- **Agendamentos** com forma e status de pagamento (pendente, aguardando comprovante,
  comprovante recebido, cartão com o médico).
- **Configurações**: dias e horários (com almoço opcional), duração, intervalo,
  antecedência, ID da agenda e os textos de apresentação e pagamento.

---

## Segurança e LGPD

- **Dado de saúde** (motivo da consulta) e **corpos de mensagem** são **criptografados em
  repouso** (AES-256-GCM, chave `ENCRYPTION_KEY`).
- **Retenção configurável** (`DATA_RETENTION_DAYS`): purga diária de conversas/consultas
  antigas (`src/jobs/retention.ts`).
- Dados de pacientes só trafegam para os serviços citados (WhatsApp, Google, LLM).
- **Nunca** dá orientação médica, não interpreta sintomas, não indica remédios.
- **Urgência** (falta de ar, dor no peito, desmaio, sangramento forte, ideia de
  autolesão): não agenda, orienta **SAMU 192 / pronto-socorro** e alerta o médico.
- Não faz cobranças além da mensagem de pagamento, nem campanhas/mensagens em massa.
- O app **nunca** confirma pagamento sozinho e **nunca** cancela consulta por falta de
  pagamento.

---

## Como as regras críticas são garantidas

| Regra | Onde / como |
|---|---|
| IA não decide disponibilidade | NLU devolve só JSON (`src/llm/nlu.ts`); horários e reserva em código (`src/scheduling/*`) |
| Não repetir perguntas | Campos coletados são mesclados e persistidos (`handler.ts`) |
| Re-checar antes de gravar | `bookAppointment` chama `freebusy` dentro da trava, antes do `insert` |
| Sem duplicidade | Trava por slot (`slot_locks`, unique) + idempotency key + fila serial por conversa |
| Confirmar só após sucesso do Google | Mensagem de pagamento (que confirma) só é enviada no `status: 'booked'` |
| Falha no Google | Mensagem de espera + alerta ao médico; slot liberado p/ retry |
| Fuso America/Sao_Paulo | UTC no banco, conversão com Luxon em toda a lógica |

---

_Projeto entregue com arquitetura determinística para a parte sensível (agenda/reserva) e
IA restrita à interpretação de linguagem._
