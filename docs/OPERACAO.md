# Operação e proteção dos dados

## Implantação

Use uma instância com armazenamento local persistente. O CLI lê .env a partir da raiz. Alternativamente, configure variáveis no serviço e inicie:

~~~bash
uvicorn consulta.main:app --host 127.0.0.1 --port 8000 --workers 1 --no-access-log
~~~

Configure APP_ENV=production e APP_BASE_URL com HTTPS real, proxy de mesma origem, TLS e firewall. Cookies são Secure/HttpOnly/SameSite=Lax; respostas usam no-store e não permitem enquadramento externo. Configure proxy/logs para não capturar corpos, cookies, cabeçalhos ou URLs assistenciais. Não instale analytics, captura de sessão ou marketing na área clínica.

O domínio de exemplo não é serviço ativo. O comando serve escuta em loopback e não provê TLS. Hospedagem, atualizações e disponibilidade dependem da operação.

## Contas e convites

Médicos são provisionados por create-doctor. Senhas usam Argon2id; não existe senha de produção embutida. Sessões médicas: 12 h absolutas/30 min sem atividade por padrão. Sessões de pacientes: máximo 2 h, dependentes de convite válido. Sem MFA, recuperação automática ou login social.

Convites são credenciais por posse: compartilhe com paciente/responsável identificado por canal adequado. Uso único, expiração em 72 h e revogação encerrando sessões. Nova entrada após encerrar sessão exige novo convite. Revogação não recolhe arquivos já baixados.

O token está no fragmento #token, trocado por sessão pelo navegador. Não é parâmetro de URL enviado ao servidor/referrer. O banco guarda somente hash. Não há envio automático de convites.

## Dados

APP_DATA_DIR fica fora da área pública. Diretórios usam 0700 e arquivos 0600. Identificação, relatos, prescrições, perfis, versões e anexos são cifrados com Fernet autenticado. A chave não fica no banco.

Metadados SQLite (IDs, relações, horários, login e hashes) não são cifrados integralmente. Aplique proteções de volume e acesso. Preserve a chave em gestão de segredos e cópia separada; sem ela os dados não podem ser recuperados. Rotação/migração de chave e KMS não foram implementados.

Auditoria registra ação, ator, ID e horário, sem narrativa, nome do paciente, medicamento, token ou certificado. Fica no mesmo banco e não é trilha externa inviolável. Administradores precisam de controles organizacionais.

## Salvamento

Pendências ficam somente na memória do navegador. “Salvo no servidor” depende de resposta confirmada. Revisões e transações impedem sobrescrita silenciosa. Conflito mantém texto local para comparar/exportar e decidir.

Rede indisponível mantém texto na tela, ainda não salvo. Não feche com pendências. A tentativa de envio no fechamento é complementar; encerramento forçado, sessão expirada ou ausência de rede podem perder texto que o servidor nunca recebeu. Sem prontuário em localStorage, IndexedDB, service worker ou cache offline.

Pré-consulta enviada preserva relato. Correção de cadastro tem versão; evolução finalizada recebe adendos. Documentos guardam snapshots, sem reescrever PDFs assinados.

## Anexos

PDF/PNG/JPEG até 10 MB, com conferência de MIME, estrutura e limites de páginas/dimensões. PDFs protegidos e algumas ações automáticas são recusados. Conteúdo não é executado, interpretado ou publicado; nomes internos são aleatórios, com cifragem e acesso autorizado.

Não há antivírus/sandbox. A interface informa verificação de malware não realizada; o profissional deve abrir anexos em software atualizado. Assinaturas importadas têm limite separado de 15 MB.

## Backup e restauração

~~~bash
mkdir -m 700 backups
python -m consulta.cli backup backups/consulta-2026-10-22.zip
python -m consulta.cli restore backups/consulta-2026-10-22.zip restored-data
~~~

Snapshot SQLite consistente, arquivos referenciados e manifesto cifrado/autenticado com hashes. Conteúdos assistenciais e anexos permanecem cifrados no ZIP; metadados não são cifrados integralmente. Não inclui .env, chave, certificado privado ou configuração ITI: preserve-os em procedimento administrativo separado/restrito.

Restaure em diretório novo com a chave correspondente. O programa confere integridade, descriptografia e hashes e invalida sessões. Limite: 2 GiB descomprimidos. Confira antes de alterar APP_DATA_DIR; não substitua instalação ativa durante o ensaio.

O teste verifica recuperação de dados/arquivos e recusa de corrupção. Agendamento, cópia externa, retenção e recuperação em outra máquina dependem da operação.

## IA

Desligada por padrão. Organização literal/edição funcionam sem API. Quando habilitada, envia somente trechos selecionados e limitados, removendo identificadores conhecidos. Não envia anexos, prontuário completo ou PDFs assinados. Texto livre pode conter identificadores não detectados.

Cada solicitação exige confirmação médica do processamento externo. Propostas são comparadas antes de aplicar; nenhuma ferramenta assina, prescreve, finaliza ou envia mensagens. Não há pesquisa de evidências; referências não consultadas não são fabricadas. Falhas não bloqueiam edição manual.

Configure finalidade, minimização, contratos, retenção, acesso e aviso de privacidade com os responsáveis antes de habilitar o provedor.

## Uso real

Confira dados profissionais e dos pacientes. Configure privacidade, guarda, direitos, backup externo, restauração operacional, HTTPS e incidentes. PDFs assinados exigem cadeia ICP-Brasil correta/CRLs atuais. Categorias bloqueadas exigem integração/validação próprias; não basta marcar categoria diferente.

A classificação sanitária, adequação assistencial e governança precisam de validação dos responsáveis. O código não declara homologação ou certificação.
