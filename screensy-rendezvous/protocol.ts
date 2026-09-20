export const MAX_MESSAGE_BYTES = 256 * 1024;
export const MAX_ROOM_ID_LENGTH = 128;
export const MIN_ROOM_ID_LENGTH = 8;
export const MAX_VIEWERS_PER_ROOM = 32;
export const MAX_ROOMS = 256;
export const MAX_CONNECTIONS = 512;

const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export function isValidRoomId(roomId: unknown): roomId is string {
    return (
        typeof roomId === "string" &&
        roomId.length >= MIN_ROOM_ID_LENGTH &&
        roomId.length <= MAX_ROOM_ID_LENGTH &&
        ROOM_ID_PATTERN.test(roomId)
    );
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function payloadSizeOk(value: unknown): boolean {
    try {
        return Buffer.byteLength(JSON.stringify(value), "utf8") <= MAX_MESSAGE_BYTES;
    } catch {
        return false;
    }
}

export function isJoinMessage(
    value: unknown
): value is { type: "join"; roomId: string } {
    return (
        isPlainObject(value) &&
        value.type === "join" &&
        isValidRoomId(value.roomId)
    );
}

const WEBRTC_KINDS = new Set(["offer", "answer", "candidate"]);

export function isWebRtcKind(kind: unknown): kind is "offer" | "answer" | "candidate" {
    return typeof kind === "string" && WEBRTC_KINDS.has(kind);
}

export function isWebRtcPayload(message: unknown): boolean {
    return message !== undefined && payloadSizeOk(message);
}

export function isBroadcasterWebRtcMessage(value: unknown): value is {
    type: "webrtcbroadcaster";
    viewerId: string;
    kind: "offer" | "answer" | "candidate";
    message: unknown;
} {
    return (
        isPlainObject(value) &&
        value.type === "webrtcbroadcaster" &&
        typeof value.viewerId === "string" &&
        value.viewerId.length > 0 &&
        value.viewerId.length <= 32 &&
        isWebRtcKind(value.kind) &&
        isWebRtcPayload(value.message)
    );
}

export function isViewerWebRtcMessage(value: unknown): value is {
    type: "webrtcviewer";
    kind: "offer" | "answer" | "candidate";
    message: unknown;
} {
    return (
        isPlainObject(value) &&
        value.type === "webrtcviewer" &&
        isWebRtcKind(value.kind) &&
        isWebRtcPayload(value.message)
    );
}

export function isRequestViewersMessage(
    value: unknown
): value is { type: "requestviewers" } {
    return isPlainObject(value) && value.type === "requestviewers";
}

export function isFromBroadcasterMessage(value: unknown): boolean {
    return (
        isJoinMessage(value) ||
        isBroadcasterWebRtcMessage(value) ||
        isRequestViewersMessage(value)
    );
}

export function isFromViewerMessage(value: unknown): boolean {
    return isJoinMessage(value) || isViewerWebRtcMessage(value);
}

export function parseJsonMessage(raw: string): unknown | undefined {
    if (raw.length > MAX_MESSAGE_BYTES) {
        return undefined;
    }

    try {
        return JSON.parse(raw);
    } catch {
        return undefined;
    }
}
