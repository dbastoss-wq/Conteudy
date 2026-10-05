import { tokenShape } from "../src/lib/telegram/token.server.js";

export default function handler(_req: any, res: any) {
  res.status(200).json({
    ok: true,
    telegram: tokenShape(),
    sabia: Boolean(process.env.SABIA_API_KEY),
  });
}
