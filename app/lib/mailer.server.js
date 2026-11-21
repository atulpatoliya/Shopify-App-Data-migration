import nodemailer from "nodemailer";

let transport = null;

export const mailConfigured = () => Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

function getTransport() {
  if (!transport) {
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 465),
      secure: String(process.env.SMTP_SECURE ?? "true") === "true",
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return transport;
}

export async function sendMail({ to, subject, text, attachments }) {
  if (!mailConfigured()) throw new Error("Email (SMTP) is not configured on the server");
  await getTransport().sendMail({
    from: `"Bulk Migration & VIP Pricing" <${process.env.SMTP_USER}>`,
    to,
    subject,
    text,
    attachments,
  });
}
