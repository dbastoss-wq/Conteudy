Grok, vamos ser justos: no X você é imbatível. Assunto do momento, meme do dia, resposta ácida em 3 segundos. Respeito.

Mas o Claude acabou de me entregar uma ferramenta clínica completa, funcionando, num único arquivo HTML. E eu quero saber se você consegue me surpreender fora do seu território.

## O DESAFIO

Crie um ÚNICO arquivo HTML (CSS e JS embutidos; bibliotecas só via CDN) com uma ficha de atendimento médico que faça TUDO abaixo. Sem esboço, sem "você pode completar depois". Arquivo inteiro, pronto para abrir no navegador.

### 1. Relato do paciente (3 etapas)
- Etapa Queixa: idade (validar de 0 a 120, com mensagem de erro), sexo (feminino, masculino, prefiro não informar), há quanto tempo, o que motivou a consulta (texto livre, nas palavras do paciente), onde sente, como é a sensação, intensidade de 0 a 10 que só conta se o paciente marcar "quero informar".
- Etapa Evolução: como começou (aos poucos, de repente, não sei), como está evoluindo (melhorando, piorando, sem mudança, vai e volta, não sei), o que acontecia quando começou, o que piora, o que alivia, outros sintomas, sintomas que o paciente nega, o que já tentou e como respondeu.
- Etapa Contexto: doenças e cirurgias prévias, medicamentos em uso, alergias, se já aconteceu antes (cada um com "não sei", "não" e "sim, vou informar", abrindo o campo de texto só no "sim") e o que espera da consulta.
- Navegação entre etapas com Voltar e Continuar, indicador da etapa atual e marcação das etapas concluídas.

### 2. Folha para o prontuário (atualiza ao vivo)
- QD com as palavras do paciente ENTRE ASPAS, seguida do tempo de evolução. Exemplo: “Dor nas costas que está atrapalhando o trabalho” há 5 dias.
- HPMA em NARRATIVA CLÍNICA corrida, na terceira pessoa. Nada de lista "Campo: valor".
- Conversão correta de primeira para terceira pessoa: "usei" vira "usou", "estou" vira "está", "minhas" vira "suas", "não consigo" vira "não consegue", e assim por diante. Sem quebrar substantivos como "o trabalho" ou "o uso".
- Maiúsculas certas: nada de "Fatores de piora: Inclinar…" no meio da frase.
- "Nega febre nem rigidez" tem que virar "Nega febre e rigidez".
- Antecedentes, medicações em uso, alergias e expectativa em linhas separadas.
- Opção "Destacar palavras do paciente", que marca em amarelo os trechos que vieram do relato, para o médico saber o que é fala do paciente.
- O bloco que mudou pisca de leve quando a folha se atualiza.
- Lista "A confirmar" que aponta SÓ o que realmente ficou faltando (idade, início, evolução, alergias etc.) e sempre lembra "Sinais de alarme pertinentes à queixa".
- Botão "Copiar evolução" com o texto completo. Se a área de transferência falhar, mostra o texto selecionado para copiar à mão.

### 3. Teleconsulta (preenchida pelo médico)
- Escolha entre teleconsulta e presencial. No modo presencial, somem os campos exclusivos da teleconsulta.
- Data, hora de início e de término (com botão "Agora"), plataforma, cidade/UF onde o paciente está e acompanhante.
- Campo para marcar o consentimento do paciente para a teleconsulta (Resolução CFM nº 2.314/2022). Se não for marcado, entra na lista "A confirmar".
- Sinais aferidos em casa com rótulos visíveis: PA, FC, temperatura, SpO2, glicemia e peso. Só os preenchidos entram no texto, com a unidade certa.
- Achados ao vídeo com botões de um toque ("Bom estado geral", "Lúcido e orientado", "Eupneico em ar ambiente", "Deambula sem auxílio"…) e um campo livre.
- Na folha: registro do atendimento ("Atendimento por teleconsulta em 21/10/2026, das 16:00 às 16:20, via Google Meet…") e exame físico remoto com a observação "Exame físico limitado pela modalidade remota".

### 4. Conduta e prescrição
- Hipótese diagnóstica, conduta, exames solicitados (um por linha) e retorno.
- Prescrição em itens, com botões para adicionar e remover: medicamento e apresentação, via (oral, tópico, sublingual, inalatório, nasal, oftálmico, otológico, retal, vaginal, intramuscular, subcutâneo), quantidade, posologia e marcação de antimicrobiano.
- Aviso de que medicamentos de controle especial exigem receituário próprio.
- Dados do consultório (nome, especialidade, CRM/UF, endereço, telefone, cidade), salvos no navegador e mantidos ao clicar em "Nova ficha".
- Nome e endereço do paciente para a receita.

