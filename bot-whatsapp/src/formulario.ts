/**
 * Envia o pedido para o MESMO formulário da Netlify que a página de agendamento usa
 * ("agendamento-dr-daniel"), com os mesmos campos. Assim os pedidos do WhatsApp chegam
 * no mesmo lugar (e nos mesmos avisos por e-mail) que os do site.
 */
import { SEMANA, dataNumerica, diaDaSemana, formatarWhats, hhmm, linkGoogleAgenda, linkResponder } from "./agenda.js";
import type { Config } from "./config.js";

export interface Pedido { nome: string; dn: number; min: number; digitos: string }

export function camposDoFormulario(p: Pedido, formularioNome: string): URLSearchParams {
  const whats = formatarWhats(p.digitos);
  return new URLSearchParams({
    "form-name": formularioNome,
    data: `${dataNumerica(p.dn)} (${SEMANA[diaDaSemana(p.dn)]})`,
    horario: hhmm(p.min),
    adicionar_google_agenda: linkGoogleAgenda(p.dn, p.min, p.nome, whats, p.digitos),
    responder_paciente_whatsapp: linkResponder(p.dn, p.min, p.nome, p.digitos),
    "bot-field": "",
    nome: p.nome,
    whatsapp: whats,
    consentimento_lgpd: "Sim, autorizo",
  });
}

export async function enviarPedido(p: Pedido, cfg: Pick<Config, "formularioUrl" | "formularioNome">): Promise<void> {
  const r = await fetch(cfg.formularioUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: camposDoFormulario(p, cfg.formularioNome).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`Formulário da Netlify respondeu HTTP ${r.status}`);
}
