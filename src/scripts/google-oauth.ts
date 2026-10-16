import http from 'node:http';
import { URL } from 'node:url';
import { google } from 'googleapis';
import { loadConfig } from '../config.js';

/**
 * Gera o GOOGLE_REFRESH_TOKEN uma única vez.
 *
 * Pré-requisitos:
 *  - GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET definidos no .env;
 *  - GOOGLE_OAUTH_REDIRECT_URI apontando para http://localhost:<porta>/oauth/google/callback
 *    e cadastrado como "URI de redirecionamento autorizado" no Console do Google.
 *
 * Rode: npm run oauth:google — abra a URL impressa, autorize, e o refresh token
 * aparece no terminal. Copie-o para GOOGLE_REFRESH_TOKEN.
 */
const SCOPES = ['https://www.googleapis.com/auth/calendar'];

function main(): void {
  const cfg = loadConfig();
  const redirect = new URL(cfg.GOOGLE_OAUTH_REDIRECT_URI);
  const port = Number(redirect.port || 80);

  const client = new google.auth.OAuth2(cfg.GOOGLE_CLIENT_ID, cfg.GOOGLE_CLIENT_SECRET, cfg.GOOGLE_OAUTH_REDIRECT_URI);
  const authUrl = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  });

  const server = http.createServer(async (req, res) => {
    if (!req.url?.startsWith(redirect.pathname)) {
      res.writeHead(404).end();
      return;
    }
    const code = new URL(req.url, `http://localhost:${port}`).searchParams.get('code');
    if (!code) {
      res.writeHead(400).end('Faltou o code.');
      return;
    }
    try {
      const { tokens } = await client.getToken(code);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h2>Pronto! Pode fechar esta aba e voltar ao terminal.</h2>');
      console.log('\n==============================================');
      console.log('GOOGLE_REFRESH_TOKEN=' + (tokens.refresh_token ?? '(não retornado — revogue o acesso e tente de novo com prompt=consent)'));
      console.log('==============================================\n');
      server.close();
      process.exit(0);
    } catch (err) {
      res.writeHead(500).end('Erro ao trocar o code.');
      console.error(err);
      server.close();
      process.exit(1);
    }
  });

  server.listen(port, () => {
    console.log(`Servidor temporário em http://localhost:${port}`);
    console.log('\nAbra esta URL no navegador e autorize:\n');
    console.log(authUrl + '\n');
  });
}

main();
