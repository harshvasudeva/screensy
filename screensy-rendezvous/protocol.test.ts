import assert from "node:assert/strict";
import { test } from "node:test";
import {
    isJoinMessage,
    isValidRoomId,
    isValidPresenterToken,
    isWebRtcKind,
    isBroadcasterWebRtcMessage,
    parseJsonMessage,
    MAX_MESSAGE_BYTES,
} from "./protocol";

test("room ids are 128-bit lowercase hex only", () => {
    assert.equal(isValidRoomId("0123456789abcdef0123456789abcdef"), true);
    assert.equal(isValidRoomId("LargeMonstersBreakGingerly"), false);
    assert.equal(isValidRoomId("abcdefghijklmnop"), false);
    assert.equal(isValidRoomId("0123456789ABCDEF0123456789ABCDEF"), false);
    assert.equal(isValidRoomId(""), false);
});

test("join requires a hex room id and optional hex presenter token", () => {
    const roomId = "0123456789abcdef0123456789abcdef";
    const presenterToken = "fedcba9876543210fedcba9876543210";
    assert.equal(isJoinMessage({ type: "join", roomId, presenterToken }), true);
    assert.equal(isJoinMessage({ type: "join", roomId }), true);
    assert.equal(isJoinMessage({ type: "join", roomId, presenterToken: "nope" }), false);
    assert.equal(isValidPresenterToken(presenterToken), true);
    assert.equal(isJoinMessage({ type: "viewer" }), false);
});

test("webrtc kind is enumerated", () => {
    assert.equal(isWebRtcKind("offer"), true);
    assert.equal(isWebRtcKind("candidate"), true);
    assert.equal(isWebRtcKind("pranswer"), false);
});

test("broadcaster webrtc messages require a viewerId and kind", () => {
    assert.equal(
        isBroadcasterWebRtcMessage({
            type: "webrtcbroadcaster",
            viewerId: "1",
            kind: "answer",
            message: { type: "answer", sdp: "v=0" },
        }),
        true
    );
    assert.equal(
        isBroadcasterWebRtcMessage({
            type: "webrtcbroadcaster",
            viewerId: "1",
            kind: "nope",
            message: {},
        }),
        false
    );
});

test("parseJsonMessage discards invalid and oversized payloads", () => {
    assert.deepEqual(parseJsonMessage('{"type":"join"}'), { type: "join" });
    assert.equal(parseJsonMessage("{"), undefined);
    assert.equal(parseJsonMessage("x".repeat(MAX_MESSAGE_BYTES + 1)), undefined);
});
