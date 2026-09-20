import { createHmac } from "crypto";

const DEFAULT_TTL_SECONDS = 6 * 60 * 60;

export function mintTurnCredentials(
    secret: string,
    ttlSeconds: number = DEFAULT_TTL_SECONDS,
    nowSeconds: number = Math.floor(Date.now() / 1000)
): { username: string; credential: string } {
    const expiry = nowSeconds + ttlSeconds;
    const username = `${expiry}:screensy`;
    const credential = createHmac("sha1", secret).update(username).digest("base64");
    return { username, credential };
}
