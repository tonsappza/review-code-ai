import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import { verifyWebhookSignature } from "../src/github-app/verify.js";

describe("verifyWebhookSignature", () => {
  it("accepts valid sha256 signature", () => {
    const secret = "test-secret";
    const payload = '{"action":"opened"}';
    const hex = createHmac("sha256", secret).update(payload).digest("hex");
    assert.equal(
      verifyWebhookSignature({
        secret,
        payload,
        signatureHeader: `sha256=${hex}`,
      }),
      true,
    );
  });

  it("rejects wrong signature", () => {
    assert.equal(
      verifyWebhookSignature({
        secret: "a",
        payload: "{}",
        signatureHeader: "sha256=deadbeef",
      }),
      false,
    );
  });
});
