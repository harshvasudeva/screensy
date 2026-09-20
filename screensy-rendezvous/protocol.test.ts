import assert from "node:assert/strict";
import { test } from "node:test";
import {
    isJoinMessage,
    isValidRoomId,
    isWebRtcKind,
    isBroadcasterWebRtcMessage,
    parseJsonMessage,
    MAX_MESSAGE_BYTES,
} from "./protocol";

test("accepts unguessable hex room ids and legacy word-list names", () => {
    assert.equal(isValidRoomId("0123456789abcdef0123456789abcdef"), true);
    assert.equal(isValidRoomId("LargeMonstersBreakGingerly"), true);
    assert.equal(isValidRoomId("short"), false);
    assert.equal(isValidRoomId("has space ohnooooo"), false);
    assert.equal(isValidRoomId("a".repeat(129)), false);
    assert.equal(isValidRoomId(""), false);
});

test("join messages require a valid roomId", () => {
    assert.equal(isJoinMessage({ type: "join", roomId: "abcdefgh" }), true);
    assert.equal(isJoinMessage({ type: "join", roomId: "x" }), false);
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
