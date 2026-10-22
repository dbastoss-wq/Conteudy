# Área de teleconsulta em psiquiatria

O agente atende por e-mail **somente a parte administrativa** da teleconsulta psiquiátrica: como funciona, agendamento, reagendamento, cancelamento, valores, convênios e reembolso que estejam na base, termo de consentimento e orientações. Ele **nunca** faz atendimento clínico: não faz triagem, não comenta sintomas, não fala de medicamentos e não promete receita, atestado, laudo ou relatório.

A área fica desligada até a clínica concluir o checklist do fim deste documento (`psiquiatria.enabled: false`). O **protocolo de risco vale em qualquer área**, desde que `psiquiatria.termos_risco` esteja preenchido.

## Fluxo de risco

```
Normalizar a mensagem
  └─ detectRisk(assunto + corpo, psiquiatria.termos_risco)       src/risk.js
       │
       ├─ tentativas esgotadas + risco → alerta urgente mesmo assim (mesma chave, sem duplicar)
       │
Filtros (src/filters.js)
  ├─ resposta automática, lista, bounce, próprio agente → ignorar (mesmo com termo de risco: evita loop)
  ├─ risco possível/alto → NÃO chama a IA
  │     passa por cima de: limites anti-ciclo, remetente interno, SPAM/Promoções, conversa já com humano
  │     ├─ alerta urgente → psiquiatria.contato_clinico_urgente (+ contato_clinico + alert_email)
  │     │     assunto neutro, link da conversa, motivo e horário. NÃO copia o conteúdo.
  │     │     chave <mensagem>:alerta_risco — sem a janela de 1 hora; cada mensagem gera o seu alerta
  │     ├─ modelo fixo ao remetente (config/templates/risco*.md) — nunca texto da IA
  │     │     não enviado a remetente interno; no máximo 1 por conversa a cada 24 h
  │     └─ conversa "escalada" + risk_level + rótulo agente-prioridade; action_log "alerta_risco"
  └─ sem risco → IA → política
        IA marca risk_level ≥ possível, ou intenção crise_ou_risco / violencia_ou_risco_terceiros /
        urgencia_medica → mesmo protocolo (vale o nível mais alto)
```

Se o alerta não for enviado, a mensagem fica `falhou` e volta no próximo ciclo; o alerta não é duplicado (chave por mensagem). Se a lista de termos não pegar a mensagem **e** a IA estiver fora do ar, o risco só é detectado quando a IA voltar. Por isso a clínica precisa de cobertura humana da caixa.

| Categoria | Modelo | Conteúdo mínimo |
|---|---|---|
| `crise` | `risco.md` | Acolhimento, CVV 188, SAMU 192, pronto-socorro, CAPS, "e-mail não é emergência" |
| `terceiros` | `risco_terceiros.md` | 190, SAMU 192, 180, Disque 100 |
| `urgencia` | `urgencia.md` | SAMU 192, pronto-socorro |

Sem modelo carregado, o sistema usa um texto de segurança equivalente embutido em `src/policy.js` (`FALLBACK`). A clínica deve carregar os modelos aprovados.

## Roteamento dos encaminhamentos

| Situação | Destino | Corpo do e-mail no encaminhamento |
|---|---|---|
| Risco | `contato_clinico_urgente` | não (só link) |
| Medicamento, sintoma, piora, exame, mudança de conduta (`duvida_clinica`) | `contato_clinico` | sim |
| Receita, atestado, laudo, relatório, declaração (`pedido_receita_ou_documento`) | `contato_clinico` | sim |
| Texto da IA com dose, CID, nome de remédio bloqueado ou promessa | `contato_clinico` | sim |
| Menor de idade (`politica_menores: encaminhar`) | `contato_clinico` | sim |
| Menor de idade (`pedir_responsavel`), fora do Brasil, preço fora da base, demais casos da área | `contato_administrativo` | **não** |
| Área geral | `escalation.contact_email` | sim |

Assuntos clínicos recebem só a confirmação curta `psiquiatria.ack_clinico`, que não comenta o conteúdo.

## Quando a conversa é da psiquiatria

Uma conversa passa a ser da psiquiatria quando: chega por um endereço de `psiquiatria.caixas`; o contato tem reserva num tipo de reunião com `area: "psiquiatria"`; ou a IA classifica `area: psiquiatria`. Depois disso, nunca volta para `geral` (`finish_message`).

## Configuração

