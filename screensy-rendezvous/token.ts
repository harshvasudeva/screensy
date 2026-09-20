import { createHash, timingSafeEqual } from "crypto";

export function presenterTokenDigest(token: string): Buffer {
    return createHash("sha256").update(token, "utf8").digest();
}

export function presenterTokenMatches(token: string, digest: Buffer): boolean {
    const incoming = presenterTokenDigest(token);
    return incoming.length === digest.length && timingSafeEqual(incoming, digest);
}
