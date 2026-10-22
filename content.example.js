/* Conteúdo da teleconsulta — fonte: Teleconsulta_[Nome]___22_10_2026.md
 *
 * Tipos de bloco:
 *  h3      subtítulo
 *  p       parágrafo        (**negrito** e [[tel:NUM|rótulo]] são suportados)
 *  say     fala sugerida (cartão)
 *  check   caixas de marcar        items: [[id, texto]]
 *  kv      tabela Dado/Valor       rows: [rótulo, valor]  valor null = campo editável,
 *                                  {t:texto, e:id} = texto + campo editável
 *  table   tabela estática         rows: [[...]] ; ranges (opcional) liga linhas ao cronômetro
 *  fields  tabela com campos       rows: [id, rótulo, tipo, opções]  tipo: text | sr | select | number
 *  draft   rascunho editável       id, label, text
 */

const META = {
  titulo: 'Teleconsulta — modelo',
  sub: '',
  nome: 'Nome do Paciente',
  idade: 'XX anos',
  alergia: 'NENHUMA INFORMADA',
  data: 'dd/mm/aaaa',
  psicNome: 'Nome do psicólogo (psicólogo)',
  psicTel: '+5500000000000',
  psicTelLabel: '+55 00 00000-0000',
  psicTelCurto: '(00) 00000-0000',
};

const STAGES = [
  [0, 3, 'Abertura com responsável'],
  [3, 18, 'A sós com ele'],
  [18, 20, 'Estratificação'],
  [20, 27, 'Com o responsável'],
  [27, 30, 'Fechamento'],
];

