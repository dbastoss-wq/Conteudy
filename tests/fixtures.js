'use strict';
// Dados de teste fictícios (empresa, contatos e mensagens inventados).

const b64 = s => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function gmailMessage({ id = 'msg-1', threadId = 'thread-1', from = 'Maria Souza <maria@cliente.com.br>', subject = 'Orçamento',
  text = 'Olá, gostaria de saber o horário de atendimento.', headers = [], labelIds = ['INBOX', 'UNREAD'], messageId = '<orig-1@cliente.com.br>' } = {}) {
  return {
    id, threadId, labelIds, snippet: text.slice(0, 50), internalDate: String(Date.now()),
    payload: {
      mimeType: 'multipart/alternative',
      headers: [
        { name: 'From', value: from }, { name: 'To', value: 'Atendimento <atendimento@empresa.com.br>' },
        { name: 'Subject', value: subject }, { name: 'Message-ID', value: messageId }, ...headers,
      ],
      parts: [
        { mimeType: 'text/plain', body: { data: b64(text), size: text.length } },
        { mimeType: 'text/html', body: { data: b64(`<p>${text}</p>`) } },
      ],
    },
  };
}

function settings() {
  return {
    company: { name: 'Empresa Exemplo', description: 'Consultoria de testes.' },
    agent: { name: 'Ana', email: 'atendimento@empresa.com.br', aliases: [], message_id_domain: 'empresa.com.br' },
    timezone: 'America/Sao_Paulo',
    meeting_types: [{ key: 'reuniao_inicial', name: 'Reunião inicial', duration_min: 30, purpose: 'Entender a necessidade',
      scheduling_url: 'https://calendly.com/empresa-exemplo/reuniao-inicial', event_type_uri: 'https://api.calendly.com/event_types/ET1' }],
    escalation: { contact_email: 'responsavel@empresa.com.br', contact_name: 'Responsável' },
    alert_email: 'alertas@empresa.com.br',
    internal_addresses: ['responsavel@empresa.com.br', 'alertas@empresa.com.br'],
    internal_domains: ['empresa.com.br'],
    ignore_sender_domains: ['calendly.com'],
    allowed_url_prefixes: ['https://calendly.com/', 'https://empresa.com.br/'],
    signature: 'Ana\nAtendimento Empresa Exemplo',
    escalation_ack: 'Recebemos sua mensagem e ela foi encaminhada para a nossa equipe, que vai responder por aqui.',
    knowledge_base: '# Base\n- Horário: segunda a sexta, das 9h às 18h.\n- Consulta avulsa: R$ 350,00.\n',
    gmail: { query: 'in:inbox -from:me -label:agente-processado newer_than:7d', max_per_run: 20,
      labels: { processado: 'agente-processado', escalado: 'agente-escalado', ignorado: 'agente-ignorado', erro: 'agente-erro' } },
    limits: { max_attempts: 3, lock_minutes: 15, min_confidence: 0.6, max_reply_chars: 2500, max_auto_replies_per_thread_24h: 4, max_auto_replies_per_sender_24h: 8 },
    ai: { model: 'claude-opus-5-5', effort: 'medium', max_tokens: 4000, fallbacks: true },
    api: { gmail_base: 'https://gmail.googleapis.com', calendly_base: 'https://api.calendly.com', anthropic_base: 'https://api.anthropic.com' },
  };
}

module.exports = { gmailMessage, settings, b64 };
