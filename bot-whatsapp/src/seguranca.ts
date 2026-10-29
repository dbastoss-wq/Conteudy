/**
 * Triagem de risco feita pelo código, antes da IA responder: a orientação de emergência
 * sai sempre, mesmo que a IA falhe ou esteja fora do ar.
 */
const sem = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const EMERGENCIA = /dor (forte |muito forte )?no peito|aperto no peito|falta de ar|nao consigo respirar|dificuldade (para|pra) respirar|desmai|convuls|sangramento (intenso|forte|que nao para)|vomit\w* sangue|\bavc\b|derrame|boca torta|rosto torto|perda de forca|nao consigo mexer|overdose|envenen/;
const RISCO_VIDA = /suicid|me matar|tirar (a )?minha (propria )?vida|nao quero mais viver|acabar com (a )?minha vida|quero morrer|me machucar/;

export type Risco = { tipo: "emergencia" | "risco-de-vida"; mensagem: string } | null;

export function triagemDeRisco(texto: string): Risco {
  const t = sem(texto);
  if (RISCO_VIDA.test(t)) {
    return {
      tipo: "risco-de-vida",
      mensagem:
        "Sinto muito que você esteja passando por isso. Você não precisa enfrentar isso sem apoio.\n\n" +
        "📞 Ligue *188* (CVV, gratuito, 24 horas) ou converse em cvv.org.br.\n" +
        "🚑 Se estiver em perigo agora, ligue *192* (SAMU) ou vá ao pronto-socorro mais próximo.\n\n" +
        "Vou avisar a equipe do consultório também.",
    };
  }
  if (EMERGENCIA.test(t)) {
    return {
      tipo: "emergencia",
      mensagem:
        "⚠️ Se for uma emergência (dor no peito, falta de ar, desmaio, sinais de AVC ou sangramento intenso), " +
        "ligue agora para o *SAMU 192* ou procure o pronto-socorro mais próximo. Este canal não atende emergências.",
    };
  }
  return null;
}
