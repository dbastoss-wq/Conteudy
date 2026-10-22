# Consulta em Foco

Aplicativo executável de pré-consulta, teleconsulta, evolução, prescrição e documentos. Backend FastAPI, banco SQLite persistente, arquivos privados cifrados e interface em português do Brasil.

Identidade fornecida: **Dr. Daniel Cardoso de Bastos · Clínico geral · CRM-SP 239894**. Fuso **America/Sao_Paulo**. Endereço, CPF, contato, credenciais e certificados precisam ser preenchidos pelo responsável.

**A entrega permite executar e verificar o fluxo. Uso com pacientes reais exige configuração e validação operacional.** Não representa certificação de prontuário, homologação sanitária ou integração ativa ao SNCR.

**“Ficha Pré-Consulta.html” não foi disponibilizado no workspace.** A implementação segue os requisitos textuais; comparação e preservação de recursos específicos do original permanecem pendentes.

## Demonstração local

Requisitos: Python 3.11 ou 3.12, Linux/macOS/WSL e navegador atual. Validação local em Linux com Python 3.12.

~~~bash
python -m venv .venv
source .venv/bin/activate
python -m pip install -c requirements.lock -e '.[dev]'
python -m consulta.cli demo --port 8000
~~~

Abra **http://127.0.0.1:8000** e clique em **Abrir demonstração vazia**. Cada ação cria uma conta isolada, sem pacientes ou exemplos clínicos pré-carregados. Use somente dados fictícios. Diretório temporário e chave são descartados ao encerrar o processo. PDFs desse modo recebem identificação de demonstração.

Veja o [percurso de demonstração](docs/TESTES.md). Preenchimento, edição, salvamento e PDF funcionam sem CDN, fonte remota, IA ou serviço de vídeo.

## Instalação persistente

~~~bash
python -m consulta.cli init --development
python -m consulta.cli create-doctor --username seu-usuario
python -m consulta.cli serve --port 8000
~~~

O comando init cria .env restrito e chave aleatória, sem imprimi-la. A opção --development configura HTTP para ensaio local. A senha é solicitada no terminal, com confirmação e mínimo de 14 caracteres. Não existe senha de produção predefinida nem cadastro público de médicos.

Para produção, use init sem --development, configure APP_BASE_URL com origem HTTPS real e complete perfil e aviso de privacidade. Proteja .env/chave com gestão de segredos. Guarde cópia da chave separada do banco e dos backups: sem ela os conteúdos cifrados não são recuperáveis.

O servidor escuta em 127.0.0.1. Um proxy deve terminar TLS e encaminhar as rotas. Use uma instância e armazenamento local persistente; esta versão não oferece cluster de banco. Veja [Operação](docs/OPERACAO.md).

## Fluxo

~~~mermaid
flowchart LR
    A[Convite privado] --> B[Pré-consulta]
    B --> C[Revisão e teleconsulta]
    C --> D[Evolução finalizada]
    D --> E[Prescrição revisada]
    E --> F[PDF final congelado]
    F --> G[Assinatura externa]
    G --> H[Verificação técnica]
    H --> I[Portal privado]
    I --> J[Retorno vazio com histórico]
~~~

- Permissões de médico/paciente são verificadas no servidor em cada rota.
- Rascunhos usam salvamento no servidor e revisão para evitar sobrescrita entre abas. Não há prontuário em localStorage, IndexedDB ou service worker.
- HPMA/SOAP literal e IA opcional produzem propostas com comparação antes de aplicar. A IA começa desligada.
- Finalização preserva evolução/teleconsulta; complementações são adendos. Prescrições posteriores têm revisão própria.
- Prescrição não assume medicamento, dose, via ou frequência. Interações/contraindicações aparecem como **não verificadas**.
- PDF A4 de rascunho é identificado em todas as páginas. Evolução e teleconsulta também têm exportação.
- Assinatura requer arquivo incremental, conteúdo preservado, titular correspondente, cadeia configurada e revogação verificável. Entrega preserva os bytes assinados. Veja [assinatura e receituário](docs/ASSINATURA_E_RECEITUARIO.md).

## Configuração

| Variável | Uso |
| --- | --- |
| APP_ENV / APP_BASE_URL | Ambiente e origem; HTTPS obrigatório em produção |
| APP_ENCRYPTION_KEY / APP_DATA_DIR | Chave e diretório privado de banco/arquivos |
| SESSION_SECONDS / SESSION_IDLE_SECONDS | Expiração absoluta e por inatividade |
| AI_ENABLED / OPENAI_API_KEY / OPENAI_MODEL | IA opcional, desligada por padrão |
| ICP_TRUST_DIR / ICP_TRUST_MANIFEST | Raízes/CRLs conferidas e manifesto administrativo |
| SIGNATURE_REVOCATION_REQUIRED | Deve ser true; desativar impede verificação positiva |

Nenhuma credencial, certificado privado ou dado clínico real está incluído.

## Verificação

~~~bash
ruff check .
ruff format --check .
pytest -q
python -m playwright install chromium
RUN_BROWSER_TESTS=1 pytest -q
~~~

O último comando inclui navegador real. Instalá-lo exige rede no preparo; a aplicação não o utiliza em operação. CI instala as bibliotecas de sistema necessárias.

Consulte [testes](docs/TESTES.md) e [matriz de entrega](docs/ENTREGA.md).

## Código

API e permissões em consulta/api.py; modelos e validações em models.py/clinical.py; autenticação, persistência e auditoria em security.py/store.py; PDF/assinatura em pdfs.py/signatures.py; uploads, backup e administração em uploads.py/backup.py/cli.py; interface em consulta/web; testes em tests.

O agente e-mail/Calendly anterior está no [PR #8](https://github.com/dbastoss-wq/Conteudy/pull/8). Sua conexão com esta aplicação ainda não foi implementada. O workflow n8n de redes sociais recebido não é executado nem recebe dados assistenciais. Não houve envio real de e-mail, mensagem ou postagem.
