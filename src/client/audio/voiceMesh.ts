import type { VoiceSignal } from "../../shared/protocol/index.js";
import type { PlayerId } from "../../shared/types/core.js";

/**
 * The browser-free core of proximity voice: one peer link per party member, negotiated over the
 * server's signaling relay, with each remote stream's volume set from `voiceRangeUpdated`.
 *
 * WebRTC and the microphone sit behind `LocalAudio` and `PeerLink`, implemented for real in
 * `browserVoice.ts`, so everything here runs under Vitest with fakes.
 */

export type VoiceStatus = "off" | "requesting" | "live" | "denied" | "unavailable";

export interface VoiceState {
  status: VoiceStatus;
  muted: boolean;
  deafened: boolean;
  /** Party members with a peer link, connected or still negotiating. */
  peerCount: number;
}

/** The captured microphone. */
export interface LocalAudio {
  setMuted(muted: boolean): void;
  /** Input loudness from 0 to 1, for the level meter. */
  level(): number;
  stop(): void;
}

export type CaptureResult<L extends LocalAudio> =
  | { ok: true; audio: L }
  | { ok: false; reason: "denied" | "unavailable" };

export interface IceCandidate {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
}

export type PeerConnectionState =
  | "new"
  | "connecting"
  | "connected"
  | "disconnected"
  | "failed"
  | "closed";

/** One RTCPeerConnection plus the element playing its remote audio. */
export interface PeerLink {
  hasRemoteDescription(): boolean;
  /** Creates and applies a local offer, returning its SDP. */
  createOffer(): Promise<string>;
  /** Rolls back any local offer, applies the remote one, and returns the applied answer's SDP. */
  acceptOffer(sdp: string): Promise<string>;
  acceptAnswer(sdp: string): Promise<void>;
  addIceCandidate(candidate: IceCandidate): Promise<void>;
  /** Playback volume for the remote stream, 0 to 1. */
  setVolume(volume: number): void;
  close(): void;
}

export interface PeerLinkEvents {
  onIceCandidate(candidate: IceCandidate): void;
  onConnectionStateChange(state: PeerConnectionState): void;
}

export interface PartyMember {
  id: PlayerId;
  connected: boolean;
}

export interface PeerRange {
  playerId: PlayerId;
  volume: number;
}

export interface VoiceMeshOptions<L extends LocalAudio> {
  capture(): Promise<CaptureResult<L>>;
  createPeerLink(peerId: PlayerId, local: L, events: PeerLinkEvents): PeerLink;
  /** Sends a signal through the session socket; false when the socket is down. */
  sendSignal(targetId: PlayerId, signal: VoiceSignal): boolean;
  onChange?(state: VoiceState): void;
  now?: () => number;
  /**
   * The shortest wait before offering to the same peer again. A peer whose connection keeps
   * failing would otherwise be re-offered on every snapshot and drain the signaling budget.
   */
  reofferDelayMs?: number;
}

export const DEFAULT_REOFFER_DELAY_MS = 5000;

interface Peer {
  id: PlayerId;
  link: PeerLink;
  /** Negotiation steps run one at a time, in arrival order, so a candidate never beats its offer. */
  queue: Promise<void>;
  /** Candidates that arrived before the remote description they belong to. */
  pendingCandidates: IceCandidate[];
  /** This side offered and has had no answer yet. */
  awaitingAnswer: boolean;
  /** The SDP of this side's offer, once created, so it can be sent again. */
  localOfferSdp: string | null;
  /** The last remote offer applied, so a repeat of it is recognized and dropped. */
  remoteOfferSdp: string | null;
  connected: boolean;
}

