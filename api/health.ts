import { aiMode } from "../src/lib/sabia/ask.server.js";
import { tokenShape } from "../src/lib/telegram/token.server.js";

export default async function handler(_req: any, res: any) {
  res.status(200).json({
    ok: true,
    telegram: tokenShape(),
    ia: await aiMode(),
  });
}
