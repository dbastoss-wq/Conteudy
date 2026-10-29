/**
 * Memória do bot no state adapter do Chat SDK (Redis em produção).
 *
 * O histórico de cada conversa só cresce (append-only): o Claude Opus 5.5 recusa
 * históricos editados. Para "esquecer", o bot começa uma conversa nova em vez de
 * apagar mensagens antigas.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { StateAdapter } from "chat";

const HORA = 3_600_000;
/** Depois de tanto tempo sem mensagens, a próxima mensagem começa uma conversa nova. */
export const NOVA_CONVERSA_APOS_MS = 6 * HORA;
/** Uma conversa longa demais também recomeça (custo e foco). */
export const MAX_MENSAGENS = 80;
const GUARDAR_CONVERSA_MS = 24 * HORA;
const GUARDAR_PENDENTE_MS = 2 * HORA;

export interface Conversa { mensagens: Anthropic.Beta.BetaMessageParam[]; atualizadaEm: number }
export interface PedidoPendente { id: string; nome: string; dataIso: string; horario: string; digitos: string; criadoEm: number }

export class Memoria {
  constructor(private readonly state: StateAdapter) {}

  async conversa(threadId: string, agora = Date.now()): Promise<Conversa> {
    const c = await this.state.get<Conversa>(`dr:conversa:${threadId}`);
    if (!c || agora - c.atualizadaEm > NOVA_CONVERSA_APOS_MS || c.mensagens.length > MAX_MENSAGENS) {
      return { mensagens: [], atualizadaEm: agora };
    }
    return c;
  }
  async salvarConversa(threadId: string, c: Conversa, agora = Date.now()) {
    await this.state.set(`dr:conversa:${threadId}`, { ...c, atualizadaEm: agora }, GUARDAR_CONVERSA_MS);
  }

  pendente(threadId: string) { return this.state.get<PedidoPendente>(`dr:pendente:${threadId}`); }
  salvarPendente(threadId: string, p: PedidoPendente) { return this.state.set(`dr:pendente:${threadId}`, p, GUARDAR_PENDENTE_MS); }
  apagarPendente(threadId: string) { return this.state.delete(`dr:pendente:${threadId}`); }

  /** Reserva o envio de um pedido; devolve false se ele já foi (ou está sendo) enviado, como num toque duplo. */
  reservarEnvio(pedidoId: string) { return this.state.setIfNotExists(`dr:enviado:${pedidoId}`, true, GUARDAR_CONVERSA_MS); }
  liberarEnvio(pedidoId: string) { return this.state.delete(`dr:enviado:${pedidoId}`); }
  async jaEnviado(pedidoId: string) { return (await this.state.get(`dr:enviado:${pedidoId}`)) != null; }

  /** Depois de encaminhar para a equipe, o bot fica em silêncio nessa conversa por um tempo. */
  async pausar(threadId: string, horas: number, agora = Date.now()) {
    if (horas > 0) await this.state.set(`dr:pausa:${threadId}`, agora + horas * HORA, horas * HORA);
  }
  async pausado(threadId: string, agora = Date.now()) {
    const ate = await this.state.get<number>(`dr:pausa:${threadId}`);
    return typeof ate === "number" && ate > agora;
  }
}
