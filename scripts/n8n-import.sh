#!/bin/sh
# Importa (ou atualiza) os workflows no n8n e publica os que devem ficar ativos.
# Rode com o n8n PARADO (ou reinicie depois). No Docker:
#   docker compose stop n8n && docker compose run --rm --entrypoint sh n8n /agente/scripts/n8n-import.sh && docker compose up -d n8n
# Os JSON em workflows/ são gerados por `node scripts/build-workflows.js` (rode após alterar src/ ou prompts/).
# Uso: scripts/n8n-import.sh [--sem-agendamentos]
#   --sem-agendamentos  não publica polling e reconciliação (útil em testes, que os executam via CLI)
set -eu
cd "$(dirname "$0")/.."

n8n import:workflow --separate --input=workflows

# Subfluxos e o fluxo de erro precisam estar publicados para serem chamados.
PUBLICAR="AgEnviarEmail001 AgProcessarMsg01 AgAlertas0000001 AgCalendlyHook01"
if [ "${1:-}" != "--sem-agendamentos" ]; then
  PUBLICAR="$PUBLICAR AgCaixaEntrada01 AgReconciliar001"
fi
for id in $PUBLICAR; do
  n8n publish:workflow --id="$id"
done
echo "Workflows importados e publicados: $PUBLICAR. Reinicie o n8n para aplicar."
