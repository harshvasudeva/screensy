import assert from "node:assert/strict";
import { test } from "node:test";
import { WebSocket } from "ws";
import { start } from "./server";

process.env.TURN_AUTH_SECRET =
    process.env.TURN_AUTH_SECRET || "unit-test-secret-not-for-production";
process.env.JOIN_TIMEOUT_MS = process.env.JOIN_TIMEOUT_MS || "50";
process.env.ALLOW_EMPTY_ORIGIN = "1";
process.env.RATE_LIMIT_DISABLED = "1";

const ROOM_ID = "0123456789abcdef0123456789abcdef";
const PRESENTER_TOKEN = "fedcba9876543210fedcba9876543210";

function onceOpen(socket: WebSocket): Promise<void> {
    return new Promise((resolve, reject) => {
        socket.once("open", () => resolve());
        socket.once("error", reject);
    });
}

function onceMessage(socket: WebSocket): Promise<unknown> {
    return new Promise((resolve, reject) => {
        socket.once("message", (data) => {
            resolve(JSON.parse(data.toString()));
        });
        socket.once("error", reject);
    });
}

function onceClose(socket: WebSocket): Promise<number> {
    return new Promise((resolve) => {
        socket.once("close", (code) => resolve(code));
    });
}

test("presenter token creates the room; viewers join without it", async () => {
    const wss = start(0);
    const port = (wss.address() as { port: number }).port;
    const url = `ws://127.0.0.1:${port}`;

    const a = new WebSocket(url);
    await onceOpen(a);
    a.send(
        JSON.stringify({
            type: "join",
            roomId: ROOM_ID,
            presenterToken: PRESENTER_TOKEN,
        })
    );
    const first = (await onceMessage(a)) as {
        type: string;
        turnUsername?: string;
    };
    assert.equal(first.type, "broadcast");
    assert.equal(typeof first.turnUsername, "string");

    const b = new WebSocket(url);
    await onceOpen(b);
    b.send(JSON.stringify({ type: "join", roomId: ROOM_ID }));
    const [viewerHello, broadcasterNotice] = await Promise.all([
        onceMessage(b),
        onceMessage(a),
    ]);
    assert.equal((viewerHello as { type: string }).type, "view");
    assert.equal((broadcasterNotice as { type: string }).type, "viewer");

    a.send("{not-json");
    a.close();
    b.close();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
});

test("viewers cannot create a room without the presenter token", async () => {
    const wss = start(0);
    const port = (wss.address() as { port: number }).port;
    const viewer = new WebSocket(`ws://127.0.0.1:${port}`);
    await onceOpen(viewer);
    viewer.send(JSON.stringify({ type: "join", roomId: ROOM_ID }));
    const message = (await onceMessage(viewer)) as { type: string; reason?: string };
    assert.equal(message.type, "error");
    assert.equal(message.reason, "no such room");
    await onceClose(viewer);
    await new Promise<void>((resolve) => wss.close(() => resolve()));
});

test("idle connections are closed before they consume a join slot forever", async () => {
    const wss = start(0);
    const port = (wss.address() as { port: number }).port;
    const idle = new WebSocket(`ws://127.0.0.1:${port}`);
    await onceOpen(idle);
    const code = await onceClose(idle);
    assert.equal(code, 1008);
    await new Promise<void>((resolve) => wss.close(() => resolve()));
});