### 5. Receituário
- Prévia com cabeçalho, paciente, endereço, data, itens agrupados por via ("USO ORAL"), quantidade alinhada à direita com linha pontilhada, posologia, orientações, retorno e linha de assinatura.
- Se houver antimicrobiano: idade e sexo do paciente e aviso de validade de 10 dias.
- Botão "Gerar PDF da receita": PDF A4 com acentos corretos, cidade e data por extenso ("São Paulo, 21 de outubro de 2026"), linha de assinatura com nome e CRM, e o aviso "Documento assinado digitalmente com certificado ICP-Brasil (MP nº 2.200-2/2001). Confira a assinatura em validar.iti.gov.br."
- Botão "PDF dos exames", que só aparece se houver exames: solicitação separada, com a indicação clínica.
- Instruções de assinatura com certificado em nuvem VIDaaS: VIDaaS Connect, Adobe Reader e confirmação no app.
- A lista "A confirmar" avisa se faltar algum dado obrigatório da receita.

### 6. Usabilidade
- Botões "Carregar exemplo" e "Nova ficha", com "Desfazer".
- No celular e em janela estreita (ao lado da videochamada): três abas, Atendimento, Folha e Receita, com contador de pendências. Sem rolagem para os lados.
- Modo claro e escuro automáticos.
- Acessível: rótulos em todos os campos e foco visível no teclado.
- Nenhum dado enviado para servidor: tudo fica no navegador.

## O TESTE (sem truque)

### Caso 1: carregue isto como exemplo
Idade 41, masculino, "há 5 dias", queixa "Dor nas costas que está atrapalhando o trabalho.", local "região lombar", sensação "dor em peso", intensidade 6, começou aos poucos, sem mudança, contexto "Depois de carregar caixas na mudança.", piora "Inclinar o corpo e ficar muito tempo em pé.", alivia "Repousar e usar compressa morna.", outros "Sensação de rigidez ao levantar.", nega "Febre e ardor ao urinar.", tentou "Compressa morna, com melhora parcial. Não usei medicamento para a queixa.", hipertensão, losartana 50 mg pela manhã, expectativa "Entender a causa da dor e como retomar minhas atividades."

A versão do Claude gera:
> Paciente do sexo masculino, 41 anos, procura atendimento por dor nas costas que está atrapalhando o trabalho. Quadro iniciado há 5 dias, de início gradual, após carregar caixas na mudança. Queixa localizada em região lombar, descrita como dor em peso, com intensidade 6/10. Desde o início, mantém-se estável. Piora ao inclinar o corpo e ficar muito tempo em pé; melhora ao repousar e usar compressa morna. Refere ainda sensação de rigidez ao levantar. Nega febre e ardor ao urinar. Já utilizou compressa morna, com melhora parcial. Não usou medicamento para a queixa.

Expectativa: "Entender a causa da dor e como retomar suas atividades."

### Caso 2: relato todo em primeira pessoa
- Queixa: "Estou com dor de cabeça forte e não consigo trabalhar."
- Há quanto tempo: "3 dias"
- Contexto: "Comecei a sentir depois que fiquei muito tempo no computador."
- Onde: "na testa e atrás dos olhos" · Sensação: "latejante"
- Piora: "A luz e o barulho" · Alivia: "Quando eu deito no escuro"
- Sentiu mais: "Tive enjoo e vomitei uma vez."
- Nega: "Não tenho febre nem rigidez no pescoço"
- Tentou: "Tomei dipirona e melhorou um pouco."

A versão do Claude gera:
> Paciente procura atendimento pois está com dor de cabeça forte e não consegue trabalhar. Quadro iniciado há 3 dias. Relata que começou a sentir depois que ficou muito tempo no computador. Queixa localizada na testa e atrás dos olhos, descrita como latejante. Piora com a luz e o barulho; melhora quando deita no escuro. Refere ainda que teve enjoo e vomitou uma vez. Nega febre e rigidez no pescoço. Tomou dipirona e melhorou um pouco.

## COMO VOU JULGAR
1. O arquivo roda de primeira, sem eu consertar nada? Nenhum erro no console?
2. Os dois casos saem em português clínico de verdade, sem "Não usei", "minhas atividades" ou "Nega febre nem" vazando?
3. Todos os itens das seções 1 a 6 estão lá e funcionando? Vou conferir um por um.
4. O PDF da receita sai certo, com acentos, campos obrigatórios e paginação?
5. Funciona no celular com as três abas e no modo escuro?
6. O que você fez que eu NÃO pedi e que me surpreendeu de verdade?

Placar justo: quem entregar mais itens funcionando ganha. Empate desempata pela HPMA mais bem escrita.

E aí, Grok, consegue me surpreender? 😏
