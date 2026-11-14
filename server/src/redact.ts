import type { NextFunction, Request, Response } from "express";

/**
 * Keeps secrets out of everything the browser receives. Every API response body is scanned for the
 * values of secret-looking .env variables (…KEY, …SECRET, …TOKEN, …PASSWORD) and those values are
 * replaced with "[redacted]". The routes never send keys on purpose; this guards against an upstream
 * error message that echoes one, which the UI would otherwise display.
 *
 * Short-lived tokens the browser needs by design (Anam session token, Scribe single-use token) are
 * minted per request, are not in .env, and pass through untouched.
 */
const SECRET_NAME = /(KEY|SECRET|TOKEN|PASSWORD)/i;

function secretValues(): string[] {
  return Object.entries(process.env)
    .filter(([name, value]) => SECRET_NAME.test(name) && value && value.trim().length >= 8)
    .map(([, value]) => value!.trim());
}

export function redact(text: string, secrets = secretValues()): string {
  let out = text;
  for (const s of secrets) if (out.includes(s)) out = out.split(s).join("[redacted]");
  return out;
}

export function redactSecrets(_req: Request, res: Response, next: NextFunction) {
  const secrets = secretValues();
  if (!secrets.length) return next();
  // res.json() stringifies and then calls res.send(), so this covers every JSON response.
  const send = res.send.bind(res);
  res.send = (body?: unknown) => send(typeof body === "string" ? redact(body, secrets) : body);
  next();
}
