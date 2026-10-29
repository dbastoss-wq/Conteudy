import { describe, expect, it } from "vitest";
import {
  agoraSP, celularDoWhatsapp, dataLonga, diasLivres, dnDe, feriado, formatarWhats, hhmm, situacaoDoDia,
  validarCelular, validarHorario, validarNome,
} from "../src/agenda.js";
import { paraWhatsapp } from "../src/bot.js";
import { camposDoFormulario } from "../src/formulario.js";
import { triagemDeRisco } from "../src/seguranca.js";

// Quinta-feira, 29/10/2026, 14:00 em Brasília.
const AGORA = agoraSP(new Date("2026-10-29T14:00:00-03:00"));

describe("agenda (mesmas regras da página)", () => {
  it("lê a hora de Brasília", () => {
    expect(hhmm(AGORA.min)).toBe("14:00");
    expect(dataLonga(AGORA.dia)).toBe("Quinta-feira, 29 de outubro");
  });

  it("hoje só oferece horários com 30 min de antecedência", () => {
    const hoje = situacaoDoDia(AGORA.dia, AGORA);
    expect(hoje.status).toBe("livre");
    expect(hoje.horarios.map(hhmm)).toEqual(["14:30", "15:00", "15:30", "16:00", "16:30", "17:00", "17:30"]);
  });

  it("sexta tem de 09:00 a 17:30", () => {
    const sexta = situacaoDoDia(dnDe("2026-11-06"), AGORA);
    expect(sexta.status).toBe("livre");
    expect(hhmm(sexta.horarios[0]!)).toBe("09:00");
    expect(hhmm(sexta.horarios.at(-1)!)).toBe("17:30");
    expect(sexta.horarios).toHaveLength(18);
  });

  it("não atende terça, quarta e domingo", () => {
    for (const d of ["2026-11-03", "2026-11-04", "2026-11-08"]) expect(situacaoDoDia(dnDe(d), AGORA).status).toBe("sem-atendimento");
  });

  it("feriados nacionais e móveis", () => {
    expect(feriado(dnDe("2026-11-02"))).toMatch(/Finados/);
    expect(situacaoDoDia(dnDe("2026-11-02"), AGORA).status).toBe("feriado");
    expect(feriado(dnDe("2026-11-20"))).toMatch(/Consciência Negra/);
    expect(feriado(dnDe("2027-03-26"))).toMatch(/Sexta-feira Santa/); // Páscoa de 2027: 28/03
    expect(feriado(dnDe("2027-02-08"))).toMatch(/Carnaval/);
    expect(feriado(dnDe("2027-05-27"))).toMatch(/Corpus Christi/);
  });

  it("só 4 semanas à frente (28 dias contando hoje)", () => {
    expect(situacaoDoDia(dnDe("2026-11-23"), AGORA).status).toBe("livre");
    expect(situacaoDoDia(dnDe("2026-11-26"), AGORA).status).toBe("fora-do-periodo");
    expect(situacaoDoDia(dnDe("2026-10-26"), AGORA).status).toBe("fora-do-periodo");
    const dias = diasLivres(AGORA);
    expect(dias[0]!.iso).toBe("2026-10-29");
    expect(dias.some((d) => d.iso === "2026-11-02")).toBe(false);
  });

  it("valida horário pedido", () => {
    expect(validarHorario("2026-11-06", "10:00", AGORA).ok).toBe(true);
    expect(validarHorario("2026-11-06", "10:15", AGORA).ok).toBe(false);
    expect(validarHorario("2026-11-06", "18:00", AGORA).ok).toBe(false);
    expect(validarHorario("2026-10-29", "14:00", AGORA).ok).toBe(false);
    expect(validarHorario("2026-11-02", "10:00", AGORA)).toMatchObject({ ok: false, erro: expect.stringMatching(/feriado/i) });
  });
});

describe("dados do paciente", () => {
  it("celular do WhatsApp, com e sem o nono dígito", () => {
    expect(celularDoWhatsapp("5511987654321")).toBe("11987654321");
    expect(celularDoWhatsapp("551187654321")).toBe("11987654321");
    expect(celularDoWhatsapp("BR.55119876543210")).toBeNull();
    expect(celularDoWhatsapp("14155550123")).toBeNull();
    expect(formatarWhats("11987654321")).toBe("(11) 98765-4321");
    expect(validarCelular("00987654321")).toMatch(/DDD/);
  });

  it("nome e sobrenome", () => {
    expect(validarNome("Maria Silva")).toBe("");
    expect(validarNome("Maria")).not.toBe("");
    expect(validarNome("Maria 2")).not.toBe("");
  });

  it("campos iguais aos do formulário da página", () => {
    const campos = Object.fromEntries(camposDoFormulario({ nome: "Maria Silva", dn: dnDe("2026-11-06"), min: 600, digitos: "11987654321" }, "agendamento-dr-daniel"));
    expect(Object.keys(campos)).toEqual(["form-name", "data", "horario", "adicionar_google_agenda", "responder_paciente_whatsapp", "bot-field", "nome", "whatsapp", "consentimento_lgpd"]);
    expect(campos).toMatchObject({ "form-name": "agendamento-dr-daniel", data: "06/11/2026 (sexta-feira)", horario: "10:00", nome: "Maria Silva", whatsapp: "(11) 98765-4321", consentimento_lgpd: "Sim, autorizo", "bot-field": "" });
    expect(campos.adicionar_google_agenda).toMatch(/^https:\/\/calendar\.google\.com\//);
    expect(campos.responder_paciente_whatsapp).toMatch(/^https:\/\/wa\.me\/5511987654321\?text=/);
  });
});

describe("triagem de risco", () => {
  it("emergência e risco à vida, com e sem acento", () => {
    expect(triagemDeRisco("estou com dor no peito")?.tipo).toBe("emergencia");
    expect(triagemDeRisco("FALTA DE AR")?.tipo).toBe("emergencia");
    expect(triagemDeRisco("acho que é um AVC")?.tipo).toBe("emergencia");
    expect(triagemDeRisco("penso em suicídio")?.tipo).toBe("risco-de-vida");
    expect(triagemDeRisco("não quero mais viver")?.mensagem).toMatch(/188/);
    expect(triagemDeRisco("quero marcar uma consulta para sexta")).toBeNull();
    expect(triagemDeRisco("dor nas costas")).toBeNull();
  });
});

describe("formato do WhatsApp", () => {
  it("troca **negrito** e títulos pelo *negrito* do WhatsApp, sem mexer no resto", () => {
    expect(paraWhatsapp("## Horários\nTenho **sexta**, 6/11, e *sábado*.")).toBe("*Horários*\nTenho *sexta*, 6/11, e *sábado*.");
    expect(paraWhatsapp("Sem formatação.")).toBe("Sem formatação.");
  });
});
