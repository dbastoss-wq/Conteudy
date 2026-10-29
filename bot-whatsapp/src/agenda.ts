/**
 * Regras de horários portadas da página https://agenda-dr-daniel.netlify.app,
 * para o bot oferecer exatamente os mesmos dias e horários que o site.
 * Datas sempre no fuso de São Paulo, em "número do dia" (dias desde 1970-01-01 UTC).
 */
import { AGENDA, CLINICA } from "./config.js";

const DIA_MS = 864e5;
export const SEMANA = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
const SEMANA_CURTA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const FERIADOS_FIXOS: Record<string, string> = {
  "01-01": "Confraternização Universal", "04-21": "Tiradentes", "05-01": "Dia do Trabalho",
  "09-07": "Independência do Brasil", "10-12": "Nossa Senhora Aparecida", "11-02": "Finados",
  "11-15": "Proclamação da República", "11-20": "Dia da Consciência Negra", "12-25": "Natal",
};
const DDDS = new Set(("11 12 13 14 15 16 17 18 19 21 22 24 27 28 31 32 33 34 35 37 38 41 42 43 44 45 46 47 48 49 " +
  "51 53 54 55 61 62 63 64 65 66 67 68 69 71 73 74 75 77 79 81 82 83 84 85 86 87 88 89 91 92 93 94 95 96 97 98 99").split(" "));

const pad = (n: number) => (n < 10 ? "0" : "") + n;
const data = (dn: number) => new Date(dn * DIA_MS);
export const diaDaSemana = (dn: number) => data(dn).getUTCDay();
export function iso(dn: number) { const d = data(dn); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }
export function dnDe(isoStr: string) { const [a, m, d] = isoStr.split("-").map(Number); return Date.UTC(a!, m! - 1, d!) / DIA_MS; }
export const paraMin = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h! * 60 + m!; };
export const hhmm = (min: number) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
const maiuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const formatoSP = new Intl.DateTimeFormat("en-US", {
  timeZone: AGENDA.fuso, year: "numeric", month: "numeric", day: "numeric",
  hour: "numeric", minute: "numeric", hourCycle: "h23",
});

export interface Agora { dia: number; min: number }
export function agoraSP(agora: Date = new Date()): Agora {
  const p: Record<string, string> = {};
  formatoSP.formatToParts(agora).forEach((x) => { p[x.type] = x.value; });
  return { dia: Date.UTC(+p.year!, +p.month! - 1, +p.day!) / DIA_MS, min: (+p.hour! % 24) * 60 + +p.minute! };
}

function pascoa(ano: number) {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4,
    f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30,
    i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
    mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(ano, mes - 1, dia) / DIA_MS;
}
const cacheFeriados = new Map<number, Record<string, string>>();
function feriadosDoAno(ano: number) {
  const pronto = cacheFeriados.get(ano);
  if (pronto) return pronto;
  const mapa: Record<string, string> = {};
  Object.keys(FERIADOS_FIXOS).forEach((md) => { mapa[`${ano}-${md}`] = FERIADOS_FIXOS[md]!; });
  AGENDA.feriadosLocais.forEach((md) => { mapa[`${ano}-${md}`] = "feriado local"; });
  const p = pascoa(ano);
  mapa[iso(p - 2)] = "Sexta-feira Santa";
  if (AGENDA.fecharPontosFacultativos) {
    mapa[iso(p - 48)] = "Carnaval";
    mapa[iso(p + 60)] = "Corpus Christi";
  }
  cacheFeriados.set(ano, mapa);
  return mapa;
}
export function feriado(dn: number): string | null { const s = iso(dn); return feriadosDoAno(+s.slice(0, 4))[s] ?? null; }

const horariosBase = (() => {
  const lista: number[] = [];
  const ini = paraMin(AGENDA.abertura), fim = paraMin(AGENDA.fechamento);
  for (let m = ini; m + AGENDA.duracaoMin <= fim; m += AGENDA.intervaloMin) lista.push(m);
  return lista;
})();

