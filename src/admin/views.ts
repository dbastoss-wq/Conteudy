import { DateTime } from 'luxon';
import type { AppSettings, Conversation, StoredMessage, AppointmentView } from '../db/repositories.js';
import type { ConversationState } from '../domain/types.js';

export function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const STATE_LABELS: Record<ConversationState, string> = {
  NOVO: 'Novo',
  AGUARDANDO_INFO: 'Aguardando horário',
  PROPOSTA_HORARIOS: 'Aguardando horário',
  AGUARDANDO_NOME: 'Aguardando horário',
  AGUARDANDO_CONFIRMACAO: 'Aguardando confirmação',
  AGENDANDO: 'Agendando',
  AGUARDANDO_PAGAMENTO: 'Aguardando pagamento',
  CONCLUIDO: 'Concluído',
  URGENCIA: 'Urgência',
  TRANSFERIDO: 'Transferido para o médico',
};

export function stateLabel(s: ConversationState): string {
  return STATE_LABELS[s] ?? s;
}

function fmt(iso: string | null | undefined, tz: string): string {
  if (!iso) return '—';
  return DateTime.fromISO(iso).setZone(tz).setLocale('pt-BR').toFormat("dd/LL/yyyy HH:mm");
}

export function layout(title: string, body: string, user?: string): string {
  return `<!doctype html>
<html lang="pt-BR"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Secretária Virtual</title>
<style>
  :root { color-scheme: light dark; --bg:#f6f7f9; --card:#fff; --line:#e3e6ea; --txt:#1a1d21; --muted:#6b7280; --accent:#2563eb; }
  @media (prefers-color-scheme: dark){ :root{ --bg:#15181c; --card:#1e2228; --line:#2c323a; --txt:#e8eaed; --muted:#9aa4b2; } }
  *{box-sizing:border-box} body{margin:0;font:15px/1.5 system-ui,sans-serif;background:var(--bg);color:var(--txt)}
  header{background:var(--card);border-bottom:1px solid var(--line);padding:12px 20px;display:flex;gap:16px;align-items:center}
  header a{color:var(--txt);text-decoration:none;font-weight:600} header a.sub{font-weight:400;color:var(--muted)}
  header .spacer{flex:1}
  main{max-width:960px;margin:24px auto;padding:0 16px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;margin-bottom:16px}
  table{width:100%;border-collapse:collapse} th,td{text-align:left;padding:8px 6px;border-bottom:1px solid var(--line);font-size:14px}
  th{color:var(--muted);font-weight:600}
  .badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;background:#eef2ff;color:#3730a3}
  .badge.urg{background:#fee2e2;color:#991b1b} .badge.pay{background:#fef3c7;color:#92400e} .badge.ok{background:#dcfce7;color:#166534}
  .btn{display:inline-block;padding:8px 14px;border-radius:8px;border:1px solid var(--line);background:var(--accent);color:#fff;text-decoration:none;cursor:pointer;font-size:14px}
  .btn.sec{background:transparent;color:var(--txt)}
  input,textarea,select{width:100%;padding:8px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--txt);font:inherit}
  label{display:block;margin:10px 0 4px;color:var(--muted);font-size:13px}
  .msg{padding:8px 12px;border-radius:10px;margin:6px 0;max-width:80%}
  .msg.in{background:var(--bg);border:1px solid var(--line)} .msg.out{background:#dbeafe;margin-left:auto;color:#0b2a66}
  .row{display:flex;gap:10px;flex-wrap:wrap} .row>div{flex:1;min-width:180px}
  h1{font-size:20px} h2{font-size:16px}
  form.inline{display:inline}
</style></head><body>
<header>
  <a href="/admin">Secretária Virtual</a>
  <a class="sub" href="/admin">Conversas</a>
  <a class="sub" href="/admin/agendamentos">Agendamentos</a>
  <a class="sub" href="/admin/config">Configurações</a>
  <span class="spacer"></span>
  ${user ? `<span class="sub">${esc(user)}</span> <form class="inline" method="post" action="/admin/logout"><button class="btn sec">Sair</button></form>` : ''}
</header>
<main>${body}</main></body></html>`;
}

