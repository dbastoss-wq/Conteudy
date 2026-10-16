import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { checkRequestedSlot, generateFreeSlots, nearestAlternatives } from '../src/scheduling/slots';
import { DEFAULT_SETTINGS, type SchedulingSettings } from '../src/domain/types';

const settings: SchedulingSettings = { ...DEFAULT_SETTINGS, bufferMinutes: 0, minLeadMinutes: 120 };
const TZ = settings.timezone;

// Segunda-feira, 09:00 (horário de São Paulo). Antecedência mínima => 11:00.
const NOW = DateTime.fromISO('2026-10-19T09:00:00', { zone: TZ });

describe('horário ocupado', () => {
  it('não é agendável quando o horário pedido já está ocupado, e oferece 3 alternativas livres próximas', () => {
    // Terça 14:00 está dentro do expediente e após a antecedência.
    const requested = '2026-10-20T14:00:00';
    // Ocupa exatamente 14:00–14:15.
    const busy = [
      {
        start: DateTime.fromISO('2026-10-20T14:00:00', { zone: TZ }).toUTC().toISO()!,
        end: DateTime.fromISO('2026-10-20T14:15:00', { zone: TZ }).toUTC().toISO()!,
      },
    ];

    const check = checkRequestedSlot(settings, requested, busy, NOW);
    expect(check.withinWorkingHours).toBe(true);
    expect(check.respectsLeadTime).toBe(true);
    expect(check.free).toBe(false);
    expect(check.bookable).toBe(false);

    const free = generateFreeSlots(settings, busy, NOW);
    const alternatives = nearestAlternatives(requested, TZ, free, 3);

    expect(alternatives).toHaveLength(3);
    // Nenhuma alternativa pode ser o próprio horário ocupado.
    const requestedUtc = DateTime.fromISO(requested, { zone: TZ }).toUTC().toISO();
    expect(alternatives.some((s) => s.start === requestedUtc)).toBe(false);
    // As mais próximas de 14:00 devem ser 13:45 e 14:15.
    const starts = alternatives.map((s) => DateTime.fromISO(s.start).setZone(TZ).toFormat('HH:mm'));
    expect(starts).toContain('13:45');
    expect(starts).toContain('14:15');
  });
});

describe('pedido fora do expediente', () => {
  it('rejeita horário após o fim do expediente', () => {
    const requested = '2026-10-20T20:00:00'; // terça 20:00, expediente vai até 18:00
    const check = checkRequestedSlot(settings, requested, [], NOW);
    expect(check.withinWorkingHours).toBe(false);
    expect(check.bookable).toBe(false);
  });

  it('rejeita horário em dia não atendido (sábado)', () => {
    const requested = '2026-10-24T10:00:00'; // sábado
    const check = checkRequestedSlot(settings, requested, [], NOW);
    expect(check.withinWorkingHours).toBe(false);
    expect(check.bookable).toBe(false);
  });

  it('rejeita horário dentro do almoço (janela fechada 12:00–13:00)', () => {
    const requested = '2026-10-20T12:30:00';
    const check = checkRequestedSlot(settings, requested, [], NOW);
    expect(check.withinWorkingHours).toBe(false);
    expect(check.bookable).toBe(false);
  });

  it('oferece alternativas mesmo quando o pedido está fora do expediente', () => {
    const requested = '2026-10-20T20:00:00';
    const free = generateFreeSlots(settings, [], NOW);
    const alternatives = nearestAlternatives(requested, TZ, free, 3);
    expect(alternatives.length).toBe(3);
    // Todas as alternativas são, por construção, horários livres e válidos.
    for (const slot of alternatives) {
      const c = checkRequestedSlot(
        settings,
        DateTime.fromISO(slot.start).setZone(TZ).toISO()!,
        [],
        NOW,
      );
      expect(c.bookable).toBe(true);
    }
  });
});