export type StatusDia = "livre" | "encerrado" | "feriado" | "bloqueado" | "sem-atendimento" | "fora-do-periodo";
export interface Dia { dn: number; iso: string; status: StatusDia; motivo?: string; horarios: number[] }

/** Situação de um dia, com as mesmas regras da página. */
export function situacaoDoDia(dn: number, agora: Agora = agoraSP()): Dia {
  const hoje = agora.dia, ultimo = hoje + AGENDA.semanas * 7 - 1;
  const base: Dia = { dn, iso: iso(dn), status: "livre", horarios: [] };
  if (dn < hoje || dn > ultimo) return { ...base, status: "fora-do-periodo" };
  if (!(AGENDA.diasDeAtendimento as readonly number[]).includes(diaDaSemana(dn))) return { ...base, status: "sem-atendimento" };
  const nomeFeriado = feriado(dn);
  if (nomeFeriado) return { ...base, status: "feriado", motivo: nomeFeriado };
  if ((AGENDA.datasBloqueadas as readonly string[]).includes(base.iso)) return { ...base, status: "bloqueado" };
  const limite = agora.min + AGENDA.antecedenciaMin, deslocamento = (dn - hoje) * 1440;
  const horarios = horariosBase.filter((m) => deslocamento + m >= limite);
  return { ...base, status: horarios.length ? "livre" : "encerrado", horarios };
}

/** Dias com horário livre dentro do período que a página mostra (4 semanas a partir de hoje). */
export function diasLivres(agora: Agora = agoraSP()): Dia[] {
  const dias: Dia[] = [];
  for (let dn = agora.dia; dn <= agora.dia + AGENDA.semanas * 7 - 1; dn++) {
    const d = situacaoDoDia(dn, agora);
    if (d.status === "livre") dias.push(d);
  }
  return dias;
}

export type Validacao = { ok: true; dn: number; min: number } | { ok: false; erro: string };
export function validarHorario(dataIso: string, horario: string, agora: Agora = agoraSP()): Validacao {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataIso) || iso(dnDe(dataIso)) !== dataIso) return { ok: false, erro: `Data inválida: "${dataIso}". Use AAAA-MM-DD.` };
  if (!/^\d{2}:\d{2}$/.test(horario)) return { ok: false, erro: `Horário inválido: "${horario}". Use HH:MM.` };
  const dn = dnDe(dataIso), min = paraMin(horario), dia = situacaoDoDia(dn, agora);
  const quando = `${dataLonga(dn)}`;
  switch (dia.status) {
    case "fora-do-periodo": return { ok: false, erro: `${quando} está fora do período da agenda (de hoje até ${AGENDA.semanas} semanas à frente).` };
    case "sem-atendimento": return { ok: false, erro: `Não há atendimento às ${SEMANA[diaDaSemana(dn)]}s. Os dias de atendimento são segunda, quinta, sexta e sábado.` };
    case "feriado": return { ok: false, erro: `${quando} é feriado (${dia.motivo}), sem atendimento.` };
    case "bloqueado": return { ok: false, erro: `${quando} está bloqueado na agenda.` };
    case "encerrado": return { ok: false, erro: `Não há mais horários livres em ${quando}.` };
  }
  if (!dia.horarios.includes(min)) return { ok: false, erro: `${horario} não está disponível em ${quando}. Horários livres nesse dia: ${dia.horarios.map(hhmm).join(", ")}.` };
  return { ok: true, dn, min };
}

