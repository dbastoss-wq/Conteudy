# Contas, permissões e configuração

Tudo o que está aqui depende de você (ou de quem administra as contas). Nenhum destes itens foi configurado automaticamente.

## 1. Lista de pendências

| # | Item | Onde | Situação |
|---|---|---|---|
| 1 | Preencher `[NOME DA EMPRESA]`, `[DESCRIÇÃO]`, `[NOME]`, `[EMAIL@DOMINIO.COM]`, `[CALENDÁRIO]`, `[LINK]`, `[TIPOS E DURAÇÕES]`, `[CONTATO]` | `config/agent.config.json` (copiar do `.example`) | Pendente |
| 2 | Escrever a base de conhecimento autorizada | `config/knowledge-base.md` | Pendente |
| 3 | Domínio e caixa de e-mail do agente no Google Workspace (seção 3) | Google Admin / DNS | Pendente |
| 4 | Projeto no Google Cloud com Gmail API e cliente OAuth (seção 4) | console.cloud.google.com | Pendente |
| 5 | Servidor com Docker e HTTPS público para o n8n (seção 6) | Sua hospedagem | Pendente |
| 6 | Chave da Claude API | console.anthropic.com | Pendente |
| 7 | Token pessoal do Calendly e plano com webhooks (seção 5) | calendly.com/integrations/api_webhooks | Pendente |
| 8 | Conectar o Google Calendar ao Calendly (verificação de conflitos e criação de eventos) | Calendly → Integrações → Calendários | Pendente (verificar) |
| 9 | Caixa de teste e calendário de teste para a validação final | Google Workspace | Pendente |

## 2. Configuração do agente

```bash
cp config/agent.config.example.json config/agent.config.json
cp config/knowledge-base.example.md config/knowledge-base.md
# edite os dois arquivos
node scripts/seed-settings.js config/agent.config.json config/knowledge-base.md | psql "$DATABASE_URL"
```

Campos importantes:

- `agent.email` e `agent.aliases`: endereços do próprio agente (nunca respondidos).
- `internal_addresses` / `internal_domains`: equipe interna. Mensagens deles são registradas, não respondidas. Inclua o responsável e o e-mail de alertas.
- `meeting_types[]`: um item por tipo de reunião (`key`, `name`, `duration_min`, `purpose`, `scheduling_url`, `event_type_uri`). Após rodar **00 Configuração inicial**, a lista real do Calendly fica em `agente.settings` → `calendly_event_types_discovered` para conferência.
- `allowed_url_prefixes`: únicos prefixos de URL que podem aparecer no texto da IA (os links do Calendly são inseridos pelo sistema).
- `limits`: tentativas, confiança mínima e limites anti-ciclo.
- `calendly.webhook_url`: `https://<N8N_HOST>/webhook/calendly`.
- `paused: true` em `agente.settings` suspende o polling sem desativar workflows.

Alterações posteriores: edite e rode o `seed-settings` de novo (é um upsert) ou altere direto a tabela `agente.settings`.

## 3. Domínio e caixa de e-mail (se ainda não existirem)

1. Registre o domínio (Registro.br para `.com.br`).
2. Contrate o Google Workspace e verifique o domínio (registro TXT `google-site-verification=...` fornecido pelo Admin Console).
3. Crie o usuário do agente, por exemplo `atendimento@dominio.com.br`. Uma conta de usuário (não um grupo) é necessária para OAuth na Gmail API.
4. DNS — registros de e-mail (valores para Google Workspace):

| Tipo | Nome | Valor | Observação |
|---|---|---|---|
| MX | `@` | `1 smtp.google.com` | Registro único atual do Google Workspace. Remova MX antigos. |
| TXT (SPF) | `@` | `v=spf1 include:_spf.google.com ~all` | Um único registro SPF por domínio; acrescente outros `include:` se outro serviço enviar pelo domínio. |
| TXT (DKIM) | `google._domainkey` | `v=DKIM1; k=rsa; p=...` | Gere em Admin Console → Apps → Google Workspace → Gmail → Autenticar e-mail (chave de 2048 bits). Depois de publicar, clique em **Iniciar autenticação**. |
| TXT (DMARC) | `_dmarc` | `v=DMARC1; p=none; rua=mailto:dmarc@dominio.com.br; fo=1` | Comece em `p=none`, acompanhe os relatórios por 2–4 semanas e evolua para `p=quarantine` e depois `p=reject`. |

