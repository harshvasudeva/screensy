/**
 * @source  ./screensy.ts
 *
 * @licstart  The following is the entire license notice for the JavaScript
 * code in this page.
 *
 * Copyright (C) 2021  Stef Gijsberts, Marijn van Wezel
 *
 * The JavaScript code in this page is free software: you can redistribute it
 * and/or modify it under the terms of the GNU General Public License (GNU GPL)
 * as published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.  The code is distributed
 * WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
 * or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU GPL for more details.
 *
 * As additional permission under GNU GPL version 3 section 7, you may
 * distribute non-source (e.g., minimized or compacted) forms of that code
 * without the copy of the GNU GPL normally required by section 4, provided you
 * include this license notice and a URL through which recipients can access
 * the Corresponding Source.
 *
 * @licend  The above is the entire license notice for the JavaScript code in
 * this page.
 */

interface MessageJoin {
    type: "join";
    roomId: string;
}

interface TurnFields {
    turnUsername?: string;
    turnCredential?: string;
}

interface MessageBroadcast extends TurnFields {
    type: "broadcast";
}

interface MessageView extends TurnFields {
    type: "view";
}

/**
 * Tells the broadcaster a viewer has connected
 */
interface MessageViewer {
    type: "viewer";
    viewerId: string;
}

/**
 * Ask the server to resend the VIEWER messages
 */
interface MessageRequestViewers {
    type: "requestviewers";
}

/**
 * Tells the broadcaster a viewer has disconnected
 */
interface MessageViewerDisconnected {
    type: "viewerdisconnected";
    viewerId: string;
}

/**
 * Tells the viewer the broadcaster has disconnected.
 */
interface MessageBroadcasterDisconnected {
    type: "broadcasterdisconnected";
}

/**
 * Sends a WebRTC message between the viewer and the server
 */
interface MessageWebRTCViewer {
    type: "webrtcviewer";
    kind: "offer" | "answer" | "candidate";
    message: any;
}

/**
 * Sends a WebRTC message between the server and the broadcaster
 */
interface MessageWebRTCBroadcaster {
    type: "webrtcbroadcaster";
    viewerId: string;
    kind: "offer" | "answer" | "candidate";
    message: any;
}

type Message =
    | MessageViewer
    | MessageViewerDisconnected
    | MessageBroadcasterDisconnected
    | MessageWebRTCViewer
    | MessageWebRTCBroadcaster
    | MessageRequestViewers
    | MessageJoin
    | MessageBroadcast
    | MessageView;

interface MessageSender {
    (msg: Message): Promise<void>;
}

/**
 * Pause execution until the listener/event has fired on the given target.
 *
 * @see https://stackoverflow.com/a/63718685
 */
function wait(target: EventTarget, listenerName: string): Promise<Event> {
    // Lambda that returns a listener for the given resolve lambda
    const listener =
        (resolve: (value: Event | PromiseLike<Event>) => void) =>
        (event: Event) => {
            target.removeEventListener(listenerName, listener(resolve));
            resolve(event);
        };

    return new Promise((resolve, _reject) => {
        target.addEventListener(listenerName, listener(resolve));
    });
}

/**
 * Displays the popup with the given name. Does nothing if the popup does not
 * exist.
 *
 * @param name Name of the popup to display
 */
function showPopup(name: string): void {
    const element = document.getElementById(name);

    if (element == null) {
        return;
    }

    element.classList.remove("hidden");
}

/**
 * Hides the popup with the given name. Does nothing if the popup is not visible or if
 * the popup does not exist.
 *
 * @param name Name of the popup to hide
 */
function hidePopup(name: string): void {
    const element = document.getElementById(name);

    if (element == null) {
        return;
    }

    element.classList.add("hidden");
}

interface Client {
    /**
     * Handles the messages received from the signaling server.
     *
     * @param msg
     */
    handleMessage(msg: Message): void;
}

/**
 * Represents a broadcaster. The broadcaster is responsible for capturing and sending
 * their screen (and maybe audio) to all peers.
 */
class Broadcaster implements Client {
    public onviewerjoin: ((viewerId: string) => void) | null = null;
    public onviewerleave: ((viewerId: string) => void) | null = null;

    private readonly sendMessage: MessageSender;
    private readonly rtcConfig: RTCConfiguration;
    private readonly mediaStream: MediaStream;

    private readonly viewers: { [id: string]: RTCPeerConnection } = {};

