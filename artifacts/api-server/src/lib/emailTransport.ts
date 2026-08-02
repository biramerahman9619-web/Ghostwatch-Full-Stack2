/**
 * Shared SMTP transport for the API server.
 * Both ghostspere.ts and portal.ts import from here — avoids duplicating
 * the lazy-init + credential-check logic.
 */

import nodemailer from "nodemailer";

let _transport: nodemailer.Transporter | null = null;

export function isSmtpConfigured(): boolean {
  return !!(
    process.env["SMTP_HOST"] &&
    process.env["SMTP_USER"] &&
    process.env["SMTP_PASS"]
  );
}

export function getTransport(): nodemailer.Transporter {
  if (!_transport) {
    const port = Number(process.env["SMTP_PORT"] ?? "587");
    _transport = nodemailer.createTransport({
      host: process.env["SMTP_HOST"],
      port,
      secure: port === 465,
      auth: {
        user: process.env["SMTP_USER"],
        pass: process.env["SMTP_PASS"],
      },
    });
  }
  return _transport;
}