export function loginPage(error?: string): string {
  return layout(
    'Entrar',
    `<div class="card" style="max-width:360px;margin:40px auto">
      <h1>Entrar</h1>
      ${error ? `<p style="color:#b91c1c">${esc(error)}</p>` : ''}
      <form method="post" action="/admin/login">
        <label>E-mail</label><input name="email" type="email" required>
        <label>Senha</label><input name="password" type="password" required>
        <div style="margin-top:16px"><button class="btn" type="submit">Entrar</button></div>
      </form>
    </div>`,
  );
}

export function conversationsPage(convs: Conversation[], tz: string, user: string): string {
  const rows = convs
    .map((c) => {
      const badgeCls = c.state === 'URGENCIA' ? 'urg' : c.state === 'AGUARDANDO_PAGAMENTO' ? 'pay' : '';
      return `<tr>
        <td><a href="/admin/conversas/${esc(c.id)}">${esc(c.patientName ?? c.phone)}</a></td>
        <td>${esc(c.phone)}</td>
        <td><span class="badge ${badgeCls}">${esc(stateLabel(c.state))}</span>${c.botPaused ? ' <span class="badge">bot pausado</span>' : ''}</td>
        <td>${fmt(c.lastMessageAt, tz)}</td>
      </tr>`;
    })
    .join('');
  return layout(
    'Conversas',
    `<h1>Conversas</h1>
     <div class="card"><table>
       <tr><th>Paciente</th><th>Telefone</th><th>Status</th><th>Última mensagem</th></tr>
       ${rows || '<tr><td colspan="4">Nenhuma conversa ainda.</td></tr>'}
     </table></div>`,
    user,
  );
}

export function conversationDetailPage(
  conv: Conversation,
  messages: StoredMessage[],
  tz: string,
  user: string,
): string {
  const bubbles = messages
    .map(
      (m) =>
        `<div class="msg ${m.direction === 'inbound' ? 'in' : 'out'}">${esc(m.body)}<div style="font-size:11px;color:var(--muted);margin-top:4px">${fmt(m.createdAt, tz)}</div></div>`,
    )
    .join('');
  const pauseBtn = conv.botPaused
    ? `<form class="inline" method="post" action="/admin/conversas/${esc(conv.id)}/retomar"><button class="btn">Devolver ao bot</button></form>`
    : `<form class="inline" method="post" action="/admin/conversas/${esc(conv.id)}/pausar"><button class="btn sec">Pausar bot e assumir</button></form>`;
  return layout(
    conv.patientName ?? conv.phone,
    `<a href="/admin">← Conversas</a>
     <div class="card">
       <h1>${esc(conv.patientName ?? conv.phone)}</h1>
       <p>${esc(conv.phone)} · <span class="badge">${esc(stateLabel(conv.state))}</span> ${conv.botPaused ? '<span class="badge">bot pausado</span>' : ''}</p>
       <p><strong>Motivo:</strong> ${esc(conv.collected.motivo ?? '—')}</p>
       ${pauseBtn}
     </div>
     <div class="card" style="display:flex;flex-direction:column">${bubbles || 'Sem mensagens.'}</div>`,
    user,
  );
}

