/**
 * Webhook da WhatsApp Cloud API (configure esta URL no app da Meta):
 *   https://SEU-PROJETO.vercel.app/api/webhooks/whatsapp
 *
 * GET: verificação do webhook (hub.challenge). POST: mensagens e botões, com a
 * assinatura X-Hub-Signature-256 conferida pelo adaptador. A resposta à Meta sai
 * na hora; o processamento continua em segundo plano com waitUntil.
 */
import { waitUntil } from "@vercel/functions";
import { obterBot } from "../../src/bot.js";

const tratar = (request: Request) => obterBot().webhooks.whatsapp(request, { waitUntil });

export const GET = tratar;
export const POST = tratar;