const SECTIONS = [
  {
    id: 's0', nav: 'Paciente', num: '•', title: 'Paciente e alertas',
    blocks: [
      { t: 'p', text: 'Ponto de partida: **risco no mínimo moderado**, mesmo que o paciente negue tudo hoje. A ficha negativa não anula o relato do psicólogo. Digite nas células em branco das tabelas e marque as caixas.' },
      { t: 'kv', head: ['Dado', 'Valor'], rows: [
        ['Paciente', 'Nome do Paciente, XX anos (DN dd/mm/aaaa; faz 18 em dd/mm/aaaa)'],
        ['CPF / CNS', '000.000.000-00 / 000 0000 0000 0000'],
        ['Contato', 'WhatsApp [[tel:+5500000000000|+55 00 00000-0000]] · email@exemplo.com'],
        ['Endereço', 'Rua Exemplo, 000, CEP 00000-000'],
        ['Município (confirmar)', null, 'municipio'],
        ['Escola / trabalho (confirmar)', { t: 'Ficha: "(conforme ficha)"', e: 'escola' }],
        ['**Alergia**', { t: '**Alergia** (qual reação?)', e: 'alergia_reacao' }],
        ['Medicações', 'Nega uso'],
        ['Psicólogo', 'Nome do psicólogo, desde mm/aaaa · [[tel:+5500000000000|+55 00 00000-0000]]'],
        ['Consulta', 'Teleconsulta Zoom, 30 min · R$ 70 (social) · Pix pix@exemplo.com'],
      ] },
      { t: 'p', text: '**O que o psicólogo relatou e a ficha não mostra:** (preencher com o relato do encaminhante e as divergências em relação à ficha).' },
      { t: 'h3', text: 'Mapa dos 30 minutos' },
      { t: 'table', head: ['Tempo', 'Etapa', 'Não pode faltar'], ranges: [[0, 3], [3, 18], [18, 20], [20, 27], [27, 30], [30, 1e9]], rows: [
        ['0–3', 'Abertura com responsável', 'Endereço atual, consentimento, limites do sigilo'],
        ['3–18', 'A sós com ele', 'Queixa, ASQ / C-SSRS, tentativa prévia, autolesão, trauma, CRAFFT'],
        ['18–20', 'Estratificação', 'Iminente: SAMU 192, a consulta para aqui'],
        ['20–27', 'Com o responsável', 'Restrição de meios, plano de segurança, notificação, CAPS IJ'],
        ['27–30', 'Fechamento', 'Retorno em poucos dias, presencial para feridas, devolutiva'],
        ['Depois', 'Registro', 'Prontuário, SINAN em até 24 h, Conselho Tutelar'],
      ] },
      { t: 'h3', text: 'Antes de abrir o Zoom' },
      { t: 'check', items: [
        ['z1', 'Telefone de um responsável que esteja fisicamente perto dele'],
        ['z2', 'Telefone alternativo se a conexão cair'],
        ['z3', 'TCLE de telemedicina enviado ao responsável'],
        ['z4', 'Pagamento respondido (de preferência com o responsável)'],
      ] },
      { t: 'fields', head: ['Contato útil', 'Endereço / telefone'], rows: [
        ['ct_ps', 'PS / UPA mais próximo'],
        ['ct_caps', 'CAPS IJ do território'],
        ['ct_uvis', 'Vigilância epidemiológica / UVIS'],
        ['ct_ct', 'Conselho Tutelar'],
      ] },
    ],
  },

  {
    id: 's1', nav: 'Abertura', num: '1', title: '1. Abertura com o responsável (0–3 min)',
    blocks: [
      { t: 'p', text: 'Começar com os dois juntos, depois conversar a sós com ele; o responsável volta no fim.' },
      { t: 'check', items: [
        ['a1', 'Apresentou-se como médico (não como psiquiatra)'],
        ['a2', '**Confirmou o endereço exato onde ele está agora**'],
        ['a3', '**Consentimento do responsável e assentimento dele** para a teleconsulta'],
        ['a4', 'Explicou os limites da teleconsulta (pode precisar de avaliação presencial)'],
        ['a5', 'Gravação só com consentimento dos dois'],
        ['a6', '**Explicou o sigilo e os limites** (risco à vida ou alguém te machucando)'],
        ['a7', 'Ele em lugar reservado, de fone, para a parte a sós'],
      ] },
      { t: 'fields', head: ['Campo', 'Anotação'], rows: [
        ['resp', 'Responsável presente / parentesco'],
        ['resp_tel', 'Telefone do responsável'],
        ['endereco', 'Endereço onde ele está agora'],
      ] },
      { t: 'say', text: '"[Nome], o que você me contar fica entre a gente. Só tem duas exceções: se eu ficar preocupado com risco para a sua vida, ou se alguém estiver te machucando. Aí eu preciso envolver seus pais, mas te aviso antes e a gente combina como."' },
    ],
  },

  {
    id: 's2', nav: 'A sós', num: '2', title: '2. A sós com ele (3–18 min)',
    blocks: [
      { t: 'h3', text: 'Queixa e HDA' },
      { t: 'say', text: '"O [Psicólogo] me contou um pouco, mas quero ouvir de você. Você deu nota 4 para as últimas duas semanas: o que mais pesou?"' },
      { t: 'fields', head: ['Tópico', 'Anotação'], rows: [
        ['q_queixa', 'Queixa nas palavras dele'],
        ['q_estressor', 'Estressor recente no trabalho e o que segurou o impulso'],
        ['q_phq2', 'PHQ-2: pouco interesse/prazer? triste ou sem esperança?'],
        ['q_apetite', 'Apetite e peso (atual / habitual / em quanto tempo)'],
        ['q_sono', 'Sono real, celular à noite'],
        ['q_vazio', 'Vazio, irritabilidade, explosões, angústia'],
      ] },

      { t: 'h3', text: 'Risco de suicídio' },
      { t: 'say', text: '"Muita gente preenche o formulário de um jeito e, conversando, conta outra coisa, está tudo bem. Desde aquele problema no trabalho, você se cortou ou pensou em se machucar?"' },
      { t: 'p', text: 'ASQ: "sim" ou recusa em qualquer item = positivo. Na coluna Resposta, digite S, N ou Recusou.' },
      { t: 'fields', head: ['Pergunta', 'Resposta'], rows: [
        ['asq1', '1. Nas últimas semanas, desejou estar morto?', 'sr'],
        ['asq2', '2. Sentiu que você ou sua família estariam melhor se você estivesse morto?', 'sr'],
        ['asq3', '3. Na última semana, pensou em se matar?', 'sr'],
        ['asq4', '4. Já tentou se matar? Como? Quando?', 'sr'],
        ['asq5', '**5. Se algum sim: está pensando em se matar agora?** (sim = risco agudo, ir à seção 3)', 'sr'],
        ['cs1', 'C-SSRS: pensou em como faria?', 'sr'],
        ['cs2', 'C-SSRS: teve intenção de agir?', 'sr'],
        ['cs3', 'C-SSRS: começou a planejar os detalhes?', 'sr'],
        ['cs4', 'C-SSRS: nos últimos 3 meses, se preparou ou começou algo (juntou remédios, despedida)?', 'sr'],
      ] },
      { t: 'asqbadge' },
      { t: 'fields', head: ['Tentativa prévia', 'Anotação'], rows: [
        ['tp1', 'Quando / idade'],
        ['tp2', 'O que tomou, quantos, de quem era'],
        ['tp3', 'Desencadeante; queria morrer?'],
        ['tp4', 'PS, lavagem, internação? Pais souberam? Notificado?'],
        ['tp5', '**Onde ficam os remédios da casa hoje** (inclusive paracetamol)'],
        ['tp6', '**Arma de fogo em casa ou com parentes**'],
        ['tp7', 'Fatores de proteção / motivo para viver'],
      ] },

      { t: 'h3', text: 'Autolesão e inspeção' },
      { t: 'p', text: 'Por vídeo, só antebraços e braços. **Coxas apenas presencial** (menor de idade).' },
      { t: 'fields', head: ['Tópico', 'Anotação'], rows: [
        ['al1', 'Início, método, locais, frequência, último episódio'],
        ['al2', 'Função (alívio, punição, sentir algo) e gatilhos'],
        ['al3', 'Já foi mais fundo que queria / precisou de pontos?'],
        ['al4', 'Redes sociais: conteúdo de autolesão, uso à noite'],
        ['al5', 'Ferida aberta? Sinais de infecção? Última dT?'],
      ] },

      { t: 'h3', text: 'Trauma e rastreio rápido' },
      { t: 'p', text: 'O [Psicólogo] já contextualizou: ele não precisa repetir detalhes.' },
      { t: 'fields', head: ['Tópico', 'Anotação'], rows: [
        ['tr1', '**Ainda tem contato com o suposto agressor?** Houve contato físico?'],
        ['tr2', 'TEPT: pesadelos, intrusões, evitação'],
        ['tr3', 'Trabalho: jornada, vínculo, regular para a idade?'],
        ['tr4', 'Outra violência, inclusive online'],
        ['tr5', 'Bipolaridade: dias de euforia com pouca necessidade de sono? (afastar antes de ISRS)'],
        ['tr6', 'TDAH, transtorno alimentar, psicose ou dissociação'],
        ['tr7', 'Cigarro / vape / álcool / maconha / remédio sem receita'],
        ['crafft', 'CRAFFT (C, R, A, F, F, T): número de "sim" (2 ou mais = positivo)', 'number'],
        ['tr9', 'Traços borderline observados (abandono, relações, identidade, impulsividade, labilidade, vazio, raiva)'],
      ] },
    ],
  },

  {
    id: 's3', nav: 'Risco', num: '3', title: '3. Risco, família e plano de segurança (18–27 min)',
    blocks: [
      { t: 'h3', text: 'Estratificação' },
      { t: 'table', head: ['Nível', 'Quando', 'Conduta'], rows: [
        ['Iminente / alto', 'ASQ 5 positivo, plano ou intenção, preparação, não se compromete', '**Não encerrar a chamada.** Responsável junto, **SAMU 192** no endereço confirmado, ficar na linha'],
        ['Moderado (perfil provável)', 'Ideação sem plano, autolesão recorrente, tentativa prévia', 'Plano de segurança, restrição de meios, CAPS IJ em poucos dias, notificação, retorno em dias'],
        ['Baixo', 'Sem ideação atual, boa proteção', 'Plano, psicólogo + CAPS IJ, retorno programado'],
      ] },
      { t: 'fields', head: ['Decisão', 'Anotação'], rows: [
        ['risco', 'Nível de risco escolhido', 'select', ['Iminente / alto', 'Moderado', 'Baixo']],
        ['risco_just', 'Justificativa (registrar ficha e relato do psicólogo)'],
      ] },

      { t: 'h3', text: 'Com o responsável' },
      { t: 'check', items: [
        ['r1', 'Antes, combinou com ele o que será contado'],
        ['r2', '**Explicou que tentativa + autolesão é sério e tratável**, não frescura'],
        ['r3', '**Todos os remédios da casa trancados ou descartados** (inclusive paracetamol); um adulto entrega a dose'],
        ['r4', '**Arma de fogo fora de casa**'],
        ['r5', 'Lâminas e estiletes recolhidos'],
        ['r6', 'Sinais de alarme: SAMU 192 ou PS; CVV 188; CAPS IJ recebe em crise sem encaminhamento'],
        ['r7', 'Responsável repetiu o que fazer'],
      ] },
      { t: 'say', text: '"O [Nome] já tentou tirar a própria vida uma vez com remédios e ainda se machuca quando a dor fica grande demais. Isso é sério e tem tratamento. A parte de vocês agora é deixar a casa segura e ficar por perto."' },
      { t: 'fields', head: ['Tópico', 'Anotação'], rows: [
        ['fam1', 'Dinâmica familiar, papel de irmãos, invalidação'],
        ['fam2', 'Quem tranca os remédios / quem guarda a chave'],
      ] },

      { t: 'h3', text: 'Plano de segurança (Stanley-Brown)' },
      { t: 'p', text: 'Preencher com as palavras dele e mandar cópia para ele e o responsável. Não indicar elástico, gelo ou "desenhar na pele": sem evidência e podem virar nova forma de se ferir.' },
      { t: 'fields', head: ['Passo', 'Plano dele'], rows: [
        ['ps1', '1. Sinais de alerta'],
        ['ps2', '2. O que fazer sozinho (adiar 10–15 min, sair do quarto, exercício, música, escrever)'],
        ['ps3', '3. Pessoas e lugares que distraem'],
        ['ps4', '4. Pessoas para pedir ajuda (nome e telefone)'],
        ['ps5', '5. Profissionais: [Psicólogo] [[tel:+5500000000000|(00) 00000-0000]], Dr(a). [Nome], CAPS IJ, [[tel:188|CVV 188]], [[tel:192|SAMU 192]]'],
        ['ps6', '6. Ambiente seguro (o que sai de perto, quem guarda)'],
        ['ps_motivo', 'Motivo para viver'],
      ] },
      { t: 'check', items: [['ps_env', 'Cópia do plano enviada']] },
      { t: 'actions', buttons: [['plano', 'Gerar plano de segurança']] },
    ],
  },

  {
    id: 's4', nav: 'Conduta', num: '4', title: '4. Conduta e registro (27–30 min e depois)',
    blocks: [
      { t: 'h3', text: 'Exame do estado mental' },
      { t: 'fields', head: ['Domínio', 'Achado'], rows: [
        ['e1', 'Consciência, orientação, aparência'],
        ['e2', 'Contato e discurso'],
        ['e3', 'Humor e afeto'],
        ['e4', 'Pensamento (desesperança, ruminação)'],
        ['e5', 'Sensopercepção'],
        ['e6', 'Ideação suicida hoje (negada / passiva / ativa)', 'select', ['Negada', 'Passiva', 'Ativa']],
        ['e7', 'Juízo crítico e insight'],
        ['e8', 'História familiar (depressão, bipolar, suicídio, substâncias)'],
      ] },

      { t: 'h3', text: 'Hipóteses (CID-10)' },
      { t: 'check', items: [
        ['h1', 'Z91.5 História pessoal de lesão autoprovocada'],
        ['h2', 'R45.8 Ideação suicida'],
        ['h3', 'F32.1 / F32.2 Episódio depressivo moderado / grave'],
        ['h4', 'F43.1 / F43.2 TEPT / transtorno de adaptação'],
        ['h5', 'Características borderline em investigação (F60.3 só como hipótese)'],
      ] },

      { t: 'h3', text: 'Farmacoterapia' },
      { t: 'p', text: 'Nenhum remédio trata o borderline nem reduz autolesão; o tratamento é psicoterapia (DBT-A, MBT-A). ISRS só se houver **depressão moderada/grave** e bipolar afastado. No Brasil é **off-label abaixo de 18 anos**: registrar justificativa, consentimento do responsável e assentimento dele. Com a tentativa por superdosagem, o mais seguro é não iniciar hoje sem seguimento garantido.' },
      { t: 'table', head: ['Fármaco', 'Início (13–XX anos)', 'Faixa', 'Observação'], rows: [
        ['Fluoxetina (1ª escolha)', '10 mg por 1 semana, depois 20 mg', '20–40 mg', 'Mais evidência em adolescentes'],
        ['Sertralina', '**50 mg**', '50–200 mg', '25 mg é a dose de 6–12 anos'],
        ['Escitalopram', '**10 mg**', '10–20 mg', 'Subir só após 3 semanas ou mais'],
      ] },
      { t: 'check', items: [
        ['f1', 'Receita C1 em quantidade pequena (2–4 semanas); pais guardam e entregam a dose'],
        ['f2', 'Alerta de suicidalidade explicado; contato semanal no 1º mês'],
        ['f3', 'Evitar benzodiazepínicos, tricíclicos, venlafaxina e lítio'],
        ['f4', 'Dor das feridas: ibuprofeno; sem dipirona se houver alergia; paracetamol trancado'],
      ] },
      { t: 'fields', head: ['Decisão', 'Anotação'], rows: [
        ['d_rx', 'Prescrição ou "sem medicação hoje"'],
        ['d_exames', 'Exames (hemograma, TSH, T4L, glicemia, creatinina, TGO/TGP)'],
        ['d_pres', 'Presencial: feridas/coxas, dT, HPV, meningo ACWY, hepatite B'],
      ] },

      { t: 'h3', text: 'Notificação e rede' },
      { t: 'p', text: 'Tentativa de suicídio e violência sexual: notificação imediata (até 24 h). Em adolescente, o Conselho Tutelar também recebe (Lei 13.819/2019; ECA arts. 13 e 245).' },
      { t: 'say', text: '"Vou fazer uma notificação para a vigilância de saúde e para o Conselho Tutelar. Não é denúncia de polícia: é um registro sigiloso para proteger o [Nome]."' },
      { t: 'check', items: [
        ['n1', 'Ficha SINAN (autolesão/tentativa + violência sexual pelo suposto agressor)'],
        ['n2', 'Enviada à vigilância/UVIS do município'],
        ['n3', 'Comunicação ao Conselho Tutelar'],
        ['n4', 'Família orientada a ir pessoalmente ao CAPS IJ com o relatório'],
        ['n5', 'Autorização para falar com o [Psicólogo]'],
        ['n6', 'Retorno em poucos dias marcado'],
      ] },
      { t: 'fields', head: ['Registro', 'Anotação'], rows: [
        ['rg1', 'Data do retorno / modalidade'],
        ['rg2', 'Protocolos SINAN e Conselho Tutelar'],
        ['rg3', 'Resumo S/O/A/P'],
        ['rg4', 'O que ficou para o retorno'],
      ] },
      { t: 'actions', buttons: [['prontuario', 'Gerar prontuário']] },

      { t: 'h3', text: 'Rascunhos para enviar' },
      { t: 'draft', id: 'draft_caps', label: '**Relatório ao CAPS IJ:**',
        text: 'Encaminho Nome do Paciente, XX anos (DN dd/mm/aaaa), CNS 000 0000 0000 0000, avaliado por teleconsulta em dd/mm/aaaa e encaminhado pelo psicólogo. Apresenta [síntese clínica]. Risco atual: ____. Família com recursos limitados. Solicito acolhimento e avaliação prioritária. Plano de segurança, restrição de meios, notificação SINAN e comunicação ao Conselho Tutelar realizados. Dr(a). [Nome], CRM-[UF] [número].' },
      { t: 'draft', id: 'draft_gus', label: '**Devolutiva ao [Psicólogo]:**',
        text: 'Olá, [Psicólogo]! Avaliei o [Nome] hoje, obrigado pelo encaminhamento. Impressão: ____. Risco atual: ____. Fizemos plano de segurança e orientei os pais a trancar os remédios e recolher lâminas. Fiz relatório para o CAPS IJ e a notificação obrigatória. Medicação: ____. Retorno em ____. Me avise se perceber qualquer piora. Abraço!' },
    ],
  },
];
