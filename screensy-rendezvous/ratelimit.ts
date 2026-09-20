import { IncomingMessage } from "http";
import {
    MAX_CONNECTIONS_PER_IP,
    MAX_JOINS_PER_IP_PER_MINUTE,
    MAX_ROOM_CREATES_PER_IP_PER_MINUTE,
} from "./protocol";

const MINUTE_MS = 60_000;

export function clientIp(req: IncomingMessage): string {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.trim().length > 0) {
        return forwarded.split(",")[0].trim().slice(0, 45);
    }
    if (Array.isArray(forwarded) && forwarded[0]) {
        return forwarded[0].split(",")[0].trim().slice(0, 45);
    }
    return (req.socket.remoteAddress || "unknown").slice(0, 45);
}

export function rateLimitsDisabled(): boolean {
    return process.env.RATE_LIMIT_DISABLED === "1";
}

export class RateLimiter {
    private connections = new Map<string, number>();
    private joinTimes = new Map<string, number[]>();
    private createTimes = new Map<string, number[]>();

    addConnection(ip: string): boolean {
        if (rateLimitsDisabled()) {
            this.connections.set(ip, (this.connections.get(ip) || 0) + 1);
            return true;
        }
        const next = (this.connections.get(ip) || 0) + 1;
        if (next > MAX_CONNECTIONS_PER_IP) {
            return false;
        }
        this.connections.set(ip, next);
        return true;
    }

    dropConnection(ip: string): void {
        const current = this.connections.get(ip) || 0;
        if (current <= 1) {
            this.connections.delete(ip);
            return;
        }
        this.connections.set(ip, current - 1);
    }

    allowJoin(ip: string): boolean {
        return this.hit(this.joinTimes, ip, MAX_JOINS_PER_IP_PER_MINUTE);
    }

    allowCreate(ip: string): boolean {
        return this.hit(this.createTimes, ip, MAX_ROOM_CREATES_PER_IP_PER_MINUTE);
    }

    private hit(store: Map<string, number[]>, ip: string, max: number): boolean {
        if (rateLimitsDisabled()) {
            return true;
        }
        const now = Date.now();
        const recent = (store.get(ip) || []).filter((at) => now - at < MINUTE_MS);
        if (recent.length >= max) {
            store.set(ip, recent);
            return false;
        }
        recent.push(now);
        store.set(ip, recent);
        return true;
    }
}
