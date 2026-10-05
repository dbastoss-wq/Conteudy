const token = process.env.TELEGRAM_BOT_TOKEN;
const url = process.env.WEBHOOK_URL;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
if (!token || !url) {
  console.error("Defina TELEGRAM_BOT_TOKEN e WEBHOOK_URL");
  process.exit(1);
}
const body = new URLSearchParams({
  url,
  allowed_updates: JSON.stringify(["message"]),
  drop_pending_updates: "true",
});
if (secret) body.set("secret_token", secret);
const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, { method: "POST", body });
console.log(await res.text());
