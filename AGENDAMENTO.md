# Agendamento online · Dr. Daniel Cardoso de Bastos

Página de agendamento (Clínico Geral · CRM-SP 239894) publicada no Netlify. O paciente escolhe dia e horário,
deixa nome e WhatsApp, e o pedido chega automaticamente:

- **no e-mail** (notificação nativa do Netlify Forms, um aviso por endereço cadastrado);
- **no WhatsApp do secretário** (função `submission-created`, disparada a cada pedido verificado).

```
public/index.html                        página (HTML, CSS e JS num arquivo só)
netlify/functions/submission-created.mjs envia cada pedido ao WhatsApp do secretário
netlify.toml                             pasta publicada, funções e cabeçalhos (noindex)
```

## 1. Publicar

1. No Netlify: **Add new project → Import an existing project → GitHub** e escolha este repositório e a branch.
   O `netlify.toml` já informa a pasta publicada (`public`) e a das funções; não há comando de build.
2. Use o deploy pelo GitHub (ou pela Netlify CLI). O "arrastar e soltar" (Netlify Drop) **não publica a função**
   do WhatsApp.
3. **Forms → Enable form detection** e faça um novo deploy. Sem isso o Netlify não recebe os pedidos.
   Depois do deploy, o formulário `agendamento-dr-daniel` aparece em **Forms**.

## 2. E-mails

**Forms → Submission notifications → Add notification → Email notification**, escolha o formulário
`agendamento-dr-daniel` e informe o e-mail. Repita para cada endereço que deve receber os pedidos.

- O e-mail vem de `formresponses@netlify.com`. Na primeira vez, confira a caixa de spam e marque como "não é spam".
- Cada e-mail traz: nome, WhatsApp, data, horário, consentimento LGPD, o link **adicionar_google_agenda**
  (cria o evento já com dia e hora) e o link **responder_paciente_whatsapp** (abre a conversa com o paciente
  com uma mensagem pronta).

## 3. WhatsApp do secretário

Em **Site configuration → Environment variables**, crie as variáveis abaixo com escopo **Functions** e faça um novo
deploy. Os números vão só com dígitos: `55` + DDD + número (ex.: `5511912345678`). Para mais de um destino,
separe por vírgula.

### Opção A: API oficial do WhatsApp (Meta), recomendada

É o caminho oficial: estável e com contrato de tratamento de dados da Meta. Exige um número de WhatsApp Business
API (um número que não esteja em uso no aplicativo comum) e um modelo de mensagem aprovado.

1. Em [developers.facebook.com](https://developers.facebook.com), crie um app do tipo **Business** e adicione o
   produto **WhatsApp**. Anote o **Phone number ID**.
2. Em **Business Settings → System users**, crie um usuário de sistema, dê acesso ao app e gere um token
   permanente com a permissão `whatsapp_business_messaging`.
3. Em **WhatsApp Manager → Message templates**, crie um modelo:
   - Nome: `novo_agendamento` · Categoria: **Utility** · Idioma: **Portuguese (BR)**
   - Corpo:
     ```
     Novo pedido de agendamento pelo site.
     Paciente: {{1}}
     WhatsApp: {{2}}
     Dia: {{3}}
     Horário: {{4}} (horário de Brasília)
     Responder ao paciente: {{5}}
     ```
4. Variáveis no Netlify:

| Variável | Valor |
| --- | --- |
| `WHATSAPP_PROVEDOR` | `meta` |
| `WHATSAPP_DESTINO` | WhatsApp do secretário, ex.: `5511912345678` |
| `META_WHATSAPP_TOKEN` | token permanente do passo 2 |
| `META_PHONE_NUMBER_ID` | Phone number ID do passo 1 |
| `META_TEMPLATE` | `novo_agendamento` |
| `META_TEMPLATE_IDIOMA` | opcional, padrão `pt_BR` |
| `META_API_VERSAO` | opcional, padrão `v23.0` |

A Meta cobra por mensagem enviada com modelo; confira a tabela de preços da sua conta.
Sem `META_TEMPLATE`, a função envia texto livre, que a Meta só entrega se o secretário tiver escrito para o número
da clínica nas últimas 24 horas.

### Opção B: CallMeBot, rápido para começar

Gratuito e configurado em minutos, mas **não é oficial** (pode atrasar ou sair do ar) e os dados do paciente passam
por um serviço de terceiros. Avalie com o seu responsável pela LGPD antes de usar.

1. O secretário segue as instruções de [callmebot.com](https://www.callmebot.com/blog/free-api-whatsapp-messages/)
   (adicionar o contato do CallMeBot e enviar a mensagem de autorização) e recebe uma **apikey**.
2. Variáveis no Netlify:

| Variável | Valor |
| --- | --- |
| `WHATSAPP_PROVEDOR` | `callmebot` |
| `WHATSAPP_DESTINO` | WhatsApp do secretário, ex.: `5511912345678` |
| `CALLMEBOT_APIKEY` | a apikey recebida (uma por número, na mesma ordem de `WHATSAPP_DESTINO`) |

### Conferir se está funcionando

Faça um pedido de teste e veja **Logs → Functions → submission-created**: aparece "Aviso por WhatsApp enviado" ou o
motivo do erro (token, modelo, apikey). Os logs não registram nome nem telefone do paciente.

## 4. Logo e foto

Em `public/index.html` há dois pontos marcados com comentários:

- **LOGO DB**: troque `<span class="monograma" aria-hidden="true">DB</span>` pela tag `<img>` do logo original
  (`class="logo"`, `alt=""`, `width="52" height="52"`).
- **FOTO**: dentro de `<figure class="retrato">`, substitua todo o valor do `src` (hoje um GIF transparente
  provisório) pelo data URI da foto. Use uma imagem
  retrato 4:5 de cerca de 560 × 700 px em WebP ou JPEG comprimido (idealmente abaixo de 80 KB): o data URI
  entra inteiro no HTML e pesa no carregamento.

## 5. Ajustes da agenda

No início do `<script>` de `public/index.html`, o bloco `CONFIG` define: dias de atendimento, abertura e
fechamento (último horário 17:30 para fechar às 18:00), intervalo, semanas exibidas, antecedência mínima
(30 min), fechamento em Carnaval e Corpus Christi, feriados locais (`'MM-DD'`) e datas bloqueadas
(`'AAAA-MM-DD'`, para férias e congressos). Os feriados nacionais e a Sexta-feira Santa já são calculados
automaticamente, inclusive os móveis.
