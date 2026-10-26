// Disparada automaticamente pelo Netlify a cada pedido aprovado (não spam) do formulário
// "agendamento-dr-daniel". Envia o pedido para o WhatsApp do secretário.
// Os e-mails são enviados pelas notificações nativas do Netlify Forms (veja AGENDAMENTO.md).
//
// Variáveis de ambiente (Netlify → Site configuration → Environment variables, escopo "Functions"):
//   WHATSAPP_PROVEDOR      "meta" (API oficial do WhatsApp Cloud) ou "callmebot"
//   WHATSAPP_DESTINO       número(s) que recebem o aviso, só dígitos com 55 + DDD. Vários: separe por vírgula.
//   Meta:      META_WHATSAPP_TOKEN, META_PHONE_NUMBER_ID, META_TEMPLATE (ex.: novo_agendamento),
//              META_TEMPLATE_IDIOMA (padrão pt_BR), META_API_VERSAO (padrão v23.0)
//   CallMeBot: CALLMEBOT_APIKEY (uma por número, na mesma ordem de WHATSAPP_DESTINO)

const FORMULARIO = 'agendamento-dr-daniel';
const FUSO = 'America/Sao_Paulo';
const DURACAO_MIN = 30;
const MEDICO = 'Dr. Daniel Cardoso de Bastos';
const SEMANA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

const pad = (n) => String(n).padStart(2, '0');
// Texto vindo do formulário: sem quebras de linha nem caracteres de controle, tamanho limitado
const limpar = (v, max = 120) => String(v ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, max);
const lista = (v) => String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean);

// Valida os dados do pedido e remonta os links aqui no servidor (não confia nos links enviados pelo navegador)
export function montarPedido(dados = {}) {
  const nome = limpar(dados.nome);
  const whatsapp = limpar(dados.whatsapp, 20);
  const horario = limpar(dados.horario, 5);
  const data = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(limpar(dados.data, 40));
  if (nome.length < 3 || !/^\(\d{2}\) 9\d{4}-\d{4}$/.test(whatsapp) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(horario) || !data) return null;

  const [, dd, mm, aaaa] = data;
  const dia = new Date(Date.UTC(+aaaa, +mm - 1, +dd));
  if (dia.getUTCDate() !== +dd || dia.getUTCMonth() !== +mm - 1) return null;

  const digitos = '55' + whatsapp.replace(/\D/g, '');
  const diaSemana = SEMANA[dia.getUTCDay()];
  const dataTexto = `${diaSemana}, ${dd}/${mm}/${aaaa}`;
  const dataLonga = `${diaSemana}, ${+dd} de ${MESES[+mm - 1]}`;

  const [h, m] = horario.split(':').map(Number);
  const fim = h * 60 + m + DURACAO_MIN;
  const carimbo = (hh, mi) => `${aaaa}${mm}${dd}T${pad(hh)}${pad(mi)}00`;
  const agenda = 'https://calendar.google.com/calendar/render?' + new URLSearchParams({
    action: 'TEMPLATE',
    text: `Consulta · ${nome}`,
    dates: `${carimbo(h, m)}/${carimbo(Math.floor(fim / 60), fim % 60)}`,
    ctz: FUSO,
    details: `Pedido de agendamento feito pelo site.\nPaciente: ${nome}\nWhatsApp: ${whatsapp} · https://wa.me/${digitos}`
  }).toString();
  const responder = `https://wa.me/${digitos}?text=` + encodeURIComponent(
    `Olá, ${nome.split(' ')[0]}! Aqui é da equipe do ${MEDICO}. Recebemos seu pedido de consulta para ${dataLonga}, às ${horario}.`
  );

  return { nome, whatsapp, horario, dataTexto, agenda, responder };
}

export function mensagemTexto(p) {
  return [
    '*Novo pedido de agendamento pelo site*',
    '',
    `Paciente: ${p.nome}`,
    `WhatsApp: ${p.whatsapp}`,
    `Dia: ${p.dataTexto}`,
    `Horário: ${p.horario} (horário de Brasília)`,
    '',
    `Responder ao paciente: ${p.responder}`,
    '',
    `Adicionar ao Google Agenda: ${p.agenda}`
  ].join('\n');
}

