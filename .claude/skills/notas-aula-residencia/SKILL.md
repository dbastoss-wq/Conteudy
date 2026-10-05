---
name: notas-aula-residencia
description: Transforma a transcrição de uma aula de medicina (Eu Médico Residente, Medcel, Estratégia MED, Medway, Sanar ou qualquer cursinho) em notas de estudo para prova de residência médica, com resumo por tópicos na ordem da aula, ⭐ nos temas mais cobrados, tabelas de classificações, critérios, diferenciais e condutas/doses, ⚠️ onde a aula diverge das diretrizes atuais, mnemônicos, top 10 pontos, 5 questões comentadas em PDF e flashcards (pergunta | resposta). Use sempre que o usuário colar ou anexar uma transcrição, legenda (.srt/.vtt), PDF ou anotações de aula e pedir resumo, notas, revisão ou material para estudar para a residência, mesmo que não cite a prova.
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
- No gabarito comentado, explique por que a correta está certa e por que cada distrator está errado, em uma linha cada.

**Entregue as 5 questões em PDF**, com as questões primeiro e o gabarito comentado numa página separada, para o aluno responder antes de ver as respostas:
1. Salve as questões num JSON no formato descrito no topo de `scripts/questoes_pdf.py`: `tema`, `fonte` (opcional) e `questoes[]` com `enunciado`, `alternativas` (A–E), `gabarito`, `comentario` e `distratores` (opcional, um motivo por alternativa errada).
2. Rode `python3 <pasta-da-skill>/scripts/questoes_pdf.py questoes.json "Questoes - <tema>.pdf"`. Se faltar a biblioteca, instale antes com `pip install reportlab`.
3. Entregue o PDF ao usuário, que é o arquivo para baixar ou imprimir. No texto da resposta, deixe só os enunciados resumidos e diga que o gabarito está no PDF.

Se não for possível rodar Python, use a skill de PDF disponível ou, em último caso, mostre as questões em Markdown com o gabarito separado.

#### 🃏 Flashcards
Crie de **15 a 25 flashcards** numa tabela `| # | Pergunta | Resposta |`:
- um fato por cartão, com respostas curtas (uma linha, no máximo um número ou critério);
- priorize os pontos ⭐, pontos de corte, doses, critérios, padrão-ouro vs. exame inicial, exceções e as divergências ⚠️;
- perguntas diretas ("Qual o exame padrão-ouro para…?", "Dose de… na…?"), nunca "Fale sobre…";
- mantenha ⭐ na pergunta dos cartões mais cobrados.

Depois da tabela, ofereça os mesmos cartões em formato de importação para o Anki (`pergunta;resposta`, um por linha) num bloco de código.

## Estilo
- Português do Brasil, termos técnicos corretos e siglas expandidas na primeira vez.
- Negrito em palavras-chave, mas com moderação.
- Não acrescente conteúdo de outros temas que a aula não tratou, exceto para corrigir (⚠️) ou completar doses e critérios cobrados, sempre sinalizando.
- Se a transcrição vier incompleta ou cortada, diga onde ela termina e não invente o resto.
- Se a transcrição for muito longa, mantenha a estrutura completa. Prefira condensar a prosa a cortar tópicos.

## Aviso final
Termine com uma linha em itálico: *Material de estudo gerado a partir da transcrição da aula; confira doses e condutas na diretriz vigente antes de aplicar na prática clínica.*
