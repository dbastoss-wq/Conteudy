/**
 * Fila serial POR CHAVE (telefone do paciente). Mensagens da mesma conversa são
 * processadas uma de cada vez, em ordem — então duas mensagens quase simultâneas
 * do mesmo paciente não disparam dois agendamentos. (A trava de slot cuida da
 * corrida ENTRE conversas/instâncias diferentes.)
 */
const chains = new Map<string, Promise<void>>();

export function enqueue(key: string, task: () => Promise<void>): void {
  const prev = chains.get(key) ?? Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(() => task())
    .catch((err) => console.error(`[worker] erro ao processar ${key}:`, err));
  chains.set(key, next);
  void next.finally(() => {
    if (chains.get(key) === next) chains.delete(key);
  });
}

/** Aguarda esvaziar a fila de uma chave (usado em testes/simulador). */
export async function drain(key: string): Promise<void> {
  const p = chains.get(key);
  if (p) await p;
}

/** Aguarda todas as filas (usado no simulador). */
export async function drainAll(): Promise<void> {
  await Promise.all([...chains.values()].map((p) => p.catch(() => {})));
}