5. Verifique: `dig MX dominio.com.br`, `dig TXT dominio.com.br`, `dig TXT google._domainkey.dominio.com.br`, `dig TXT _dmarc.dominio.com.br`, e envie um e-mail de teste para uma conta Gmail externa conferindo "Mostrar original" → SPF, DKIM e DMARC = PASS.
6. Na caixa do agente, desative respostas automáticas de férias e filtros que arquivem e-mails da caixa de entrada (o agente busca `in:inbox`).

## 4. Gmail API (OAuth oficial)

1. Google Cloud Console → novo projeto → **APIs e serviços → Biblioteca** → ativar **Gmail API**.
2. **Tela de consentimento OAuth**: tipo **Interno** (só usuários do seu Workspace; dispensa verificação do Google).
3. **Credenciais → Criar ID do cliente OAuth → Aplicativo da Web**. URI de redirecionamento autorizado: `https://<N8N_HOST>/rest/oauth2-credential/callback`.
4. No n8n: credencial **Gmail OAuth2 API** com o mesmo ID (`Agente Gmail OAuth2`, já referenciada pelos workflows). Escopo mínimo necessário: `https://www.googleapis.com/auth/gmail.modify` (ler, enviar, aplicar rótulos; não permite exclusão definitiva). Clique em **Conectar** e faça login **com a conta do agente**.

Permissões usadas: `messages.list`, `messages.get`, `messages.send`, `messages.modify` (rótulos), `labels.list`, `labels.create`.

## 5. Calendly

1. Token pessoal: Calendly → **Integrações → API e webhooks → Personal access tokens → Gerar**. No n8n, credencial **Header Auth** `Agente Calendly PAT` com nome `Authorization` e valor `Bearer <token>`.
2. Webhooks exigem plano pago do Calendly (Standard ou superior). Sem eles, desative `calendly.webhooks_enabled`; a reconciliação a cada 30 minutos mantém os registros (com atraso de até 30 min).
3. Gere a chave de assinatura (`openssl rand -hex 32`) e coloque em `CALENDLY_WEBHOOK_SIGNING_KEY` no `.env`. O workflow **00 Configuração inicial** cria a assinatura com essa chave para `invitee.created` e `invitee.canceled` (escopo `user`). Status 409 significa que já existe assinatura para a URL.
4. Em cada tipo de evento: confirme duração, local (Google Meet, telefone etc.), lembretes e mensagens de confirmação — o agente não envia confirmações próprias.
5. Integração de calendário: conecte o Google Calendar do item `[CALENDÁRIO]` em **Integrações → Calendários**, marque-o para "verificar conflitos" e como calendário onde os eventos são adicionados.

## 6. n8n, PostgreSQL e Claude API

```bash
cp .env.example .env    # preencha senha, chave de criptografia, domínio e chave do webhook
docker compose up -d postgres
docker compose run --rm --entrypoint sh n8n /agente/scripts/n8n-import.sh
docker compose up -d n8n
```

- Coloque um proxy HTTPS na frente (`https://<N8N_HOST>` → `127.0.0.1:5678`). O webhook do Calendly exige HTTPS público.
- Crie o usuário dono no n8n, depois as quatro credenciais com **exatamente** estes nomes (os workflows já apontam para elas; após criar, abra cada workflow e confirme a credencial selecionada nos nós HTTP/Postgres):
  - `Agente Postgres` (host `postgres`, banco/usuário `agente`, senha do `.env`);
  - `Agente Gmail OAuth2` (seção 4);
  - `Agente Anthropic API` — Header Auth, nome `x-api-key`, valor = chave da Claude API;
  - `Agente Calendly PAT` (seção 5).
- Rode `seed-settings` (seção 2) e o workflow **Agente | Configuração inicial** manualmente.
- Modelo padrão: `claude-opus-5-5` com `effort: medium` e `fallbacks: "default"` (refaz no servidor em caso de recusa do classificador). Ajuste em `agente.settings.ai`.

Segredos ficam somente nas credenciais criptografadas do n8n e no `.env` do servidor; não entram no prompt, no banco nem no repositório.