async function enviarMeta(destino, p, env) {
  const versao = env.META_API_VERSAO || 'v23.0';
  const corpo = env.META_TEMPLATE
    ? {
        messaging_product: 'whatsapp', to: destino, type: 'template',
        template: {
          name: env.META_TEMPLATE,
          language: { code: env.META_TEMPLATE_IDIOMA || 'pt_BR' },
          components: [{
            type: 'body',
            parameters: [p.nome, p.whatsapp, p.dataTexto, p.horario, p.responder].map((text) => ({ type: 'text', text }))
          }]
        }
      }
    // Sem modelo aprovado, a Meta só entrega texto livre se o destino falou com o número da clínica nas últimas 24 h
    : { messaging_product: 'whatsapp', to: destino, type: 'text', text: { body: mensagemTexto(p), preview_url: false } };

  const r = await fetch(`https://graph.facebook.com/${versao}/${env.META_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.META_WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(10000)
  });
  if (!r.ok) throw new Error(`Meta respondeu ${r.status}: ${(await r.text()).slice(0, 300)}`);
}

async function enviarCallMeBot(destino, apikey, p) {
  if (!apikey) throw new Error('CALLMEBOT_APIKEY ausente para ' + destino);
  const url = 'https://api.callmebot.com/whatsapp.php?' + new URLSearchParams({ phone: '+' + destino, text: mensagemTexto(p), apikey });
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  const texto = await r.text();
  if (!r.ok || /error|invalid|not\s+allowed/i.test(texto)) throw new Error(`CallMeBot respondeu ${r.status}: ${texto.replace(/<[^>]+>/g, ' ').slice(0, 300)}`);
}

export async function enviarWhatsApp(p, env = process.env) {
  const provedor = String(env.WHATSAPP_PROVEDOR || '').toLowerCase();
  const destinos = lista(env.WHATSAPP_DESTINO).map((n) => n.replace(/\D/g, ''));
  if (!provedor || !destinos.length) return { enviados: 0, erros: [], naoConfigurado: true };
  if (provedor === 'meta' && (!env.META_WHATSAPP_TOKEN || !env.META_PHONE_NUMBER_ID)) {
    return { enviados: 0, erros: ['Faltam META_WHATSAPP_TOKEN ou META_PHONE_NUMBER_ID'] };
  }
  const chaves = lista(env.CALLMEBOT_APIKEY);
  const envios = destinos.map((destino, i) => {
    if (provedor === 'meta') return enviarMeta(destino, p, env);
    if (provedor === 'callmebot') return enviarCallMeBot(destino, chaves[i], p);
    return Promise.reject(new Error(`WHATSAPP_PROVEDOR desconhecido: ${provedor}`));
  });
  const resultados = await Promise.allSettled(envios);
  return {
    enviados: resultados.filter((r) => r.status === 'fulfilled').length,
    erros: resultados.filter((r) => r.status === 'rejected').map((r) => String(r.reason?.message || r.reason))
  };
}

// O nome do arquivo (submission-created) faz o Netlify chamar esta função a cada envio verificado.
// O Netlify assina o evento e confere a assinatura antes de chamar a função; requisições externas não chegam aqui.
export default async (req) => {
  let corpo;
  try { corpo = await req.json(); } catch { return new Response('Corpo inválido', { status: 400 }); }
  const payload = corpo?.payload ?? corpo ?? {};
  const formulario = payload.form_name ?? payload.formName ?? payload.form?.name;
  if (formulario && formulario !== FORMULARIO) return new Response('Outro formulário: ignorado');

  const pedido = montarPedido(payload.data);
  if (!pedido) {
    console.warn('Pedido com dados inválidos; WhatsApp não enviado.', { id: payload.id });
    return new Response('Dados inválidos: ignorado');
  }

  const { enviados, erros, naoConfigurado } = await enviarWhatsApp(pedido);
  if (naoConfigurado) {
    console.warn('WhatsApp não configurado: defina WHATSAPP_PROVEDOR e WHATSAPP_DESTINO no Netlify.', { id: payload.id });
    return new Response('WhatsApp não configurado');
  }
  // Sem dados do paciente nos logs (LGPD): só contagem e erros técnicos
  if (erros.length) console.error('Falha no aviso por WhatsApp', { id: payload.id, enviados, erros });
  else console.log('Aviso por WhatsApp enviado', { id: payload.id, enviados });
  return new Response(erros.length ? erros.join(' | ') : 'ok', { status: erros.length && !enviados ? 502 : 200 });
};
