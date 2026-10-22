---
name: relato-para-hpma
description: Transforma o relato de um paciente (texto em primeira pessoa, mensagem de WhatsApp, áudio transcrito, respostas de formulário ou anotações soltas do médico) em anamnese pronta para o prontuário — QD com as palavras do paciente, HPMA em narrativa clínica na terceira pessoa, antecedentes, medicações, alergias e uma lista do que falta confirmar na consulta. Use sempre que o usuário colar um relato de paciente e pedir HPMA, anamnese, evolução, "passa pro prontuário", "organiza esse relato", "escreve a história clínica" ou similar, inclusive em teleconsulta, mesmo que ele não use a palavra HPMA.
---

# Relato do paciente → QD e HPMA

O médico cola o que o paciente contou e quer de volta um texto que possa colar no prontuário sem retrabalho. O valor está em três coisas: **fidelidade** (nada inventado, nada perdido), **linguagem clínica de verdade** (narrativa na terceira pessoa, não uma lista "Campo: valor") e **mostrar o que falta** antes da consulta.

## Antes de escrever

1. Leia o relato inteiro e separe os fatos: queixa, tempo, início, localização, característica, intensidade, evolução, contexto de início, fatores de piora e melhora, sintomas associados, sintomas negados, o que já tentou e a resposta, antecedentes, medicações, alergias, hábitos, episódios prévios, expectativa.
2. Distinga **"nega"** de **"não informado"**. "Nega febre" só quando o paciente disse que não teve febre. Se ele não falou de febre, isso vai para "A confirmar", nunca para a HPMA. Trocar um pelo outro muda a conduta de quem lê.
3. Se o usuário mencionar teleconsulta (ou mandar dados como plataforma, horário, consentimento, sinais medidos em casa), inclua o bloco de registro da teleconsulta descrito abaixo.

## Como escrever

- **QD**: as palavras do próprio paciente, entre aspas, seguidas do tempo de evolução. Ex.: QD: “Dor nas costas que está atrapalhando o trabalho” há 5 dias. É a convenção do prontuário e preserva a fala original.
- **HPMA**: narrativa corrida, terceira pessoa, ordem cronológica, verbos de anamnese (refere, relata, nega, informa, procura atendimento por). Uma frase por bloco de informação, sem rótulos no meio do texto.
  - Converta a pessoa do verbo e os possessivos: "usei" → "usou", "não consigo" → "não consegue", "minhas atividades" → "suas atividades". Revise no final procurando qualquer primeira pessoa que tenha sobrado, porque é o erro mais comum e o que mais denuncia texto mal convertido.
  - Mantenha os descritores do paciente quando forem clinicamente úteis ("em pontada", "em peso", "latejante"). Pode usar o termo técnico equivalente quando não houver perda de sentido (vômito → êmese é opcional; "falta de ar" → dispneia é aceitável).
  - Datas e horários relativos ("ontem", "sexta") viram tempo de evolução ("há 2 dias") só se a data de hoje for conhecida; senão mantenha como o paciente disse.
  - Números, doses, horários e nomes de remédio são copiados exatamente. Antes de entregar, confira cada um contra o relato original, um por um. Um horário ou uma dose trocados é o tipo de erro que o médico não perdoa, e é fácil de evitar com essa checagem.
- **Não diagnostique** e não sugira conduta, a menos que o usuário peça. A HPMA descreve; quem interpreta é o médico.
- Se o relato for ambíguo (ex.: "tomei remédio pra dor" sem nome), escreva o que foi dito ("refere uso de analgésico não especificado") e coloque o detalhe em "A confirmar".

## Formato de saída

Entregue o texto dentro de um único bloco de código, para copiar de uma vez, neste formato (omita linhas sem nenhuma informação, exceto as de antecedentes, medicações e alergias, que aparecem como "Não informado"):

```
QD: “<palavras do paciente>” <tempo>.

HPMA: <narrativa>

Antecedentes: <...>
Medicações em uso: <...>
Alergias: <...>
Hábitos: <só se mencionados>
Expectativa do paciente: <...>

A confirmar na consulta:
- <item que faltou>
- <sinais de alarme pertinentes à queixa: liste os específicos>
```

Depois do bloco, em uma ou duas linhas fora dele, aponte qualquer coisa do relato que você não conseguiu encaixar ou que pareceu contraditória. Se não houver, não escreva nada.

### Bloco de teleconsulta (quando aplicável)

No topo, antes da QD:

```
Atendimento por teleconsulta em <data>, das <início> às <término>, via <plataforma>. Paciente em <cidade/UF> durante o atendimento. Consentimento do paciente para teleconsulta <obtido e registrado | não registrado>.
```

E, se houver dados de exame, depois de expectativa:

```
Exame físico (remoto): Sinais aferidos pelo paciente em domicílio: <PA, FC...>. Ao vídeo: <achados>. Exame físico limitado pela modalidade remota.
```

Se o consentimento não foi mencionado, coloque "Registrar consentimento para teleconsulta (Resolução CFM nº 2.314/2022)" em "A confirmar".

## Sinais de alarme

Em "A confirmar", não escreva só "sinais de alarme": liste os pertinentes à queixa que o relato não esclareceu. Para as queixas mais comuns há uma lista em `references/sinais-de-alarme.md`; leia a seção da queixa em questão. Para queixas fora da lista, use seu conhecimento clínico com o mesmo critério: o que mudaria a urgência ou a conduta.

## Exemplo

Relato: "Doutor, faz uns 5 dias que tô com dor nas costas, lá embaixo, tipo um peso. Começou depois que carreguei umas caixas na mudança. Piora quando inclino ou fico muito tempo em pé, melhora deitado com compressa morna. Não usei remédio. Não tive febre nem ardor pra urinar. Tenho pressão alta, tomo losartana 50 de manhã."

```
QD: “Dor nas costas” há 5 dias.

HPMA: Paciente procura atendimento por dor nas costas, em região lombar baixa, descrita como em peso, há 5 dias. Relata início após carregar caixas durante uma mudança. Piora ao inclinar o tronco e ao permanecer muito tempo em pé; melhora com repouso em decúbito e compressa morna. Não fez uso de medicação para a queixa. Nega febre e disúria.

Antecedentes: Hipertensão arterial.
Medicações em uso: Losartana 50 mg pela manhã.
Alergias: Não informado.

A confirmar na consulta:
- Idade
- Intensidade da dor e evolução desde o início
- Alergias
- Episódios prévios
- Irradiação para membros inferiores, parestesia ou fraqueza
- Alteração do controle urinário ou intestinal, anestesia em sela
- Perda de peso, história de câncer, uso de corticoide ou imunossupressão
```
