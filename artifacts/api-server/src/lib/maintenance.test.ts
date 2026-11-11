import assert from "node:assert/strict";
import test from "node:test";
import request from "supertest";
import app from "../app";

test("read-only maintenance mode allows reads and rejects every write method", async () => {
  const previous = process.env.MAINTENANCE_READ_ONLY;
  process.env.MAINTENANCE_READ_ONLY = "true";
  try {
    await request(app).get("/api/auth/user").expect(200, { user: null });
    const response = await request(app).post("/api/auth/callback").expect(503);
    assert.equal(response.headers["retry-after"], "60");
    assert.match(response.body.error, /temporarily read-only/);
    await request(app).delete("/api/does-not-exist").expect(503);
  } finally {
    if (previous === undefined) delete process.env.MAINTENANCE_READ_ONLY;
    else process.env.MAINTENANCE_READ_ONLY = previous;
  }
});