export function appointmentsPage(appts: AppointmentView[], tz: string, user: string): string {
  const payBadge = (a: AppointmentView) => {
    if (a.paymentStatus === 'comprovante_recebido') return '<span class="badge ok">Comprovante recebido</span>';
    if (a.paymentStatus === 'cartao_com_medico') return '<span class="badge pay">Cartão (com o médico)</span>';
    if (a.paymentStatus === 'aguardando_comprovante') return '<span class="badge pay">Aguardando comprovante</span>';
    return '<span class="badge">Pendente</span>';
  };
  const rows = appts
    .map(
      (a) => `<tr>
        <td>${fmt(a.startAt, tz)}</td>
        <td>${esc(a.patientName)}</td>
        <td>${esc(a.phone)}</td>
        <td>${esc(a.reason)}</td>
        <td>${esc(a.paymentMethod ?? '—')}</td>
        <td>${payBadge(a)}</td>
      </tr>`,
    )
    .join('');
  return layout(
    'Agendamentos',
    `<h1>Consultas agendadas</h1>
     <div class="card"><table>
       <tr><th>Quando</th><th>Paciente</th><th>Telefone</th><th>Motivo</th><th>Pagamento</th><th>Status</th></tr>
       ${rows || '<tr><td colspan="6">Nenhuma consulta agendada.</td></tr>'}
     </table></div>`,
    user,
  );
}

export function settingsPage(s: AppSettings, user: string, saved: boolean): string {
  const days = s.scheduling.workingDays;
  const dayNames = [
    [1, 'Seg'],
    [2, 'Ter'],
    [3, 'Qua'],
    [4, 'Qui'],
    [5, 'Sex'],
    [6, 'Sáb'],
    [7, 'Dom'],
  ] as const;
  const dayChecks = dayNames
    .map(
      ([n, label]) =>
        `<label style="display:inline-flex;gap:6px;align-items:center;margin-right:12px"><input type="checkbox" style="width:auto" name="workingDays" value="${n}" ${days.includes(n) ? 'checked' : ''}> ${label}</label>`,
    )
    .join('');
  // Janela única editável (início/fim) aplicada a todos os dias úteis, para simplicidade do painel.
  const firstDay = days[0] ?? 1;
  const win = s.scheduling.windows[firstDay]?.[0] ?? { start: '08:00', end: '18:00' };
  const lunch = s.scheduling.windows[firstDay]?.[1];
  return layout(
    'Configurações',
    `<h1>Configurações de atendimento</h1>
     ${saved ? '<div class="card" style="border-color:#16a34a">Configurações salvas ✓</div>' : ''}
     <form method="post" action="/admin/config">
       <div class="card">
         <h2>Agenda</h2>
         <label>Dias de atendimento</label><div>${dayChecks}</div>
         <div class="row">
           <div><label>Início da manhã</label><input name="winStart" value="${esc(win.start)}"></div>
           <div><label>Fim (manhã, antes do almoço)</label><input name="lunchStart" value="${esc(lunch ? win.end : '')}" placeholder="opcional, ex. 12:00"></div>
         </div>
         <div class="row">
           <div><label>Retorno do almoço</label><input name="lunchEnd" value="${esc(lunch?.start ?? '')}" placeholder="opcional, ex. 13:00"></div>
           <div><label>Fim do expediente</label><input name="winEnd" value="${esc(lunch?.end ?? win.end)}"></div>
         </div>
         <div class="row">
           <div><label>Duração da consulta (min)</label><input name="duration" type="number" value="${s.scheduling.slotDurationMinutes}"></div>
           <div><label>Intervalo entre consultas (min)</label><input name="buffer" type="number" value="${s.scheduling.bufferMinutes}"></div>
           <div><label>Antecedência mínima (min)</label><input name="minLead" type="number" value="${s.scheduling.minLeadMinutes}"></div>
         </div>
         <label>ID da agenda do Google</label><input name="googleCalendarId" value="${esc(s.googleCalendarId)}">
       </div>
       <div class="card">
         <h2>Mensagens</h2>
         <label>Apresentação (primeiro contato)</label><textarea name="introMsg" rows="6">${esc(s.messages.intro)}</textarea>
         <label>Pagamento (após agendar)</label><textarea name="paymentMsg" rows="4">${esc(s.messages.payment)}</textarea>
       </div>
       <button class="btn" type="submit">Salvar</button>
     </form>`,
    user,
  );
}
