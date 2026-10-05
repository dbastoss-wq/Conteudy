---
name: notas-aula-residencia
description: Transforma a transcrição de uma aula de medicina (Eu Médico Residente, Medcel, Estratégia MED, Medway, Sanar ou qualquer cursinho) em notas de estudo para prova de residência médica, com resumo por tópicos na ordem da aula, ⭐ nos temas mais cobrados, tabelas de classificações, critérios, diferenciais e condutas/doses, ⚠️ onde a aula diverge das diretrizes atuais, mnemônicos, top 10 pontos, 5 questões comentadas e roteiro de videoaula-resumo. Use sempre que o usuário colar ou anexar uma transcrição, legenda (.srt/.vtt), PDF ou anotações de aula e pedir resumo, notas, revisão ou material para estudar para a residência, mesmo que não cite a prova.
---

# Notas de aula para prova de residência

Reescreva a transcrição como um residente R1/R2 estudando para a prova: direto, organizado, sem enrolação e com foco no que cai. O resultado substitui a aula na revisão, então precisa trazer todo o conteúdo técnico dela, não só os destaques.

## Antes de escrever

1. **Leia a transcrição inteira.** Identifique o tema, a especialidade e a sequência de tópicos que o professor seguiu.
2. **Limpe a transcrição mentalmente.** Ignore vinhetas, avisos, piadas e repetições. Corrija erros de reconhecimento de voz pelo contexto (por exemplo "a mox cilina" vira amoxicilina, "e ca gê" vira ECG). Se um trecho estiver ambíguo e afetar uma dose ou um critério, marque `[trecho inaudível/ambíguo na transcrição]` em vez de inventar.
3. **Confira as diretrizes atuais** para cada recomendação de conduta, dose, ponto de corte ou classificação. Se houver busca na web, use-a para checar a versão mais recente da diretriz (SBC, SBP, FEBRASGO, SBEM, SBPT, Ministério da Saúde/PCDT, AHA/ACC, ESC, ADA, GOLD, GINA, KDIGO, IDSA, Surviving Sepsis, etc.). Sem busca, use seu conhecimento e deixe claro o ano da diretriz citada.

## Estrutura da saída

Use exatamente estas seções, nesta ordem, em Markdown.

### Cabeçalho
`# <Tema da aula>`, seguido de uma linha com especialidade, professor/curso (se citado) e as diretrizes de referência usadas na checagem.

### 1. Resumo completo por tópicos
- Siga **a ordem da aula**. Cada tópico do professor vira um `##`, com subtópicos em `###` quando fizer sentido.
- Bullets curtos e densos: definição, epidemiologia, fisiopatologia (só o que explica a clínica ou a conduta), quadro clínico, diagnóstico, tratamento, complicações, prognóstico.
- Preserve números, pontos de corte, doses e "pegadinhas" que o professor disser.
- Quando o professor citar uma questão de prova ("isso caiu na USP 2023"), registre a instituição e o ano.

### 2. Destaques ⭐
Coloque ⭐ no início do bullet ou da linha de tabela que mais cai em prova de residência. Critérios:
- o professor disse que cai muito, que é clássico ou que é pegadinha;
- conduta de primeira linha, exame padrão-ouro ou exame inicial;
- critérios diagnósticos, classificações e pontos de corte;
- "qual o próximo passo", contraindicações e exceções.

Use ⭐⭐ para os pouquíssimos pontos que são praticamente certeza de questão. Não banalize: se tudo tem estrela, nada tem.

### 3. Tabelas
Sempre que houver comparação ou lista estruturada, use tabela no lugar de texto corrido, dentro do tópico correspondente:
- **Classificações** (estágios, graus, escores), com colunas para critério e implicação ou conduta.
- **Critérios diagnósticos**, separando maiores/menores ou obrigatórios/de suporte quando existirem.
- **Diagnósticos diferenciais**: doença | dado-chave que diferencia | exame que confirma.
- **Condutas e doses**: situação | droga | dose adulto (e pediátrica, se houver) | via | duração | observação ou contraindicação.

Doses sempre com unidade, via e intervalo. Se a aula não deu a dose e ela é cobrada, complete com a dose da diretriz e indique `(dose da diretriz, não citada na aula)`.

### 4. Divergências com diretrizes ⚠️
Marque com ⚠️ no próprio ponto do resumo e repita numa tabela no fim desta seção:

| Ponto | O que a aula disse | Diretriz atual (fonte, ano) | Para a prova |
|---|---|---|---|

Na coluna "Para a prova", diga qual resposta tende a ser aceita. Bancas costumam cobrar a diretriz vigente no ano do edital, mas algumas cobram a referência clássica; diga quando houver controvérsia. Marque também aulas desatualizadas por mudança recente de diretriz, por exemplo um novo ponto de corte ou uma droga que deixou de ser primeira linha. Se não houver nenhuma divergência, escreva isso explicitamente.

### 5. Mnemônicos 🧠
Use mnemônicos onde de fato ajudam a decorar listas, critérios ou sequências. Prefira os consagrados (cite-os como tais) e, se criar um novo, deixe-o em português e fácil de pronunciar. Coloque cada mnemônico logo após o conteúdo a que se refere, num bloco `> 🧠 **Mnemônico:** ...`. Não force mnemônico em tópico que não precisa.

### 6. Fechamento

#### 🔟 Os 10 pontos mais cobrados
Lista numerada, uma ou duas linhas cada, em ordem de importância para a prova.

#### 📝 5 questões estilo residência
- Formato de prova brasileira: caso clínico curto (idade, sexo, queixa, exame físico e exames relevantes), enunciado e alternativas **A a E**.
- Varie o tipo: diagnóstico, próximo passo/conduta, exame padrão-ouro, classificação/estadiamento e uma pegadinha.
- Pelo menos uma questão deve explorar um ponto ⚠️ ou uma exceção.
- Distratores plausíveis, sem "todas as anteriores".
- Coloque **todas as questões primeiro** e o **gabarito comentado depois**, sob um título próprio, para que o aluno possa responder antes de ver as respostas. No comentário, explique por que a correta está certa e por que cada distrator está errado, em uma linha cada.

#### 🎬 Videoaula-resumo
Escreva um **roteiro de videoaula-resumo de 5 a 7 minutos** para revisar o tema na véspera da prova:
- tabela `Tempo | Fala (narração) | Na tela`, em blocos de cerca de 30 a 60 s;
- abertura com o gancho "o que a banca quer de você neste tema", depois os pontos ⭐ na ordem lógica, os mnemônicos, as divergências ⚠️ e um fechamento com 3 frases-chave;
- linguagem falada, frases curtas, como um professor revisando com o aluno.

Se o usuário tiver ferramentas de vídeo ou de slides conectadas e pedir o vídeo de fato, ofereça gerar a partir do roteiro. Caso contrário, entregue só o roteiro.

## Estilo
- Português do Brasil, termos técnicos corretos e siglas expandidas na primeira vez.
- Negrito em palavras-chave, mas com moderação.
- Não acrescente conteúdo de outros temas que a aula não tratou, exceto para corrigir (⚠️) ou completar doses e critérios cobrados, sempre sinalizando.
- Se a transcrição vier incompleta ou cortada, diga onde ela termina e não invente o resto.
- Se a transcrição for muito longa, mantenha a estrutura completa. Prefira condensar a prosa a cortar tópicos.

## Aviso final
Termine com uma linha em itálico: *Material de estudo gerado a partir da transcrição da aula; confira doses e condutas na diretriz vigente antes de aplicar na prática clínica.*
