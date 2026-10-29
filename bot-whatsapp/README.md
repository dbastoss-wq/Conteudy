# Assistente de WhatsApp do consultório

Assistente virtual (IA) que atende pacientes no WhatsApp do consultório do Dr. Daniel Cardoso de Bastos
e faz **pedidos de agendamento** ligados à agenda online
[agenda-dr-daniel.netlify.app](https://agenda-dr-daniel.netlify.app).

## Como funciona

1. O paciente escreve no WhatsApp ("quero marcar para sexta de manhã").
2. A IA (Claude, da Anthropic) consulta os horários livres com **as mesmas regras da página**: segunda,
   quinta, sexta e sábado, das 09:00 às 17:30, 4 semanas à frente, 30 minutos de antecedência,
   feriados nacionais, Carnaval e Corpus Christi.
3. Com nome, sobrenome, dia e horário, o assistente manda um **resumo com os botões Confirmar e Corrigir**.
4. Só o toque em **Confirmar** envia o pedido. Ele vai para o **mesmo formulário da Netlify** que a página
   usa (`agendamento-dr-daniel`), com os mesmos campos. O pedido chega no painel e no e-mail de sempre,
   com os links "Adicionar ao Google Agenda" e "Responder no WhatsApp".
5. O paciente recebe o link da triagem pré-consulta. A equipe confirma o horário, como já faz com os
   pedidos do site.

O celular do pedido é o do próprio WhatsApp do paciente; a IA não digita esse número. O toque em
Confirmar vale como a autorização da LGPD, a mesma da página.

### O que o assistente faz e o que ele não faz

| Faz | Não faz |
|---|---|
| Pedidos de agendamento, com as regras da agenda | Não confirma consulta: quem confirma é a equipe |
| Informa a agenda online, a triagem, o endereço e que a teleconsulta é pelo Zoom | Não dá orientação médica, não interpreta sintomas nem exames |
| Passa para a equipe quando o paciente pede uma pessoa, fala de algo clínico ou pergunta valores, convênios, receitas, atestados, remarcação | Não inventa valores, convênios nem prazos |
| Orienta SAMU 192 e CVV 188 em sinais de emergência; esse aviso sai pelo código, antes da IA, mesmo se a IA falhar | Não lê áudio nem imagem: pede que o paciente escreva |
| Avisa a equipe no WhatsApp a cada pedido, encaminhamento ou emergência | Não pede CPF, endereço, convênio nem dados de saúde |

Quando passa a conversa para a equipe, o assistente fica em silêncio naquela conversa por 12 horas
(`PAUSA_APOS_ENCAMINHAR_HORAS`), para a equipe responder sem interrupção.

## Passo a passo para colocar no ar

### 1. Número de WhatsApp

O assistente usa a **WhatsApp Cloud API** (oficial da Meta). Há dois caminhos:

- **Mesmo número do consultório.** A Meta permite, em muitos casos, ligar à Cloud API um número que
  já usa o app WhatsApp Business ("coexistência"). O app continua funcionando e a equipe responde por
  ele quando o assistente encaminha a conversa. A disponibilidade depende da conta e do país; confira no
  momento do cadastro do número.
- **Um segundo número só para o assistente.** O WhatsApp do consultório continua como está. Nos avisos,
  a equipe recebe o link `wa.me` do paciente e responde pelo WhatsApp de sempre.

### 2. App na Meta (developers.facebook.com)

1. Crie um app do tipo **Business** e adicione o produto **WhatsApp**.
2. Cadastre o número e anote o **Phone number ID** (`WHATSAPP_PHONE_NUMBER_ID`).
3. Em Business Settings, crie um **Usuário do Sistema**, dê acesso ao app e à conta do WhatsApp e gere
   um **token permanente** com as permissões `whatsapp_business_messaging` e
   `whatsapp_business_management` (`WHATSAPP_ACCESS_TOKEN`).
4. Em App Settings > Basic, copie o **App Secret** (`WHATSAPP_APP_SECRET`).
5. Invente uma senha longa para o **Verify token** (`WHATSAPP_VERIFY_TOKEN`).

O webhook é configurado no passo 6, depois do deploy.

### 3. Chave do Claude

Em [console.anthropic.com](https://console.anthropic.com), crie uma chave de API (`ANTHROPIC_API_KEY`)
e cadastre um meio de pagamento. O modelo padrão é o **Claude Opus 5.5** com esforço baixo (`low`), que
responde rápido. Se o modelo recusar uma mensagem por política de segurança, a API tenta de novo
sozinha num modelo alternativo (fallback automático, já ligado). Para gastar menos, use
`CLAUDE_MODEL=claude-haiku-5-5`; nesse modelo não há fallback automático.

### 4. Memória das conversas (Redis)

Na Vercel, em **Storage / Marketplace**, adicione um Redis (Upstash ou Redis Cloud) ao projeto. Ele
cria a variável `REDIS_URL`. Sem Redis, o assistente esquece a conversa a cada nova execução.

### 5. Deploy na Vercel

1. Importe este repositório na Vercel e escolha **Root Directory = `bot-whatsapp`**.
2. Framework: **Other**. Não precisa de comando de build.
3. Cadastre as variáveis de ambiente de [`.env.example`](.env.example).
4. Faça o deploy e abra `https://SEU-PROJETO.vercel.app/api/saude`. Deve mostrar `"ok": true`. A página
   só diz o que está configurado; nenhum segredo aparece.

### 6. Webhook na Meta

No app da Meta, em WhatsApp > Configuration:

- **Callback URL:** `https://SEU-PROJETO.vercel.app/api/webhooks/whatsapp`
- **Verify token:** o mesmo `WHATSAPP_VERIFY_TOKEN`
- Em **Webhook fields**, assine `messages`.

Mande "oi" de outro celular para o número do assistente e confira a resposta.

### 7. Avisos para a equipe (recomendado)

Defina `EQUIPE_WHATSAPP` com o celular que deve receber os avisos (com 55 e DDD). O WhatsApp só deixa
uma empresa mandar texto livre para quem falou com ela nas últimas 24 horas. Escolha um dos dois:

- **Mais simples:** a equipe manda qualquer mensagem para o número do assistente uma vez por dia. Ele
  responde "Avisos do assistente ativos…".
- **Mais garantido:** crie na Meta um modelo de mensagem (categoria Utilidade, idioma português) com
  uma variável, por exemplo `aviso_equipe`: "Assistente do consultório: {{1}}". Depois de aprovado,
  defina `EQUIPE_TEMPLATE=aviso_equipe`.

Se um aviso falhar, o paciente não é afetado. O pedido também chega pelo formulário da Netlify, como
os do site.

## Antes de divulgar

- **Netlify Forms:** os pedidos do assistente chegam no mesmo formulário, enviados pelo servidor. Na
  primeira semana, olhe também a aba **Spam** do formulário na Netlify; se algum pedido legítimo
  aparecer lá, marque como "não é spam".
- **Privacidade (LGPD):** as mensagens são processadas pelo Claude (Anthropic). A Anthropic não usa
  dados da API para treinar modelos por padrão. Mesmo assim, inclua no aviso de privacidade do site que
  o WhatsApp tem um assistente virtual com IA. O assistente guarda a conversa por até 24 horas no Redis
  e o pedido ainda não confirmado por 2 horas; os registros do servidor não guardam o texto das
  mensagens.
- **Faça um teste completo** com o seu celular: peça um horário, toque em Confirmar e veja o pedido
  chegar na Netlify e o aviso chegar na equipe.

## Manutenção

- **Mudou a agenda?** Se mudar dias, horários, férias ou feriados locais no `CONFIG` da página, mude
  igual em [`src/config.ts`](src/config.ts) (`AGENDA`) e rode `npm run conferir-pagina`. Esse teste abre
  a página publicada num navegador, em várias datas, e confere que o assistente oferece exatamente os
  mesmos dias e horários. Ele precisa do Playwright:
  `npm i --no-save playwright && npx playwright install chromium`.
- **Testes:** `npm run check` roda a checagem de tipos e os testes. Os testes de ponta a ponta simulam
  a Meta, o Claude e a Netlify em servidores locais, com webhooks assinados.

## Variáveis de ambiente

| Variável | Obrigatória | Para quê |
|---|---|---|
| `WHATSAPP_ACCESS_TOKEN` | sim | token permanente da Cloud API |
| `WHATSAPP_APP_SECRET` | sim | confere a assinatura de cada webhook |
| `WHATSAPP_PHONE_NUMBER_ID` | sim | ID do número na Meta |
| `WHATSAPP_VERIFY_TOKEN` | sim | senha da verificação do webhook |
| `ANTHROPIC_API_KEY` | sim | chave do Claude |
| `REDIS_URL` | em produção | memória das conversas |
| `EQUIPE_WHATSAPP` | recomendada | celular que recebe os avisos |
| `EQUIPE_TEMPLATE` | não | modelo aprovado para avisos fora da janela de 24 h |
| `CLAUDE_MODEL` | não | padrão `claude-opus-5-5` |
| `CLAUDE_EFFORT` | não | padrão `low` |
| `PAUSA_APOS_ENCAMINHAR_HORAS` | não | padrão 12 |
| `BOT_DEBOUNCE_MS` | não | espera por mensagens em sequência; padrão 2000 |
| `NETLIFY_FORM_URL`, `NETLIFY_FORM_NAME` | não | já apontam para o formulário da página |

## Estrutura

```
api/webhooks/whatsapp.ts  webhook da Meta (GET verificação, POST mensagens e botões)
api/saude.ts              mostra o que está configurado
src/bot.ts                conversa, botões Confirmar/Corrigir, avisos e pausa
src/ia.ts                 Claude com ferramentas (consultar horários, preparar pedido, encaminhar)
src/agenda.ts             regras da agenda, copiadas da página
src/formulario.ts         envio ao formulário da Netlify
src/seguranca.ts          triagem de emergência (SAMU 192, CVV 188)
src/memoria.ts            histórico, pedido pendente, pausa e trava contra toque duplo
```
