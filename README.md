# Conteudy — Teleconsulta (PWA)

App instalável para preencher a anamnese durante a teleconsulta: checklists, campos editáveis,
cronômetro por etapa, alertas de risco (ASQ/CRAFFT), botão SOS, plano de segurança e prontuário.
HTML/CSS/JS puros, sem build. Funciona offline e salva no próprio aparelho.

## Dados do paciente ficam FORA do Git

Este repositório é público. O conteúdo com dados reais fica em `content.js`, que está no `.gitignore`.

1. `cp content.example.js content.js`
2. Edite `content.js` com os dados do paciente (nome, contatos, relato do encaminhante, rascunhos).
3. Rode localmente: `python3 -m http.server 8000` e abra `http://localhost:8000`.

Para instalar no celular é preciso servir por HTTPS. Faça o deploy a partir da sua pasta local
(que contém `content.js`), nunca a partir deste repositório público com dados reais.

## Arquivos

- `index.html`, `style.css`, `app.js`: interface e lógica
- `content.example.js`: modelo do roteiro (sem dados reais)
- `sw.js`, `manifest.webmanifest`, `icons/`: instalação e uso offline