    /**
     * Broadcaster constructor.
     *
     * @param sendMessage Function to send a message to the server
     * @param rtcConfig The WebRTC configuration to use for the WebRTC connection
     * @param mediaStream The MediaStream to broadcast
     */
    constructor(
        sendMessage: MessageSender,
        rtcConfig: RTCConfiguration,
        mediaStream: MediaStream
    ) {
        this.sendMessage = sendMessage;
        this.rtcConfig = rtcConfig;
        this.mediaStream = mediaStream;
    }

    /**
     * @inheritDoc
     */
    async handleMessage(msg: Message): Promise<void> {
        switch (msg.type) {
            case "viewer":
                await this.addViewer(msg.viewerId);
                break;
            case "viewerdisconnected":
                await this.removeViewer(msg.viewerId);
                break;
            case "webrtcbroadcaster":
                await this.handleWebRTCMessage(msg);
                break;
        }
    }

    /**
     * Adds a viewer to the peer-to-peer connection.
     *
     * @param viewerId
     * @private
     */
    private async addViewer(viewerId: string): Promise<void> {
        const viewerConnection = new RTCPeerConnection(this.rtcConfig);

        for (const track of await this.mediaStream.getTracks()) {
            viewerConnection.addTrack(track, this.mediaStream);
        }

        viewerConnection.onicecandidate = (
            event: RTCPeerConnectionIceEvent
        ) => {
            if (!event.candidate) return;

            this.sendMessage({
                type: "webrtcbroadcaster",
                kind: "candidate",
                viewerId: viewerId,
                message: event.candidate,
            });
        };

        viewerConnection.onicegatheringstatechange = async (_event: Event) => {
            if (viewerConnection.iceGatheringState !== "complete") {
                return;
            }

            for (const sender of await viewerConnection.getSenders()) {
                if (sender.track == null) {
                    continue;
                }

                const rtcSendParameters = sender.getParameters();

                // https://developer.mozilla.org/en-US/docs/Web/API/RTCRtpSender/setParameters#currently_compatible_implementation
                if (!rtcSendParameters.encodings) {
                    rtcSendParameters.encodings = [{}];
                }

                if (sender.track.kind === "audio") {
                    rtcSendParameters.encodings[0].maxBitrate = 960000; // 960 Kbps, does gek
                } else if (sender.track.kind === "video") {
                    // @ts-ignore
                    rtcSendParameters.encodings[0].maxFramerate = 30;
                    rtcSendParameters.encodings[0].maxBitrate = 100000000; // 100 Mbps
                }

                await sender.setParameters(rtcSendParameters);
            }
        };

        const offer = await viewerConnection.createOffer();
        await viewerConnection.setLocalDescription(offer);
        const localDescription = viewerConnection.localDescription;

        if (localDescription == null) {
            throw "No local description available.";
        }

        await this.sendMessage({
            type: "webrtcbroadcaster",
            kind: "offer",
            viewerId: viewerId,
            message: localDescription,
        });

        this.viewers[viewerId] = viewerConnection;

        if (this.onviewerjoin != null) {
            this.onviewerjoin(viewerId);
        }
    }

    /**
     * Removes a viewer from the peer-to-peer connection.
     *
     * @param viewerId
     * @private
     */
    private async removeViewer(viewerId: string): Promise<void> {
        if (this.viewers[viewerId] == null) {
            return;
        }

        this.viewers[viewerId].close();
        delete this.viewers[viewerId];

        if (this.onviewerleave != null) {
            this.onviewerleave(viewerId);
        }
    }

    /**
     * Handles incoming WebRTC messages.
     *
     * @param msg
     * @private
     */
    private async handleWebRTCMessage(
        msg: MessageWebRTCBroadcaster
    ): Promise<void> {
        const kind = msg.kind;

        switch (kind) {
            case "candidate":
                if (this.viewers[msg.viewerId] == null) {
                    break;
                }

                await this.viewers[msg.viewerId].addIceCandidate(
                    new RTCIceCandidate(msg.message)
                );
                break;
            case "answer":
                if (this.viewers[msg.viewerId] == null) {
                    break;
                }

                await this.viewers[msg.viewerId].setRemoteDescription(
                    msg.message
                );
                break;
        }
    }
}

/**
 * Represents a viewer.
 */
class Viewer implements Client {
    private readonly sendMessage: MessageSender;
    private readonly rtcConfig: RTCConfiguration;
    private readonly videoElement: HTMLVideoElement;

    private broadcasterPeerConnection: RTCPeerConnection | null = null;