export function createVoiceMesh<L extends LocalAudio>(options: VoiceMeshOptions<L>) {
  const now = options.now ?? (() => Date.now());
  const reofferDelayMs = options.reofferDelayMs ?? DEFAULT_REOFFER_DELAY_MS;

  let status: VoiceStatus = "off";
  let muted = false;
  let deafened = false;
  let local: L | null = null;
  /** Bumped on disable, so a capture that resolves afterwards knows it is no longer wanted. */
  let generation = 0;

  let selfId: PlayerId | null = null;
  let party: PartyMember[] = [];
  const peers = new Map<PlayerId, Peer>();
  const lastOfferAt = new Map<PlayerId, number>();
  /** Volume per peer from the latest proximity update. Absent means silent. */
  let ranges = new Map<PlayerId, number>();

  function state(): VoiceState {
    let peerCount = 0;
    for (const peer of peers.values()) if (peer.connected) peerCount += 1;
    return { status, muted, deafened, peerCount };
  }

  function notify(): void {
    options.onChange?.(state());
  }

  function volumeFor(id: PlayerId): number {
    return deafened ? 0 : (ranges.get(id) ?? 0);
  }

  function applyMic(): void {
    // Deafening mutes the microphone too, the way voice apps do: someone who cannot hear the party
    // should not be talking over it.
    local?.setMuted(muted || deafened);
  }

  function drop(id: PlayerId): void {
    const peer = peers.get(id);
    if (!peer) return;
    peers.delete(id);
    peer.link.close();
  }

  function enqueue(peer: Peer, step: () => Promise<void>): Promise<void> {
    peer.queue = peer.queue.then(async () => {
      // A replaced or dropped link finishes nothing it had queued.
      if (peers.get(peer.id) !== peer) return;
      try {
        await step();
      } catch {
        // A failed negotiation step leaves the link unusable. Drop it; the next party sync offers
        // again once the re-offer delay has passed.
        if (peers.get(peer.id) === peer) {
          drop(peer.id);
          notify();
        }
      }
    });
    return peer.queue;
  }

  function createPeer(id: PlayerId, audio: L): Peer {
    drop(id);
    // Events from a link that has since been replaced or dropped are stale and ignored.
    const current = (): boolean => peers.get(id)?.link === link;
    const link = options.createPeerLink(id, audio, {
      onIceCandidate: (candidate) => {
        if (!current()) return;
        options.sendSignal(id, { kind: "iceCandidate", ...candidate });
      },
      onConnectionStateChange: (connectionState) => {
        if (!current()) return;
        // "disconnected" can recover on its own; "failed" and "closed" cannot.
        if (connectionState === "failed" || connectionState === "closed") {
          drop(id);
          notify();
          return;
        }
        const connected = connectionState === "connected";
        if (peer.connected === connected) return;
        peer.connected = connected;
        notify();
      },
    });
    const peer: Peer = {
      id,
      link,
      queue: Promise.resolve(),
      pendingCandidates: [],
      awaitingAnswer: false,
      localOfferSdp: null,
      remoteOfferSdp: null,
      connected: false,
    };
    peers.set(id, peer);
    link.setVolume(volumeFor(id));
    return peer;
  }

  async function flushCandidates(peer: Peer): Promise<void> {
    const candidates = peer.pendingCandidates;
    peer.pendingCandidates = [];
    for (const candidate of candidates) await addCandidate(peer, candidate);
  }

  async function addCandidate(peer: Peer, candidate: IceCandidate): Promise<void> {
    try {
      await peer.link.addIceCandidate(candidate);
    } catch {
      // A candidate for an offer this side ignored or rolled back is expected to be refused, and
      // one bad candidate does not make the others useless.
    }
  }

  function offerTo(id: PlayerId, audio: L): void {
    lastOfferAt.set(id, now());
    const peer = createPeer(id, audio);
    peer.awaitingAnswer = true;
    void enqueue(peer, async () => {
      const sdp = await peer.link.createOffer();
      peer.localOfferSdp = sdp;
      options.sendSignal(id, { kind: "offer", sdp });
    });
  }

  /** Connects to every connected party member without a link, and drops links to ex-members. */
  function connectParty(): void {
    if (status !== "live" || !local || selfId === null) return;

    const members = new Set(party.map((member) => member.id));
    for (const id of [...peers.keys()]) {
      if (!members.has(id)) drop(id);
    }

    const at = now();
    for (const member of party) {
      if (member.id === selfId || !member.connected || peers.has(member.id)) continue;
      const last = lastOfferAt.get(member.id);
      if (last !== undefined && at - last < reofferDelayMs) continue;
      offerTo(member.id, local);
    }
  }

  /**
   * Perfect negotiation, reduced to what this mesh needs: both sides may offer, and when two offers
   * cross, the player with the higher id is polite and yields to the other's.
   *
   * An offer can also go unanswered because its target did not have voice on yet and dropped it.
   * When that target later offers back, the impolite side sends its own offer again rather than
   * waiting on an answer that will never come; a polite side that already answered it drops the
   * repeat.
   */
  function isPoliteTowards(remoteId: PlayerId): boolean {
    return selfId !== null && selfId > remoteId;
  }

  return {
    state,

    /** Captures the microphone and joins the mesh. Call only from a player's explicit action. */
    async enable(): Promise<void> {
      if (status === "requesting" || status === "live") return;

      const started = generation;
      status = "requesting";
      notify();

      const result = await options.capture();
      if (started !== generation) {
        if (result.ok) result.audio.stop();
        return;
      }

      if (!result.ok) {
        status = result.reason;
        notify();
        return;
      }

      local = result.audio;
      status = "live";
      applyMic();
      connectParty();
      notify();
    },

    /** Leaves the mesh: closes every link and releases the microphone. */
    disable(): void {
      generation += 1;
      for (const id of [...peers.keys()]) drop(id);
      lastOfferAt.clear();
      local?.stop();
      local = null;
      if (status === "off") return;
      status = "off";
      notify();
    },

    setMuted(next: boolean): void {
      if (muted === next) return;
      muted = next;
      applyMic();
      notify();
    },

    setDeafened(next: boolean): void {
      if (deafened === next) return;
      deafened = next;
      applyMic();
      for (const peer of peers.values()) peer.link.setVolume(volumeFor(peer.id));
      notify();
    },

    /**
     * Who is in the party. Call on every view change: a new member is offered a link, a departed
     * one loses theirs, and a member who failed to connect is retried after the re-offer delay.
     * Disconnected members keep their link, since the peer connection does not run through the
     * server and may well outlive a socket drop.
     */
    syncParty(nextSelfId: PlayerId | null, members: PartyMember[]): void {
      const before = peers.size;
      selfId = nextSelfId;
      party = members;
      connectParty();
      if (peers.size !== before) notify();
    },

    /**
     * Applies a proximity update. A peer the update leaves out is silenced but keeps its link, so it
     * is audible again the moment it comes back into range.
     */
    applyRange(range: readonly PeerRange[]): void {
      ranges = new Map(range.map((peer) => [peer.playerId, peer.volume]));
      for (const peer of peers.values()) peer.link.setVolume(volumeFor(peer.id));
    },

    /** Handles a relayed signal. Resolves once it has been applied, which tests rely on. */
    async handleSignal(fromId: PlayerId, signal: VoiceSignal): Promise<void> {
      if (status !== "live" || !local || selfId === null || fromId === selfId) return;
      if (!party.some((member) => member.id === fromId)) return;

      const existing = peers.get(fromId);

      switch (signal.kind) {
        case "offer": {
          if (existing && existing.remoteOfferSdp === signal.sdp) return;

          if (existing?.awaitingAnswer && !isPoliteTowards(fromId)) {
            const peer = existing;
            await enqueue(peer, async () => {
              if (peer.localOfferSdp !== null) {
                options.sendSignal(fromId, { kind: "offer", sdp: peer.localOfferSdp });
              }
            });
            return;
          }

          // An offer on a link that is not mid-offer means the other side started over, after
          // re-enabling voice or losing its connection. Nothing here renegotiates a live link, so
          // a fresh one is always the right answer.
          const peer = existing?.awaitingAnswer ? existing : createPeer(fromId, local);
          peer.awaitingAnswer = false;
          peer.remoteOfferSdp = signal.sdp;
          await enqueue(peer, async () => {
            const sdp = await peer.link.acceptOffer(signal.sdp);
            await flushCandidates(peer);
            options.sendSignal(fromId, { kind: "answer", sdp });
          });
          return;
        }

        case "answer": {
          if (!existing?.awaitingAnswer) return;
          existing.awaitingAnswer = false;
          await enqueue(existing, async () => {
            await existing.link.acceptAnswer(signal.sdp);
            await flushCandidates(existing);
          });
          return;
        }

        case "iceCandidate": {
          if (!existing) return;
          const candidate: IceCandidate = {
            candidate: signal.candidate,
            sdpMid: signal.sdpMid,
            sdpMLineIndex: signal.sdpMLineIndex,
          };
          await enqueue(existing, async () => {
            if (existing.link.hasRemoteDescription()) {
              await addCandidate(existing, candidate);
            } else {
              existing.pendingCandidates.push(candidate);
            }
          });
          return;
        }
      }
    },

    /** Microphone loudness for the meter; zero whenever nothing is being sent. */
    inputLevel(): number {
      if (!local || muted || deafened) return 0;
      return local.level();
    },

    peerIds(): PlayerId[] {
      return [...peers.keys()];
    },
  };
}

export type VoiceMesh = ReturnType<typeof createVoiceMesh>;

/** What the HUD's Voice readout says. */
export function voiceStatusLabel(state: VoiceState): string {
  switch (state.status) {
    case "off":
      return "off";
    case "requesting":
      return "requesting microphone";
    case "denied":
      return "microphone blocked";
    case "unavailable":
      return "no microphone";
    case "live":
      if (state.deafened) return "deafened";
      if (state.muted) return "muted";
      return state.peerCount === 1 ? "on, 1 peer" : `on, ${state.peerCount} peers`;
  }
}
