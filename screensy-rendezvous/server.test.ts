import assert from "node:assert/strict";
import { test } from "node:test";
import { WebSocket, WebSocketServer } from "ws";
import { start } from "./server";

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

test("first joiner is broadcaster; second is viewer; invalid json is ignored", async () => {
    const wss = start(0);
    const port = (wss.address() as { port: number }).port;
    const url = `ws://127.0.0.1:${port}`;

    const a = new WebSocket(url);
    await onceOpen(a);
    a.send(JSON.stringify({ type: "join", roomId: "abcdefghijklmnop" }));
    const first = await onceMessage(a);
    assert.equal((first as { type: string }).type, "broadcast");

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
