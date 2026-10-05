# Sabiá

App Vite + rotas serverless da Vercel. O site conversa em `/api/chat`. O bot do Telegram entra em `/api/telegram`.

## Variáveis de ambiente (Vercel → Settings → Environment Variables)

| Variável | Obrigatória | O que é |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | sim | Token do bot, gerado no @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | sim | Texto aleatório; protege o webhook e o `/api/setup` |
| `TELEGRAM_SETUP_SECRET` | não | Chave do `/api/setup` (se ausente, usa `TELEGRAM_WEBHOOK_SECRET`) |
| `SABIA_API_KEY` | não | Chave da API de IA (padrão: xAI/Grok). Sem ela, usa o AI Gateway da Vercel (`xai/grok-4.5`) sem chave |
| `SABIA_API_URL` | não | Endpoint compatível com OpenAI (padrão `https://api.x.ai/v1/chat/completions`) |
| `SABIA_MODEL` | não | Modelo (padrão `grok-4`) |
| `SABIA_SYSTEM_PROMPT` | não | Personalidade do bot |
| `SABIA_DAILY_LIMIT` | não | Mensagens por chat por dia (padrão 200) |
| `SABIA_RATE_LIMIT_PER_MINUTE` | não | Mensagens por chat por minuto (padrão 12) |
| `SABIA_MAX_OUTPUT_TOKENS` | não | Tamanho máximo da resposta (padrão 800) |

Depois de criar ou mudar variáveis, faça **Redeploy**.

## Ligar o bot

Abra no navegador, uma vez:

```
https://SEU-DOMINIO/api/setup?key=SUA_CHAVE_DE_SETUP
```

(`/api/ligar` é um atalho para a mesma rota.) Isso registra o webhook em `https://SEU-DOMINIO/api/telegram`. Confira em `/api/health`.

Alternativa pela linha de comando:

```bash
WEBHOOK_URL=https://SEU-DOMINIO/api/telegram npm run webhook
```

Não grave o token no repositório.

## Testar a IA

```
https://SEU-DOMINIO/api/teste?key=SUA_CHAVE_DE_SETUP&q=qual a capital do Brasil
```