    /**
     * Viewer constructor.
     *
     * @param sendMessage Function to send a message to the server
     * @param rtcConfig The WebRTC configuration to use for the WebRTC connection
     * @param videoElement The element to project the received MediaStream onto
     */
    constructor(
        sendMessage: MessageSender,
        rtcConfig: RTCConfiguration,
        videoElement: HTMLVideoElement
    ) {
        this.sendMessage = sendMessage;
        this.rtcConfig = rtcConfig;
        this.videoElement = videoElement;
    }

    /**
     * @inheritDoc
     */
    async handleMessage(msg: Message): Promise<void> {
        switch (msg.type) {
            case "broadcasterdisconnected":
                await this.handleBroadcasterDisconnect();
                break;
            case "webrtcviewer":
                await this.handleWebRTCMessage(msg);
                break;
        }
    }

    /**
     * Handles a disconnect of the broadcaster.
     *
     * @private
     */
    private async handleBroadcasterDisconnect(): Promise<void> {
        showPopup("broadcaster-disconnected");
        document.body.removeChild(this.videoElement);
    }

    /**
     * Handles incoming WebRTC messages.
     *
     * @param msg
     * @private
     */
    private async handleWebRTCMessage(msg: MessageWebRTCViewer): Promise<void> {
        const kind = msg.kind;

        switch (kind) {
            case "candidate":
                if (this.broadcasterPeerConnection == null) {
                    break;
                }

                await this.broadcasterPeerConnection.addIceCandidate(
                    new RTCIceCandidate(msg.message)
                );
                break;
            case "offer":
                await this.handleOffer(msg);
                break;
        }
    }

    /**
     * Handles incoming WebRTC offer.
     *
     * @param msg
     * @private
     */
    private async handleOffer(msg: MessageWebRTCViewer): Promise<void> {
        this.broadcasterPeerConnection = new RTCPeerConnection(this.rtcConfig);

        this.broadcasterPeerConnection.ontrack = (event: RTCTrackEvent) => {
            this.videoElement.srcObject = event.streams[0];
        };

        this.broadcasterPeerConnection.onicecandidate = (
            event: RTCPeerConnectionIceEvent
        ) => {
            if (event.candidate == null) return;

            this.sendMessage({
                type: "webrtcviewer",
                kind: "candidate",
                message: event.candidate,
            });
        };

        await this.broadcasterPeerConnection.setRemoteDescription(msg.message);

        const answer = await this.broadcasterPeerConnection.createAnswer();
        await this.broadcasterPeerConnection.setLocalDescription(answer);

        if (this.broadcasterPeerConnection == null) {
            throw "No local description available.";
        }

        await this.sendMessage({
            type: "webrtcviewer",
            kind: "answer",
            message: this.broadcasterPeerConnection.localDescription,
        });
    }
}

class Room {
    private readonly roomId: string;
    private readonly videoElement: HTMLVideoElement;
    private readonly webSocket: WebSocket;
    private readonly sendMessage: MessageSender;
    private readonly rtcConfig: RTCConfiguration;

    /**
     * Room constructor.
     *
     * @param roomId The ID of this room
     */
    constructor(roomId: string) {
        this.roomId = roomId;
        this.videoElement = <HTMLVideoElement>document.getElementById("stream");

        const webSocketProtocol =
            window.location.protocol === "https:" ? "wss" : "ws";
        const webSocketUrl =
            webSocketProtocol + "://" + location.host + location.pathname;

        this.webSocket = new WebSocket(webSocketUrl);
        this.webSocket.onerror = () => showPopup("websocket-connect-failed");

        this.sendMessage = async (message: Message) =>
            this.webSocket.send(JSON.stringify(message));
        this.rtcConfig = {
            iceServers: [{ urls: "stun:" + location.hostname }],
            iceCandidatePoolSize: 8,
        };

        this.videoElement.onpause = (_event: Event) => this.videoElement.play();
        window.onunload = window.onbeforeunload = () => this.webSocket.close();
    }

    /**
     * Joins the room.
     */
    async join() {
        // Wait until the socket opens
        await wait(this.webSocket, "open");

        this.webSocket.onmessage = async (event: MessageEvent) => {
            const messageData = parseSocketPayload(event.data);
            if (messageData == null) {
                return;
            }

            this.applyTurnCredentials(messageData);

            const isBroadcaster = messageData.type === "broadcast";

            if (
                isBroadcaster &&
                !("getDisplayMedia" in navigator.mediaDevices)
            ) {
                showPopup("screensharing-not-supported");
                return;
            }

            const client = isBroadcaster
                ? await this.setupBroadcaster()
                : await this.setupViewer();

            this.webSocket.onmessage = (event: MessageEvent) => {
                const payload = parseSocketPayload(event.data);
                if (payload == null) {
                    return;
                }
                client.handleMessage(payload);
            };

            if (isBroadcaster) {
                await this.sendMessage({ type: "requestviewers" });
            }

            this.setDocumentTitle();
        };

        await this.sendMessage({
            type: "join",
            roomId: this.roomId,
        });
    }

