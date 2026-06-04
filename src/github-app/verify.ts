import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyWebhookSignature(input: {
  secret: string;
  payload: string;
  signatureHeader: string | undefined;
}): boolean {
  const sig = input.signatureHeader?.trim();
  if (!sig?.startsWith("sha256=")) return false;

  const expected = createHmac("sha256", input.secret)
    .update(input.payload, "utf8")
    .digest("hex");

  const received = sig.slice("sha256=".length);
  try {
    return timingSafeEqual(
      Buffer.from(expected, "hex"),
      Buffer.from(received, "hex"),
    );
  } catch {
    return false;
  }
}
