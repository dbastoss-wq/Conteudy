# Passo a passo para colocar no ar (sem precisar programar)

Tempo estimado: 1 a 2 horas. Faça na ordem. Os nomes dos menus dos sites (Oracle, Meta,
Google) mudam de vez em quando; se algum botão tiver outro nome, procure o equivalente.

**O que você vai precisar ter à mão**

- Um cartão de crédito (o servidor grátis pede só para confirmar que você é uma pessoa real).
- O celular do WhatsApp pessoal para receber códigos de verificação.
- O e-mail Google em que está a sua agenda.

---

## 1. Servidor grátis + endereço grátis

### 1.1 Servidor (Oracle Cloud "Always Free")

1. Crie a conta em <https://www.oracle.com/br/cloud/free/>. Escolha a região **Brazil East (São Paulo)**
   (depois não dá para mudar).
2. Em **Compute → Instances → Create instance**:
   - Imagem: **Ubuntu 24.04** (ou 22.04).
   - Forma (Shape): **Ampere → VM.Standard.A1.Flex**, com **2 OCPU e 12 GB** (o máximo grátis hoje).
   - Baixe a **chave SSH** que o site oferece e guarde bem.
3. Em **Networking → sua VCN → Security List**, adicione regras de entrada (Ingress) para as
   portas **80** e **443** (origem `0.0.0.0/0`, protocolo TCP).
4. Anote o **IP público** da máquina.

> Se o cadastro for recusado ou aparecer "Out of capacity" (sem vagas), tente de novo em outro
> horário. Se não der, o plano B é um servidor pago barato; me peça que eu adapte o guia.

### 1.2 Endereço (domínio) grátis

1. Entre em <https://www.duckdns.org>, faça login e crie um nome, por exemplo
   `meuconsultorio` → o endereço será `meuconsultorio.duckdns.org`.
2. No campo "current ip", coloque o **IP público** do passo 1.1 e salve.

### 1.3 Preparar a máquina

Conecte por SSH (no Windows: PowerShell; no Mac: Terminal):

```bash
ssh -i caminho/da/chave.key ubuntu@IP_PUBLICO
```

Instale o Docker e baixe o projeto:

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER && newgrp docker
git clone https://github.com/dbastoss-wq/Conteudy.git && cd Conteudy
git checkout feat/secretaria-virtual-whatsapp
```

Libere as portas no firewall do Ubuntu (a Oracle bloqueia por padrão):

```bash
sudo iptables -I INPUT 6 -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -p tcp --dport 443 -j ACCEPT
sudo apt-get install -y iptables-persistent && sudo netfilter-persistent save
```

Gere o arquivo de configuração (cria sozinho as senhas e chaves internas):

```bash
docker run --rm -v "$PWD":/app -w /app node:22 sh -c "npm ci && npm run setup:env"
```

**Anote a senha do painel que aparecer na tela.** Abra o arquivo para preencher o resto:

```bash
nano .env
```

Preencha agora: `DOMAIN=meuconsultorio.duckdns.org`, `APP_BASE_URL=https://meuconsultorio.duckdns.org`
e `ADMIN_EMAIL`. (Salvar no `nano`: `Ctrl+O`, `Enter`, `Ctrl+X`.)

---

## 2. WhatsApp (Meta) — 4 valores

1. Entre em <https://developers.facebook.com>, **Criar app** → tipo **Business** → adicione o produto **WhatsApp**.
2. Em **WhatsApp → API Setup**:
   - Copie o **Phone Number ID** → `WHATSAPP_PHONE_NUMBER_ID`.
   - A Meta dá um **número de teste** grátis. Use-o primeiro, antes de ligar o número do consultório.
3. Em **App settings → Basic**: copie o **App secret** → `WHATSAPP_APP_SECRET`.
4. **Token que não expira** (o da tela API Setup vale só 24 h): em <https://business.facebook.com> →
   **Configurações → Usuários → Usuários do sistema** → crie um (Admin) → atribua o seu app →
   **Gerar token** com as permissões `whatsapp_business_messaging` e `whatsapp_business_management`
   → `WHATSAPP_ACCESS_TOKEN`.
5. **Webhook** (depois que o app estiver no ar, passo 5): em **WhatsApp → Configuration**:
   - Callback URL: `https://meuconsultorio.duckdns.org/webhook`
   - Verify token: o valor de `WHATSAPP_VERIFY_TOKEN` do seu `.env`
   - Assine o campo **messages**.

Para usar o número real do consultório: adicione-o em **API Setup → Add phone number**. Atenção:
um número ligado à API deixa de funcionar no aplicativo comum do WhatsApp.

---

## 3. Google Agenda — 3 valores

1. Em <https://console.cloud.google.com> crie um **projeto** → **APIs e serviços → Biblioteca** →
   ative a **Google Calendar API**.
2. **Tela de consentimento OAuth**: tipo **Externo**; adicione o seu e-mail como **usuário de teste**.
   Depois clique em **Publicar app** (status "Em produção"). Isso é importante: em modo de teste o
   acesso expira em 7 dias e a secretária para de agendar. Vai aparecer o aviso "app não verificado"
   só para você, é normal.
3. **Credenciais → Criar credenciais → ID do cliente OAuth → Aplicativo da Web**. Em "URIs de
   redirecionamento autorizados" coloque exatamente `http://localhost:3000/oauth/google/callback`.
   Copie o **ID do cliente** → `GOOGLE_CLIENT_ID` e a **chave secreta** → `GOOGLE_CLIENT_SECRET`.
4. Gerar o `GOOGLE_REFRESH_TOKEN` (**antes** de subir o app). No seu computador, abra um segundo
   terminal e crie o túnel:

   ```bash
   ssh -i caminho/da/chave.key -L 3000:localhost:3000 ubuntu@IP_PUBLICO
   ```

   Nesse terminal (dentro da pasta `Conteudy`), rode:

   ```bash
   docker run --rm -it --network host -v "$PWD":/app -w /app node:22 npm run oauth:google
   ```

   Abra no navegador do seu computador o link que aparecer, autorize com a conta da agenda e copie o
   `GOOGLE_REFRESH_TOKEN=...` mostrado para o `.env`.

---

## 4. Chave da IA — 1 valor (não é grátis)

A IA só lê as mensagens dos pacientes; o custo é baixo, mas é cobrado por uso.

1. Crie conta na API da Anthropic, adicione um crédito pequeno e crie uma **API key**.
2. No `.env`: `LLM_API_KEY=` (a chave), `LLM_PROVIDER=anthropic`, `LLM_MODEL=claude-haiku-5-5`.

---

## 5. Subir e testar

```bash
docker compose up -d --build
docker compose run --rm app node dist/db/seed.js     # cria o seu login do painel
```

1. Abra `https://meuconsultorio.duckdns.org/admin` e entre com o e-mail e a senha anotados.
2. Faça o passo 2.5 (webhook) no painel da Meta.
3. Do seu celular, mande "oi" para o **número de teste**. Deve chegar a mensagem de apresentação.
4. Peça uma consulta e confira se o evento apareceu na sua Google Agenda.

---

## 6. Cuidados com dados de pacientes

- **Backup**: o plano grátis não faz backup para você. Rode toda semana e guarde fora do servidor:
  `docker compose exec db pg_dump -U secretaria secretaria > backup.sql`
- **`ENCRYPTION_KEY`**: copie esta linha do `.env` para um lugar seguro (gerenciador de senhas).
  Sem ela, os motivos de consulta já gravados não podem ser lidos.
- Nunca envie o arquivo `.env` por e-mail ou chat, nem cole tokens em conversas.
