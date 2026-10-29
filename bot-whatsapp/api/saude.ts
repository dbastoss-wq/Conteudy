/** Verificação rápida: mostra o que está configurado, sem expor nenhum segredo. */
import { lerConfig } from "../src/config.js";

export function GET() {
  const cfg = lerConfig();
  const tem = (nome: string) => Boolean(process.env[nome]);
  return Response.json({
    ok: tem("WHATSAPP_ACCESS_TOKEN") && tem("WHATSAPP_APP_SECRET") && tem("WHATSAPP_PHONE_NUMBER_ID") && tem("WHATSAPP_VERIFY_TOKEN") && tem("ANTHROPIC_API_KEY"),
    whatsapp: { token: tem("WHATSAPP_ACCESS_TOKEN"), appSecret: tem("WHATSAPP_APP_SECRET"), phoneNumberId: tem("WHATSAPP_PHONE_NUMBER_ID"), verifyToken: tem("WHATSAPP_VERIFY_TOKEN") },
    claude: { apiKey: tem("ANTHROPIC_API_KEY"), modelo: cfg.modelo, esforco: cfg.esforco },
    memoria: cfg.redisUrl ? "redis" : "memória local (configure REDIS_URL em produção)",
    avisosParaEquipe: Boolean(cfg.equipeWhatsapp),
    formulario: cfg.formularioNome,
  });
}
