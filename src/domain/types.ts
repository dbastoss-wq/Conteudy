/** Janela de atendimento em um dia (hora local, formato HH:mm). */
export interface WorkingWindow {
  start: string; // 'HH:mm'
  end: string; // 'HH:mm'
}

/**
 * Configuração de atendimento. Fica no banco (tabela `settings`) e é editável
 * pelo painel. Todo o cálculo de disponibilidade usa estes valores + o fuso.
 */
export interface SchedulingSettings {
  timezone: string; // sempre 'America/Sao_Paulo'
  /** Dias trabalhados no padrão luxon: 1=segunda ... 7=domingo. */
  workingDays: number[];
  /** Janelas por dia da semana (chave = weekday luxon). Permite almoço, etc. */
  windows: Record<number, WorkingWindow[]>;
  slotDurationMinutes: number; // padrão 15
  bufferMinutes: number; // intervalo entre consultas
  minLeadMinutes: number; // antecedência mínima
  /** Horizonte de busca de horários livres, em dias. */
  horizonDays: number;
}

/** Intervalo de tempo absoluto (instantes UTC em ISO-8601). */
export interface TimeInterval {
  start: string; // ISO UTC
  end: string; // ISO UTC
}

export const CONVERSATION_STATES = [
  'NOVO',
  'AGUARDANDO_INFO',
  'PROPOSTA_HORARIOS',
  'AGUARDANDO_NOME',
  'AGUARDANDO_CONFIRMACAO',
  'AGENDANDO',
  'AGUARDANDO_PAGAMENTO',
  'CONCLUIDO',
  'URGENCIA',
  'TRANSFERIDO',
] as const;

export type ConversationState = (typeof CONVERSATION_STATES)[number];

export type PaymentMethod = 'pix' | 'credito' | 'debito';
export type PaymentStatus =
  | 'pendente'
  | 'aguardando_comprovante'
  | 'comprovante_recebido'
  | 'cartao_com_medico';

export const DEFAULT_SETTINGS: SchedulingSettings = {
  timezone: 'America/Sao_Paulo',
  workingDays: [1, 2, 3, 4, 5],
  windows: {
    1: [{ start: '08:00', end: '12:00' }, { start: '13:00', end: '18:00' }],
    2: [{ start: '08:00', end: '12:00' }, { start: '13:00', end: '18:00' }],
    3: [{ start: '08:00', end: '12:00' }, { start: '13:00', end: '18:00' }],
    4: [{ start: '08:00', end: '12:00' }, { start: '13:00', end: '18:00' }],
    5: [{ start: '08:00', end: '12:00' }, { start: '13:00', end: '18:00' }],
  },
  slotDurationMinutes: 15,
  bufferMinutes: 0,
  minLeadMinutes: 120,
  horizonDays: 21,
};