Bloco `psiquiatria` em `config/agent.config.json` (modelo em `config/agent.config.example.json`):

| Campo | Uso |
|---|---|
| `enabled` | Liga as regras e o prompt da área. |
| `caixas` | Endereços/aliases que recebem e-mails da área. |
| `plataforma`, `termo_consentimento_url`, `orientacoes_url` | Inseridos pelo sistema. Os links também precisam estar em `allowed_url_prefixes` se a base os citar. |
| `medicos[]` | Nome, CRM/UF e RQE para a assinatura e a base. |
| `contato_clinico`, `contato_clinico_urgente`, `contato_administrativo` | Destinos dos encaminhamentos e alertas. |
| `termos_risco[]` | Texto simples (nível alto, categoria crise) ou `{ termo, nivel: alto/possivel, categoria: crise/terceiros/urgencia }`. `*` no fim aceita variações (`suicid*`). Acentos e maiúsculas são ignorados. |
| `termos_clinicos_bloqueados[]` | Nomes de medicamentos ou diagnósticos que a IA nunca pode escrever. Doses (`mg`), CID e promessas já são bloqueados no código. |
| `politica_menores` | `encaminhar` (equipe clínica) ou `pedir_responsavel` (secretaria). |
| `atende_exterior` | `false` encaminha à secretaria quem está fora do Brasil. |
| `ack_clinico`, `assinatura` | Textos da área. |
| `retencao_dias` | `null` = desligado. Com valor, o workflow 05 anonimiza (`[removido]`) o corpo das mensagens e envios da área mais antigos. |

Tipos de reunião ganham `area` e `exige_termo`. Com `exige_termo: true`, o link de agendamento vai acompanhado do termo e das orientações; sem esses links configurados, a mensagem é encaminhada.

Os modelos de `config/templates/*.md` são carregados pelo `seed-settings` em `agente.settings.templates`. Comentários `<!-- ... -->` são removidos antes do envio.

## Referências a confirmar (não é parecer jurídico)

Confirme a versão em vigor com o jurídico e o responsável técnico da clínica:

- Lei 14.510/2022 (telessaúde) e Resolução CFM 2.314/2022 (telemedicina): consentimento, prontuário, sigilo da plataforma, identificação do médico. O agente só envia o termo e as orientações; não substitui esses registros.
- Normas de publicidade médica do CFM: nome, CRM/UF e RQE; sem promessa de resultado.
- Portaria SVS/MS 344/1998 e normas da Anvisa (controlados): o agente não informa o que pode ser prescrito.
- LGPD, art. 11: dados de saúde são dados pessoais sensíveis.

## Privacidade (LGPD)

- O corpo dos e-mails não é gravado em `action_log` (verificado no teste do banco). Ele fica em `agente.messages.body_text` até a retenção anonimizar.
- Alertas de risco e encaminhamentos administrativos não copiam o conteúdo.
- Rótulos e assuntos são neutros (`agente-prioridade`, `[URGENTE] Mensagem que precisa de atenção clínica`); `utm_content` leva só o id da conversa.
- O resumo pedido à IA não traz detalhes clínicos.
- **IA externa:** o conteúdo dos e-mails que não caem na lista de termos de risco é enviado à API da Anthropic. Isso precisa constar da política de privacidade e do registro de operações de tratamento da clínica.
- **Pendente com o encarregado de dados (DPO):** prazo de retenção, base legal, política de privacidade.

## Responsabilidades da clínica

- Ter alguém de plantão lendo os alertas urgentes enquanto a área estiver ligada.
- **Pausar o agente pausa a detecção de risco.** Com o agente pausado ou fora do ar, a caixa precisa de cobertura humana.
- Manter a lista de termos de risco e os modelos revisados pela equipe clínica.

## Checklist antes de ligar a área

- [ ] A equipe clínica aprovou `termos_risco` e os modelos de `config/templates/`.
- [ ] Existe plantão definido para `contato_clinico_urgente`.
- [ ] O termo de consentimento foi revisado pelo jurídico.
- [ ] A plataforma de teleconsulta é adequada ao sigilo.
- [ ] A política de privacidade cita o uso de IA (Anthropic).
- [ ] Testes com caixa de teste e mensagens simuladas de risco (crise, terceiros, urgência, resposta automática com termo de risco).
- [ ] Revisão de 20 a 30 respostas reais antes do envio automático.
- [ ] `psiquiatria.enabled: true` e `seed-settings` executado.
