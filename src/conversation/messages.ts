import { formatSlotPtBr, type Slot } from '../scheduling/slots.js';

/**
 * Textos determinísticos enviados ao paciente. Intro e pagamento vêm das
 * configurações (editáveis no painel) e são enviados LITERAIS. Os demais são
 * curtos e controlados — não gerados livremente pela IA.
 */

export const MSG_URGENCIA =
  'Pelo que você descreveu, isso pode ser uma emergência e não dá pra esperar um agendamento. ' +
  'Por favor, ligue agora para o SAMU no 192 ou vá ao pronto-socorro mais próximo. ' +
  'Já estou avisando o Dr. Daniel.';

export const MSG_DUVIDA_CLINICA =
  'Essa é uma ótima pergunta, mas por aqui eu não consigo avaliar sintomas nem indicar tratamento — ' +
  'isso o Dr. Daniel vê com calma na consulta. Quer que eu veja um horário pra você?';

export const MSG_FORA_DO_ASSUNTO =
  'Entendi! Esse assunto o Dr. Daniel vai te responder pessoalmente, tá? Já deixei ele avisado.';

export const MSG_PEDIR_NOME = 'Pra registrar a consulta, pode me dizer seu nome completo, por favor?';

export const MSG_PEDIR_MOTIVO = 'Perfeito! Só me conta rapidinho o motivo da consulta, por favor?';

export const MSG_PEDIR_PREFERENCIA =
  'Claro! Me conta rapidinho o motivo da consulta e qual dia e horário ficam melhor pra você, que eu vejo a agenda.';

export const MSG_FALHA_AGENDAMENTO =
  'Tive uma instabilidade pra confirmar na agenda agora. Vou confirmar com você em instantes, tá? Já avisei o Dr. Daniel.';

export function msgConfirmarPix(pixKey: string, priceCents: number): string {
  const price = (priceCents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
  return (
    `Perfeito, Pix então 😊 O valor é R$ ${price} e a chave é o e-mail ${pixKey}. ` +
    'Quando puder, me envie o comprovante por aqui.'
  );
}

export const MSG_CARTAO =
  'Combinado! O Dr. Daniel vai te passar os dados pra pagamento no cartão.';

export const MSG_COMPROVANTE_RECEBIDO =
  'Recebi, obrigado! Já registrei seu comprovante. Qualquer coisa o Dr. Daniel fala com você. 😊';

export function msgPropostaHorarioExato(slot: Slot, timezone: string): string {
  return `Consegui o horário de ${formatSlotPtBr(slot, timezone)}. Posso confirmar pra você?`;
}

export function msgAlternativas(alternativas: Slot[], timezone: string, pedidoIndisponivel: boolean): string {
  const linhas = alternativas.map((s, i) => `${i + 1}) ${formatSlotPtBr(s, timezone)}`).join('\n');
  const abertura = pedidoIndisponivel
    ? 'Esse horário não está disponível, mas tenho estas opções bem próximas:'
    : 'Tenho estes horários disponíveis:';
  return `${abertura}\n${linhas}\n\nQual deles fica melhor pra você?`;
}

export function msgConsultaConfirmada(slot: Slot, timezone: string): string {
  return `Consulta confirmada para ${formatSlotPtBr(slot, timezone)}. 😊`;
}
