# Matriz de entrega

Requisitos textuais de Consulta em Foco, com distinção entre testes de software, configuração e recursos ausentes.

| Área | Situação | Evidência ou limite |
| --- | --- | --- |
| Produção vazia e demonstração explícita | Implementado e testado | Sem exemplos automáticos; demo temporária e conta isolada |
| Backend e persistência | Implementado e testado | FastAPI/SQLite; nova instância recupera rascunho |
| Autenticação e isolamento | Implementado e testado | Argon2id, sessões, CSRF/origem e autorização no servidor por médico/paciente/atendimento |
| Convites | Implementado e testado | Token como hash, uso único, 72 h, revogação de sessões |
| Pré-consulta em etapas | Implementado e testado | HPMA opcional estruturada, responsável quando aplicável, estados distintos de informação |
| Relato original e negativas | Implementado e testado | Propostas não aplicadas automaticamente; comparação e versões por origem |
| Teleconsulta | Implementado e testado | Identidade, localização, reconexão, consentimento, horários, limitações, acompanhante e sinais vitais com origem |
| Vídeo externo | Implementado e testado | HTTPS de provedores permitidos, validado; sem chamada simulada |
| Computador/celular | Implementado e testado | Painéis ajustáveis, abas mantidas no DOM, faixa clínica fixa durante rolagem |
| Evolução, histórico e adendos | Implementado e testado | Tradicional/SOAP, registro finalizado preservado, adendos e exportação |
| Prescrição estruturada | Implementado e testado | Sem posologia implícita, decimais, ordenar/copiar/remover e favoritos reconfirmados |
| PDF longo e estados documentais | Implementado e testado | A4 com 50 itens longos; rascunho/revisão/pronto/assinado verificado/disponibilizado |
| Verificação de assinatura externa | Implementado e testado | PKI sintética: integridade, titular, cadeia configurada, revogação e bytes exatos; casos positivos/negativos |
| ICP-Brasil real | Depende de configuração | Certificado do médico, assinador compatível, raízes ITI e CRLs atuais; sem ensaio clínico real |
| Categorias sanitárias especiais/SNCR | Não implementado | Emissão final bloqueada para não classificados, RET, controlados e especiais |
| Interações/contraindicações/cálculo de doses | Não implementado | Interface declara verificação não realizada; sem base farmacológica nem cálculo implícito |
| Anexos privados | Implementado e testado | PDF/PNG/JPEG limitados, estrutura validada, cifragem e autorização |
| Antivírus | Não implementado | Validação estrutural não substitui detecção de malware |
| Organização literal e trabalho sem IA | Implementado e testado | Independentes de API; texto preservado |
| IA externa supervisionada | Depende de configuração | Credencial/modelo e tratamento de dados; desligada por padrão, propostas separadas |
| Exportação anonimizada | Implementado e testado | Remove identificadores conhecidos/padrões, preserva JSON; texto livre exige revisão humana |
| Falha de rede e concorrência | Implementado e testado | Navegador interrompe/reestabelece rede; conflito não sobrescreve texto |
| Texto não sincronizado após fechamento forçado/offline | Não implementado | Sem persistência clínica no navegador; texto nunca recebido no servidor pode ser perdido |
| Cifragem e auditoria sem narrativa clínica | Implementado e testado | Conteúdos/arquivos cifrados; eventos por IDs; não é trilha externa imutável |
| Backup/restauração | Implementado e testado | Snapshot, manifesto autenticado, hashes, dados/arquivos recuperados, corrupção recusada e sessões invalidadas |
| Backups remotos, guarda, monitoramento | Depende de configuração | Rotina, chave separada, cópia externa e exercícios periódicos |
| Hospedagem HTTPS/domínio | Depende de configuração | Nenhum servidor público foi provisionado |
| MFA/SSO/recuperação de senha/trilha externa imutável | Não implementado | Contas administradas por terminal, login com senha |
| Consentimentos separados | Implementado e testado | Privacidade, teleconsulta e autorizações específicas sem pré-seleção |
| Gravação/transcrição/vídeo incorporado | Não implementado | Captura desligada; autorização registrada não inicia gravação |
| Entrega privada | Implementado e testado | Bytes assinados idênticos no portal; revogação impede novos downloads, não recolhe cópias já baixadas |
| Agente e-mail/Calendly anterior | Depende de configuração | Serviço separado no PR #8; domínio/OAuth/Calendly/hospedagem pendentes |
| Ponte do prontuário ao agente | Não implementado | Não transmite dados clínicos ou libera documentos por automação |
| Workflow n8n de marketing | Não implementado | Não ativado nem conectado ao aplicativo |
| Comparação com HTML original | Não implementado | “Ficha Pré-Consulta.html” não foi disponibilizado |
| Validação médica/institucional de produção | Depende de configuração | Ensaios não substituem validação assistencial, documental e operacional |

Fontes e restrições: [assinatura e receituário](ASSINATURA_E_RECEITUARIO.md). Não foram inventados RQE, contato, endereço, credencial ou certificação.
