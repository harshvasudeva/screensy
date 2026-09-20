import assert from "node:assert/strict";
import { test } from "node:test";
import { createHmac } from "crypto";
import { isUsableTurnSecret, mintTurnCredentials } from "./turn";

test("rejects placeholder TURN secrets", () => {
    assert.equal(isUsableTurnSecret(""), false);
    assert.equal(isUsableTurnSecret("screensy-change-me-in-production"), false);
    assert.equal(isUsableTurnSecret("unit-test-secret-not-for-production"), true);
});

test("mints coturn REST-style HMAC-SHA1 credentials", () => {
    const secret = "test-secret";
    const now = 1_700_000_000;
    const minted = mintTurnCredentials(secret, 3600, now);
    assert.equal(minted.username, "1700003600:screensy");
    assert.equal(
        minted.credential,
        createHmac("sha1", secret).update(minted.username).digest("base64")
    );
});
