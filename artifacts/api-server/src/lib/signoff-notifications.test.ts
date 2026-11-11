import assert from "node:assert/strict";
import test from "node:test";
import { createOutlookMailBody, createOutlookResultMailBody } from "./signoff-notifications";

test("sign-off emails address one signer and disclose only request type and authenticated link", () => {
  const body = createOutlookMailBody({
    recipient: "signer@example.test",
    requestKind: "Transfer",
    requestUrl: "https://app.example.test/sign-off-requests/request-123",
  });
  const content = `${body.message.subject}\n${body.message.body.content}`;
  assert.deepEqual(body.message.toRecipients, [{ emailAddress: { address: "signer@example.test" } }]);
  assert.equal("ccRecipients" in body.message, false);
  assert.equal("bccRecipients" in body.message, false);
  assert.match(body.message.body.content, /request-123/);
  assert.doesNotMatch(content, /certificate C-|shares|SSN|attachment|date of birth|address|phone/i);
  assert.equal(body.saveToSentItems, true);
});

test("requester result emails contain only the request type, outcome and authenticated app link", () => {
  for (const [requestKind, outcome, typeText] of [
    ["Transfer", "Approved", "Share transfer"],
    ["Issuance", "Rejected", "Certificate issuance"],
  ] as const) {
    const body = createOutlookResultMailBody({
      recipient: "requester@example.test", requestKind, outcome,
      requestUrl: "https://app.example.test/sign-off-requests/request-456",
    });
    const content = `${body.message.subject}\n${body.message.body.content}`;
    assert.deepEqual(body.message.toRecipients, [{ emailAddress: { address: "requester@example.test" } }]);
    assert.equal("ccRecipients" in body.message, false);
    assert.equal("bccRecipients" in body.message, false);
    assert.match(body.message.subject, new RegExp(typeText));
    assert.match(body.message.subject, new RegExp(outcome));
    assert.equal(body.message.body.content, `${typeText} request ${outcome.toLowerCase()}.\n\nhttps://app.example.test/sign-off-requests/request-456`);
    assert.doesNotMatch(content, /certificate C-|shares|SSN|attachment|date of birth|address|phone|signer/i);
  }
});
