# Agente de atendimento por e-mail com Calendly

Agente que lê a caixa de e-mail da empresa, responde dentro das regras e da base de conhecimento autorizada, envia links de agendamento do Calendly, encaminha exceções a um responsável e mantém o registro de conversas e reservas. Construído com **n8n**, **Gmail API (Google Workspace)**, **Calendly API v2**, **Claude API** e **PostgreSQL**.

## Estado atual

| | |
|---|---|
| **Implementado** | 7 workflows n8n, schema PostgreSQL com funções de idempotência, filtros anti-ciclo, camada de política sobre a IA, webhook do Calendly com assinatura, reconciliação, alertas, docker-compose. |
| **Testado** | 13 testes unitários e 17 cenários de integração com **n8n e PostgreSQL reais e APIs simuladas**, mais o alerta de falha com gatilho agendado real. Detalhes em [docs/testes.md](docs/testes.md). |
| **Depende de configuração** | Domínio/caixa do agente, OAuth do Google, token do Calendly e plano com webhooks, chave da Claude API, servidor com HTTPS, dados da empresa e base de conhecimento. Nada disso foi conectado a contas reais. Lista em [docs/configuracao.md](docs/configuracao.md). |

## Estrutura

```
config/          exemplo de configuração e de base de conhecimento (preencha as cópias sem .example)
prompts/         prompt de sistema do agente
src/             lógica embutida nos nós Code (e-mail, filtros, IA, política, Calendly)
db/schema.sql    tabelas e funções SQL (schema "agente")
scripts/         build dos workflows, carga de configuração, importação no n8n
workflows/       JSON gerados para importar no n8n
tests/           unitários, simulador de APIs e teste de integração
docs/            arquitetura, configuração, operação e testes
```

## Início rápido

1. Siga [docs/configuracao.md](docs/configuracao.md) (contas, DNS, OAuth, credenciais).
2. `docker compose up -d postgres` → importar workflows → `docker compose up -d n8n`.
3. `node scripts/seed-settings.js config/agent.config.json config/knowledge-base.md | psql "$DATABASE_URL"`.
4. Rodar manualmente **Agente | Configuração inicial** no n8n.
5. Validar com caixa e calendário de teste ([docs/testes.md](docs/testes.md)), depois apontar para a caixa real.

Área de teleconsulta em psiquiatria (desligada por padrão): [docs/psiquiatria.md](docs/psiquiatria.md).

Documentação: [arquitetura](docs/arquitetura.md) · [configuração](docs/configuracao.md) · [operação](docs/operacao.md) · [testes](docs/testes.md).