/* ---------- Textos (iguais aos da página) ---------- */
export function dataLonga(dn: number) { const d = data(dn); return `${maiuscula(SEMANA[d.getUTCDay()]!)}, ${d.getUTCDate()} de ${MESES[d.getUTCMonth()]}`; }
export function dataCurta(dn: number) { const d = data(dn); return `${SEMANA_CURTA[d.getUTCDay()]} ${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}`; }
export function dataNumerica(dn: number) { const d = data(dn); return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`; }
export function agoraPorExtenso(agora: Agora) { return `${SEMANA[diaDaSemana(agora.dia)]}, ${dataNumerica(agora.dia)}, ${hhmm(agora.min)}`; }

/* ---------- WhatsApp do paciente ---------- */
export function formatarWhats(d: string) {
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}
/**
 * Converte o identificador do WhatsApp (ex.: 5511987654321) nos 11 dígitos que a página usa.
 * Números brasileiros antigos às vezes chegam sem o nono dígito (55 11 8765-4321).
 */
export function celularDoWhatsapp(id: string): string | null {
  // Só números (wa_id). Um BSUID ("BR.AbC123…") não é telefone, mesmo que tenha dígitos.
  if (!/^\+?\d+$/.test(id.trim())) return null;
  let d = id.replace(/\D/g, "");
  if (!d.startsWith("55") || (d.length !== 12 && d.length !== 13)) return null;
  d = d.slice(2);
  if (d.length === 10 && /[6-9]/.test(d.charAt(2))) d = `${d.slice(0, 2)}9${d.slice(2)}`;
  return validarCelular(d) ? null : d;
}
/** Mesma validação do campo WhatsApp da página. Devolve a mensagem de erro, ou "" se estiver certo. */
export function validarCelular(d: string): string {
  if (!d) return "Informe o WhatsApp com DDD.";
  if (d.length < 11) return "O número está incompleto. São 11 números: (DD) 9XXXX-XXXX.";
  if (d.length > 11) return "O número tem dígitos a mais. São 11 números: (DD) 9XXXX-XXXX.";
  if (!DDDS.has(d.slice(0, 2))) return `Confira o DDD: (${d.slice(0, 2)}) não é um DDD válido.`;
  if (d.charAt(2) !== "9") return "Depois do DDD, o celular começa com 9.";
  if (/^(\d)\1+$/.test(d.slice(3))) return "Confira o número do WhatsApp.";
  return "";
}
/** Mesma validação do campo nome da página. */
export function validarNome(nome: string): string {
  const v = nome.trim().replace(/\s+/g, " ");
  if (!v) return "Falta o nome completo.";
  if (/\d/.test(v)) return "O nome não deve ter números.";
  const partes = v.split(" ").filter((p) => p.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ]/g, "").length >= 2);
  if (partes.length < 2) return "Falta o sobrenome: peça nome e sobrenome.";
  return "";
}

/* ---------- Links que a página manda para a equipe ---------- */
function carimbo(dn: number, min: number) {
  const d = data(dn + Math.floor(min / 1440)), m = min % 1440;
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(Math.floor(m / 60))}${pad(m % 60)}00`;
}
export function linkGoogleAgenda(dn: number, min: number, nome: string, whats: string, digitos: string) {
  const p = new URLSearchParams({
    action: "TEMPLATE",
    text: `Consulta · ${nome}`,
    dates: `${carimbo(dn, min)}/${carimbo(dn, min + AGENDA.duracaoMin)}`,
    ctz: AGENDA.fuso,
    details: `Pedido de agendamento feito pelo WhatsApp (assistente virtual).\nPaciente: ${nome}\nWhatsApp: ${whats} · https://wa.me/55${digitos}\nAguardando confirmação da equipe.`,
  });
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}
export function linkResponder(dn: number, min: number, nome: string, digitos: string) {
  const primeiro = nome.split(" ")[0];
  const texto = `Olá, ${primeiro}! Aqui é da equipe do ${CLINICA.medico}. Recebemos seu pedido de consulta para ${dataLonga(dn).toLowerCase()}, às ${hhmm(min)}.`;
  return `https://wa.me/55${digitos}?text=${encodeURIComponent(texto)}`;
}
