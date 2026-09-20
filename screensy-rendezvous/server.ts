import { WebSocket, WebSocketServer, RawData } from "ws";
import {
    MAX_CONNECTIONS,
    MAX_ROOMS,
    MAX_MESSAGE_BYTES,
    MAX_VIEWERS_PER_ROOM,
    joinTimeoutMs,
    isBroadcasterWebRtcMessage,
    isFromBroadcasterMessage,
    isFromViewerMessage,
    isJoinMessage,
    isRequestViewersMessage,
    isViewerWebRtcMessage,
    parseJsonMessage,
} from "./protocol";
import { isUsableTurnSecret, mintTurnCredentials } from "./turn";

const PORT = Number(process.env.PORT) || 4000;

function turnAuthSecret(): string {
    return process.env.TURN_AUTH_SECRET || "";
}

function allowedOrigin(): string {
    return process.env.ALLOWED_ORIGIN || "";
}

function safeSend(socket: WebSocket, payload: unknown): void {
    if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(payload));
    }
}

function turnFields(): { turnUsername?: string; turnCredential?: string } {
    const secret = turnAuthSecret();
    if (!isUsableTurnSecret(secret)) {
        return {};
    }
    const minted = mintTurnCredentials(secret);
    return {
        turnUsername: minted.username,
        turnCredential: minted.credential,
    };
}

export class Server {
    private rooms = new Map<string, Room>();
    private connections = 0;

    get roomCount(): number {
        return this.rooms.size;
    }

    onConnection(socket: WebSocket): void {
        if (this.connections >= MAX_CONNECTIONS) {
            socket.close(1013, "server busy");
            return;
        }

        this.connections += 1;

        const joinTimer = setTimeout(() => {
            if (socket.readyState === WebSocket.OPEN) {
                socket.close(1008, "join timeout");
            }
        }, joinTimeoutMs());
        joinTimer.unref();

        socket.on("close", () => {
            this.connections -= 1;
            clearTimeout(joinTimer);
        });

        const onJoin = (data: RawData): void => {
            const message = parseJsonMessage(data.toString());
            if (!isJoinMessage(message)) {
                return;
            }

            clearTimeout(joinTimer);
            socket.off("message", onJoin);

            const existing = this.rooms.get(message.roomId);
            if (existing) {
                existing.addViewer(socket);
                return;
            }

            if (this.rooms.size >= MAX_ROOMS) {
                safeSend(socket, { type: "error", reason: "server busy" });
                socket.close(1013, "server busy");
                return;
            }

            this.newRoom(message.roomId, socket);
        };

        socket.on("message", onJoin);
    }

    newRoom(roomId: string, broadcaster: WebSocket): void {
        const existing = this.rooms.get(roomId);
        if (existing) {
            existing.addViewer(broadcaster);
            return;
        }

        const room = new Room(broadcaster);
        this.rooms.set(roomId, room);
        broadcaster.on("close", () => this.closeRoom(roomId));
        console.log("room created");
    }

    closeRoom(roomId: string): void {
        const room = this.rooms.get(roomId);
        if (!room) {
            return;
        }
        room.closeRoom();
        this.rooms.delete(roomId);
        console.log("room closed");
    }
}

class Room {
    private counter = 0;
    private readonly viewers: { [id: string]: WebSocket } = {};

    constructor(private broadcaster: WebSocket) {
        this.broadcaster.on("message", (data) => {
            const message = parseJsonMessage(data.toString());
            this.handleBroadcasterMessage(message);
        });

        safeSend(this.broadcaster, { type: "broadcast", ...turnFields() });
    }

    handleBroadcasterMessage(msg: unknown): void {
        if (!isFromBroadcasterMessage(msg)) {
            return;
        }

        if (isBroadcasterWebRtcMessage(msg)) {
            const viewer = this.viewers[msg.viewerId];
            if (!viewer) {
                return;
            }
            safeSend(viewer, {
                type: "webrtcviewer",
                kind: msg.kind,
                message: msg.message,
            });
            return;
        }

        if (isRequestViewersMessage(msg)) {
            for (const viewerId of Object.keys(this.viewers)) {
                safeSend(this.broadcaster, { type: "viewer", viewerId });
            }
        }
    }

    addViewer(viewer: WebSocket): void {
        if (Object.keys(this.viewers).length >= MAX_VIEWERS_PER_ROOM) {
            safeSend(viewer, { type: "error", reason: "room full" });
            viewer.close(1013, "room full");
            return;
        }

        const id = (this.counter++).toString();

        viewer.on("message", (data) => {
            const message = parseJsonMessage(data.toString());
            this.handleViewerMessage(id, message);
        });

        viewer.on("close", () => this.handleViewerDisconnect(id));

        safeSend(viewer, { type: "view", ...turnFields() });
        safeSend(this.broadcaster, { type: "viewer", viewerId: id });
        this.viewers[id] = viewer;
    }

    handleViewerMessage(viewerId: string, msg: unknown): void {
        if (!isFromViewerMessage(msg) || !isViewerWebRtcMessage(msg)) {
            return;
        }

        safeSend(this.broadcaster, {
            type: "webrtcbroadcaster",
            kind: msg.kind,
            message: msg.message,
            viewerId,
        });
    }

    handleViewerDisconnect(viewerId: string): void {
        if (!(viewerId in this.viewers)) {
            return;
        }

        delete this.viewers[viewerId];
        safeSend(this.broadcaster, {
            type: "viewerdisconnected",
            viewerId,
        });
    }

    closeRoom(): void {
        for (const viewerId of Object.keys(this.viewers)) {
            const viewer = this.viewers[viewerId];
            safeSend(viewer, { type: "broadcasterdisconnected" });
            viewer.close();
        }
    }
}

export function start(port: number = PORT): WebSocketServer {
    const secret = turnAuthSecret();
    if (!isUsableTurnSecret(secret)) {
        throw new Error(
            "TURN_AUTH_SECRET must be set to a unique value at least 24 characters long (see .env.example)."
        );
    }

    const origin = allowedOrigin();
    const server = new Server();
    const socket = new WebSocketServer({
        port,
        maxPayload: MAX_MESSAGE_BYTES,
        perMessageDeflate: false,
        verifyClient: (info, done) => {
            if (!origin) {
                done(true);
                return;
            }
            done(info.origin === origin);
        },
    });

    socket.on("connection", (ws: WebSocket) => server.onConnection(ws));
    console.log("Server started on port " + port);
    return socket;
}

if (require.main === module) {
    try {
        start();
    } catch (err) {
        console.error(err instanceof Error ? err.message : err);
        process.exit(1);
    }
}
