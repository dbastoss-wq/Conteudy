/**
 * Confere, no navegador, que o bot oferece EXATAMENTE os mesmos dias e horários que a
 * página de agendamento publicada, em várias datas (feriados, fim do dia, virada de mês).
 *
 * Precisa de internet e do Playwright com o Chromium:
 *   npm i --no-save playwright && npx playwright install chromium
 *   npm run conferir-pagina
 */
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { agoraSP, diasLivres, dnDe, iso, situacaoDoDia } from "../src/agenda.js";
import { CLINICA } from "../src/config.js";

const URL_PAGINA = process.env.AGENDA_URL || CLINICA.agendaUrl;

/** Só o pedaço do Playwright usado aqui (ele não é dependência do projeto). */
interface Pagina {
  clock: { setFixedTime(t: Date): Promise<void> };
  goto(url: string, opcoes: { waitUntil: "networkidle" }): Promise<unknown>;
  $$eval<T>(seletor: string, fn: (els: Element[]) => T): Promise<T>;
  $eval(seletor: string, fn: (el: Element) => void): Promise<void>;
}
interface Playwright { chromium: { launch(): Promise<{ newPage(o: { timezoneId: string }): Promise<Pagina>; close(): Promise<void> }> } }
const MOMENTOS = [
  "2026-10-29T14:00:00-03:00", // quinta à tarde; Finados (02/11) e Consciência Negra (20/11) no período
  "2026-10-29T17:10:00-03:00", // hoje já encerrado (antecedência de 30 min)
  "2026-10-31T07:30:00-03:00", // sábado antes de abrir
  "2027-02-04T10:00:00-03:00", // Carnaval 2027 (segunda, 08/02)
  "2027-03-20T12:00:00-03:00", // Sexta-feira Santa 2027 (26/03)
  "2027-05-20T09:00:00-03:00", // Corpus Christi 2027 (27/05)
  "2026-12-20T23:50:00-03:00", // virada do dia em Brasília, Natal e Ano-Novo no período
];

describe.skipIf(!process.env.CONFERIR_PAGINA)("bot igual à página publicada", () => {
  it.each(MOMENTOS)("%s", async (momento) => {
    const { chromium } = createRequire(import.meta.url)("playwright") as Playwright;
    const navegador = await chromium.launch();
    try {
      const pagina = await navegador.newPage({ timezoneId: "America/Sao_Paulo" });
      await pagina.clock.setFixedTime(new Date(momento));
      await pagina.goto(URL_PAGINA, { waitUntil: "networkidle" });
      const agora = agoraSP(new Date(momento));

      const diasPagina = await pagina.$$eval("#dias input[name=dia]", (els) => els.map((e) => ({ iso: (e as HTMLInputElement).value, livre: !(e as HTMLInputElement).disabled })));
      expect(diasPagina.length).toBeGreaterThan(0);
      // Cada dia que a página mostra tem a mesma situação no bot…
      for (const d of diasPagina) {
        const bot = situacaoDoDia(dnDe(d.iso), agora);
        expect({ iso: d.iso, livre: bot.status === "livre" }).toEqual(d);
        if (!d.livre) continue;
        await pagina.$eval(`#dias input[value="${d.iso}"]`, (e) => (e as HTMLInputElement).click());
        const horarios = await pagina.$$eval("#horarios input[name=hora]", (els) => els.map((e) => Number((e as HTMLInputElement).value)));
        expect({ iso: d.iso, horarios }).toEqual({ iso: d.iso, horarios: bot.horarios });
      }
      // …e o bot não oferece nenhum dia que a página não mostre.
      const livresPagina = diasPagina.filter((d) => d.livre).map((d) => d.iso);
      expect(diasLivres(agora).map((d) => d.iso)).toEqual(livresPagina);
      expect(iso(agora.dia)).toBe(momento.slice(0, 10)); // o "hoje" é o de Brasília
    } finally {
      await navegador.close();
    }
  }, 60_000);
});
