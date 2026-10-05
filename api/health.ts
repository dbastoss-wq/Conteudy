export default function handler(_req: any, res: any) {
  res.status(200).json({
    ok: true,
    telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    sabia: Boolean(process.env.SABIA_API_KEY),
  });
}
