import assert from "node:assert/strict";
import { test } from "node:test";
import { WebSocket } from "ws";
import { start } from "./server";

process.env.TURN_AUTH_SECRET =
    process.env.TURN_AUTH_SECRET || "unit-test-secret-not-for-production";
process.env.JOIN_TIMEOUT_MS = process.env.JOIN_TIMEOUT_MS || "50";

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

test("first joiner is broadcaster; second is viewer; invalid json is ignored", async () => {
    const wss = start(0);
    const port = (wss.address() as { port: number }).port;
    const url = `ws://127.0.0.1:${port}`;

    const a = new WebSocket(url);
    await onceOpen(a);
    a.send(JSON.stringify({ type: "join", roomId: "abcdefghijklmnop" }));
    const first = (await onceMessage(a)) as {
        type: string;
        turnUsername?: string;
    };
    assert.equal(first.type, "broadcast");
    assert.equal(typeof first.turnUsername, "string");

    const b = new WebSocket(url);
    await onceOpen(b);
    b.send(JSON.stringify({ type: "join", roomId: "abcdefghijklmnop" }));
    const [viewerHello, broadcasterNotice] = await Promise.all([
        onceMessage(b),
        onceMessage(a),
    ]);
    assert.equal((viewerHello as { type: string }).type, "view");
    assert.equal((broadcasterNotice as { type: string }).type, "viewer");

    a.send("{not-json");
    a.send(JSON.stringify({ type: "join", roomId: "no" }));

    await new Promise((resolve) => setTimeout(resolve, 50));

    a.close();
    b.close();
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
