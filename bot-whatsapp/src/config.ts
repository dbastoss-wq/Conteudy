/**
 * Regras da agenda: mantenha IGUAIS ao CONFIG da página
 * https://agenda-dr-daniel.netlify.app (bloco "CONFIGURAÇÃO DA AGENDA").
 * Se mudar lá (dias, horários, férias), mude aqui também.
 */
export const AGENDA = {
  fuso: "America/Sao_Paulo",
  diasDeAtendimento: [1, 4, 5, 6], // 0 = domingo … 6 = sábado (seg, qui, sex, sáb)
  abertura: "09:00",
  fechamento: "18:00", // o último horário é 17:30
  intervaloMin: 30,
  duracaoMin: 30,
  semanas: 4,
  antecedenciaMin: 30,
  fecharPontosFacultativos: true, // segunda de Carnaval e Corpus Christi
  feriadosLocais: [] as string[], // 'MM-DD'
  datasBloqueadas: [] as string[], // 'AAAA-MM-DD' (férias, congressos)
} as const;

export const CLINICA = {
  medico: "Dr. Daniel Cardoso de Bastos",
  crm: "CRM-SP 239894",
  endereco: "Rua José Augusto de Siqueira, 122, Santa Isabel/SP",
  agendaUrl: "https://agenda-dr-daniel.netlify.app",
  triagemUrl: "https://www.cognitoforms.com/drdanielbastos/triagempr%C3%A9teleconsulta",
  /** Número do consultório usado nos links da página de agendamento (wa.me). */
  whatsappConsultorio: "5511926915324",
} as const;

export interface Config {
  modelo: string;
  esforco: "low" | "medium" | "high" | "xhigh" | "max";
  formularioUrl: string;
  formularioNome: string;
  /** Celular da equipe (só dígitos, com 55) que recebe avisos de pedidos e encaminhamentos. */
  equipeWhatsapp: string;
  /** Modelo de mensagem aprovado na Meta para avisar a equipe fora da janela de 24 h (opcional). */
  equipeTemplate: string;
  pausaHoras: number;
  debounceMs: number;
  redisUrl: string;
}

const ESFORCOS = new Set(["low", "medium", "high", "xhigh", "max"]);

export function lerConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const esforco = env.CLAUDE_EFFORT ?? "low";
  return {
    modelo: env.CLAUDE_MODEL || "claude-opus-5-5",
    esforco: (ESFORCOS.has(esforco) ? esforco : "low") as Config["esforco"],
    formularioUrl: env.NETLIFY_FORM_URL || `${CLINICA.agendaUrl}/`,
    formularioNome: env.NETLIFY_FORM_NAME || "agendamento-dr-daniel",
    equipeWhatsapp: (env.EQUIPE_WHATSAPP ?? "").replace(/\D/g, ""),
    equipeTemplate: env.EQUIPE_TEMPLATE ?? "",
    pausaHoras: Number(env.PAUSA_APOS_ENCAMINHAR_HORAS ?? 12),
    debounceMs: Number(env.BOT_DEBOUNCE_MS ?? 2000),
    redisUrl: env.REDIS_URL ?? "",
  };
}