    private applyTurnCredentials(message: {
        turnUsername?: string;
        turnCredential?: string;
    }): void {
        if (!message.turnUsername || !message.turnCredential) {
            return;
        }

        const iceServers = this.rtcConfig.iceServers || [];
        iceServers.push({
            urls: "turn:" + location.hostname,
            username: message.turnUsername,
            credential: message.turnCredential,
        });
        this.rtcConfig.iceServers = iceServers;
    }

    /**
     * Sets the document's title to the room name.
     */
    private setDocumentTitle() {
        document.title = this.roomId + " | screensy";
    }

    /**
     * Set up a Broadcaster instance.
     */
    private async setupBroadcaster(): Promise<Broadcaster> {
        const mediaStream = await this.getDisplayMediaStream();
        const broadcaster = new Broadcaster(
            this.sendMessage,
            this.rtcConfig,
            mediaStream
        );
        const counterElement: HTMLParagraphElement =
            document.createElement("p");

        counterElement.id = "counter";
        counterElement.innerText = "0";

        broadcaster.onviewerjoin = (_viewerId: string) => {
            const currentCounter = parseInt(counterElement.innerText);
            counterElement.innerText = (currentCounter + 1).toString();
        };

        broadcaster.onviewerleave = (_viewerId: string) => {
            const currentCounter = parseInt(counterElement.innerText);
            counterElement.innerText = (currentCounter - 1).toString();
        };

        document.body.prepend(counterElement);
        this.videoElement.srcObject = mediaStream;

        return broadcaster;
    }

    /**
     * Set up a Viewer instance.
     */
    private async setupViewer(): Promise<Viewer> {
        // The client is assigned the role of viewer
        return new Viewer(this.sendMessage, this.rtcConfig, this.videoElement);
    }

    /**
     * Returns the user's display MediaStream.
     *
     * @private
     */
    private async getDisplayMediaStream(): Promise<MediaStream> {
        showPopup("click-to-share");

        await wait(document, "click");

        const videoConstraints: MediaTrackConstraints | boolean = true;
        const audioConstraints: MediaTrackConstraints | boolean = {
            channelCount: { ideal: 2 },
            sampleRate: { ideal: 192000 },
            // @ts-ignore
            noiseSuppression: { ideal: false },
            echoCancellation: { ideal: false },
            autoGainControl: { ideal: false },
        };

        const mediaConstraints: MediaStreamConstraints = {
            video: videoConstraints,
            audio: audioConstraints,
        };

        const mediaDevices: MediaDevices = window.navigator.mediaDevices;

        // @ts-ignore getDisplayMedia is not supported by TypeScript :(
        const displayMedia = mediaDevices.getDisplayMedia(mediaConstraints);

        // If the promise is resolved, remove the popup from the screen
        displayMedia.then(() => {
            hidePopup("click-to-share");
        });

        // If the promise is rejected, tell the user about the failure
        displayMedia.catch(() => {
            hidePopup("click-to-share");
            showPopup("access-denied");
        });

        return displayMedia;
    }
}

function parseSocketPayload(data: unknown): (Message & TurnFields) | null {
    if (typeof data !== "string") {
        return null;
    }

    try {
        const parsed = JSON.parse(data);
        if (parsed === null || typeof parsed !== "object") {
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

function isUsableRoomId(roomId: string): boolean {
    return /^[A-Za-z0-9_-]{8,128}$/.test(roomId);
}

/**
 * 128-bit unguessable room id (hex). The URL fragment is the access capability.
 */
function generateRoomId(): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
        ""
    );
}

async function main(_event: Event) {
    const currentId = window.location.hash.substring(1);

    if (!isUsableRoomId(currentId)) {
        window.location.replace("#" + generateRoomId());
        return;
    }

    window.onhashchange = (_event: Event) => {
        location.reload();
    };

    if (!("WebSocket" in window)) {
        showPopup("websockets-not-supported");
        return;
    }

    if (!("mediaDevices" in navigator)) {
        showPopup("mediastream-not-supported");
        return;
    }

    if (!("RTCPeerConnection" in window)) {
        showPopup("webrtc-not-supported");
        return;
    }

    const room = new Room(currentId);
    await room.join();
}

window.addEventListener("DOMContentLoaded", main);
