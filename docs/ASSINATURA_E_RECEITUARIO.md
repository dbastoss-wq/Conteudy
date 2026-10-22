# Assinatura externa e receituário

## Verificação

Ao passar para pronto para assinatura, o servidor congela uma versão final não assinada, seus bytes cifrados e SHA-256. Downloads seguintes retornam esse mesmo arquivo. O médico assina externamente e importa o resultado.

O backend confere prefixo incremental exato, conteúdo visual das páginas, uma assinatura cobrindo todo o arquivo, CPF correspondente ao médico do documento, cadeia configurada, validade e revogação obrigatória.

Resultado positivo permite estado assinado com verificação. A liberação depende de ação médica. O portal entrega exatamente os bytes assinados com conferência de hash. Imagem de assinatura, nome digitado ou QR não são prova.

## Limites

Aceita **uma assinatura invisível, incremental, até 15 MB e 500 páginas**. Selo visual, PDF regravado/otimizado e múltiplas assinaturas são recusados mesmo que outro verificador os aceite. Confira compatibilidade com o assinador escolhido.

Raízes e CRLs são provisionadas pelo administrador; o servidor não segue URLs AIA/OCSP fornecidas por arquivo não confiável. Ausência, expiração ou revogação não verificável impedem resultado positivo. Não há integração de assinatura em nuvem ou certificado privado no aplicativo.

Testes geram CA/certificados **sintéticos, não ICP-Brasil**. Manifestos test_only são recusados fora de test. Não houve emissão clínica com certificado real.

## Configurar confiança

Confira raízes corretas, vigentes e com finalidade apropriada no [repositório ITI](https://www.gov.br/iti/pt-br/assuntos/repositorio/repositorio-ac-raiz), sem confiar em raízes genéricas do sistema operacional. Obtenha CRLs atuais da cadeia em fontes oficiais.

ICP_TRUST_DIR recebe raízes DER/PEM e CRLs com extensão .crl; ICP_TRUST_MANIFEST aponta para JSON conferido:

~~~json
{
  "source": "https://www.gov.br/iti/pt-br/assuntos/repositorio/repositorio-ac-raiz",
  "reviewed_at": "SUBSTITUIR_POR_DATA_ISO_8601_UTC_DA_CONFERENCIA",
  "roots": [
    {
      "file": "SUBSTITUIR_POR_ARQUIVO_CONFERIDO.der",
      "status": "active",
      "sha256_der": "SUBSTITUIR_POR_SHA256_DOS_BYTES_DER"
    }
  ]
}
~~~

O exemplo é deliberadamente não operacional. Não há raiz/credencial embutida. Revisão nos últimos 90 dias é política técnica local, não prazo legal; CRLs precisam estar vigentes em cada validação. O hash confirma o arquivo aprovado pelo administrador, não a autenticidade da seleção administrativa.

Preencha CPF médico real. SIGNATURE_REVOCATION_REQUIRED deve ser true; false não libera documentos.

## Categorias sanitárias

**Assinatura válida não comprova adequação sanitária do receituário.** Não há integração SNCR. A classificação depende de confirmação médica; não é inferida de base farmacológica.

Emissão final bloqueada para não classificados, antimicrobianos/RET, GLP-1/RET, controlados e especiais. Rascunho é identificado; não há emissão genérica válida para essas categorias nem numeração sanitária digitável/simulada. Para categoria comum, confira regras e campos da emissão concreta. Verificação técnica não homologa prescrição ou instalação.

## Fontes oficiais

Conferidas em **21/10/2026**. Reconfira na implantação e após atualizações.

| Fonte | Uso e limite |
| --- | --- |
| [Anvisa — documentos SNCR](https://www.gov.br/anvisa/pt-br/assuntos/medicamentos/controlados/sncr/documentos-do-sncr) | Atualização 16/10/2026: integração e alterações operacionais; anúncio de mudança de dígitos não foi tratado como implantação comprovada |
| [Anvisa — prescritores](https://www.gov.br/anvisa/pt-br/assuntos/medicamentos/controlados/sncr/prescritores) | Orientações de emissão por serviços integrados; atualização 29/09/2026 |
| [Anvisa — perguntas e respostas RDC 1.000/2025, 2ª edição](https://www.gov.br/anvisa/pt-br/assuntos/medicamentos/controlados/sncr/farmacias/perguntas-e-respostas-rdc-1000-2025-2a-edicao.pdf/@@display-file/file) | Questões 39–43: assinatura qualificada para controlados Portaria 344; 48–49: modelos sujeitos a integração, sem substituir por número em PDF genérico |
| [ITI — AC Raiz](https://www.gov.br/iti/pt-br/assuntos/repositorio/repositorio-ac-raiz) | Raízes, vigência e finalidade exigem conferência oficial |
| [ITI — VALIDAR](https://validar.iti.gov.br/) | Autoria/integridade não equivalem a adequação sanitária |
| [CFM — prescrição eletrônica](https://prescricaoeletronica.cfm.org.br/) | Serviço oficial consultado; não foi presumida API pública ou realizada integração |

Há divergência operacional de data: página de documentos de 16/10 refere-se a transição até 29/10; questão 50 do PDF informa até 30/10 e obrigatoriedade em 31/10. O aplicativo não resolve isso por suposição e não desbloqueia categorias por data. Confira a instrução vigente com os responsáveis.
