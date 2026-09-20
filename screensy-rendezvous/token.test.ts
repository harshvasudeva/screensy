import assert from "node:assert/strict";
import { test } from "node:test";
import { presenterTokenDigest, presenterTokenMatches } from "./token";

test("presenter tokens compare in constant time via SHA-256 digest", () => {
    const token = "fedcba9876543210fedcba9876543210";
    const digest = presenterTokenDigest(token);
    assert.equal(presenterTokenMatches(token, digest), true);
    assert.equal(presenterTokenMatches("0".repeat(32), digest), false);
});
