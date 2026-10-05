import { describe, expect, it } from "vitest";
import {
  createVoiceMesh,
  voiceStatusLabel,
  type CaptureResult,
  type IceCandidate,
  type LocalAudio,
  type PartyMember,
  type PeerLink,
  type PeerLinkEvents,
  type VoiceState,
} from "../../src/client/audio/voiceMesh.js";
import type { VoiceSignal } from "../../src/shared/protocol/index.js";

/**
 * Ids are ordered so the negotiation roles are obvious: `SELF` sorts between `LOW` and `HIGH`, so
 * it is polite towards `LOW` and impolite towards `HIGH` when two offers cross.
 */
const LOW = "1-low";
const SELF = "5-self";
const HIGH = "9-high";

class FakeAudio implements LocalAudio {
  muted = false;
  stopped = false;
  loudness = 0.6;
  setMuted(muted: boolean): void {
    this.muted = muted;
  }
  level(): number {
    return this.loudness;
  }
  stop(): void {
    this.stopped = true;
  }
}

class FakeLink implements PeerLink {
  state = "stable";
  remote = false;
  closed = false;
  rolledBack = false;
  volume: number | null = null;
  candidates: IceCandidate[] = [];
  failNext = false;

  constructor(
    readonly peerId: string,
    readonly events: PeerLinkEvents,
  ) {}

  hasRemoteDescription(): boolean {
    return this.remote;
  }
  async createOffer(): Promise<string> {
    this.state = "have-local-offer";
    return `offer-to-${this.peerId}`;
  }
  async acceptOffer(sdp: string): Promise<string> {
    if (this.state === "have-local-offer") this.rolledBack = true;
    this.state = "stable";
    this.remote = true;
    return `answer-to-${sdp}`;
  }
  async acceptAnswer(): Promise<void> {
    if (this.failNext) throw new Error("bad answer");
    this.state = "stable";
    this.remote = true;
  }
  async addIceCandidate(candidate: IceCandidate): Promise<void> {
    this.candidates.push(candidate);
  }
  setVolume(volume: number): void {
    this.volume = volume;
  }
  close(): void {
    this.closed = true;
    this.state = "closed";
  }
}

interface Sent {
  to: string;
  signal: VoiceSignal;
}

function harness(
  options: {
    capture?: () => Promise<CaptureResult<FakeAudio>>;
    reofferDelayMs?: number;
  } = {},
) {
  const audio = new FakeAudio();
  const links: FakeLink[] = [];
  const sent: Sent[] = [];
  const states: VoiceState[] = [];
  let captures = 0;
  let clock = 1_000;

  const mesh = createVoiceMesh<FakeAudio>({
    capture: async () => {
      captures += 1;
      return options.capture ? options.capture() : { ok: true, audio };
    },
    createPeerLink: (peerId, _local, events) => {
      const link = new FakeLink(peerId, events);
      links.push(link);
      return link;
    },
    sendSignal: (to, signal) => {
      sent.push({ to, signal });
      return true;
    },
    onChange: (state) => states.push(state),
    now: () => clock,
    reofferDelayMs: options.reofferDelayMs ?? 5_000,
  });

  return {
    mesh,
    audio,
    links,
    sent,
    states,
    captures: () => captures,
    advance: (ms: number) => {
      clock += ms;
    },
    /** Lets queued negotiation steps run. */
    settle: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
    /** The newest link made for a peer. */
    linkFor: (peerId: string): FakeLink => {
      const link = links.filter((candidate) => candidate.peerId === peerId).at(-1);
      if (!link) throw new Error(`no link for ${peerId}`);
      return link;
    },
  };
}

function party(...members: (string | PartyMember)[]): PartyMember[] {
  return members.map((member) =>
    typeof member === "string" ? { id: member, connected: true } : member,
  );
}

const offer = (sdp: string): VoiceSignal => ({ kind: "offer", sdp });
const answer = (sdp: string): VoiceSignal => ({ kind: "answer", sdp });
const candidate = (text: string): VoiceSignal => ({
  kind: "iceCandidate",
  candidate: text,
  sdpMid: "0",
  sdpMLineIndex: 0,
});

describe("microphone capture", () => {
  it("captures only when the player enables voice, and keeps the stream while enabled", async () => {
    const h = harness();
    h.mesh.syncParty(SELF, party(SELF, LOW));
    await h.settle();
    expect(h.captures()).toBe(0);
    expect(h.links).toHaveLength(0);

    await h.mesh.enable();
    expect(h.captures()).toBe(1);
    expect(h.mesh.state().status).toBe("live");

    // A second click while live does not ask again.
    await h.mesh.enable();
    expect(h.captures()).toBe(1);
    expect(h.audio.stopped).toBe(false);
  });

  it("reports a refused permission and connects to nobody", async () => {
    const h = harness({ capture: async () => ({ ok: false, reason: "denied" }) });
    h.mesh.syncParty(SELF, party(SELF, LOW));
    await h.mesh.enable();

    expect(h.mesh.state().status).toBe("denied");
    expect(h.states.map((state) => state.status)).toEqual(["requesting", "denied"]);
    expect(h.links).toHaveLength(0);
    expect(h.sent).toHaveLength(0);
  });

  it("can try again after a refusal", async () => {
    let allow = false;
    const audio = new FakeAudio();
    const h = harness({
      capture: async () => (allow ? { ok: true, audio } : { ok: false, reason: "unavailable" }),
    });
    await h.mesh.enable();
    expect(h.mesh.state().status).toBe("unavailable");

    allow = true;
    await h.mesh.enable();
    expect(h.mesh.state().status).toBe("live");
  });

  it("releases a microphone that arrives after voice was disabled", async () => {
    let grant: (result: CaptureResult<FakeAudio>) => void = () => undefined;
    const late = new FakeAudio();
    const h = harness({ capture: () => new Promise((resolve) => (grant = resolve)) });

    const enabling = h.mesh.enable();
    expect(h.mesh.state().status).toBe("requesting");
    h.mesh.disable();
    grant({ ok: true, audio: late });
    await enabling;

    expect(late.stopped).toBe(true);
    expect(h.mesh.state().status).toBe("off");
  });
});

describe("peer connections", () => {
  it("offers one link to each connected party member, and never to itself", async () => {
    const h = harness();
    h.mesh.syncParty(SELF, party(SELF, LOW, HIGH));
    await h.mesh.enable();
    await h.settle();

    expect(h.mesh.peerIds().sort()).toEqual([HIGH, LOW].sort());
    expect(h.links).toHaveLength(2);
    expect(h.sent.map((s) => [s.to, s.signal.kind]).sort()).toEqual(
      [
        [HIGH, "offer"],
        [LOW, "offer"],
      ].sort(),
    );

    // Snapshots re-sync the party every tick; that must not build more links.
    for (let tick = 0; tick < 5; tick += 1) h.mesh.syncParty(SELF, party(SELF, LOW, HIGH));
    await h.settle();
    expect(h.links).toHaveLength(2);
  });

  it("waits for a disconnected member, then offers once they are back", async () => {
    const h = harness();
    h.mesh.syncParty(SELF, party(SELF, { id: LOW, connected: false }));
    await h.mesh.enable();
    expect(h.links).toHaveLength(0);

    h.mesh.syncParty(SELF, party(SELF, LOW));
    await h.settle();
    expect(h.mesh.peerIds()).toEqual([LOW]);
    expect(h.sent[0]).toMatchObject({ to: LOW, signal: { kind: "offer" } });
  });

  it("answers an offer from a member it has no link to yet", async () => {
    const h = harness();
    // Shown as disconnected, so SELF does not offer first; the offer arrives as they come back.
    h.mesh.syncParty(SELF, party(SELF, { id: HIGH, connected: false }));
    await h.mesh.enable();
    await h.mesh.handleSignal(HIGH, offer("sdp-high"));

    expect(h.links).toHaveLength(1);
    expect(h.linkFor(HIGH).remote).toBe(true);
    expect(h.sent).toEqual([{ to: HIGH, signal: answer("answer-to-sdp-high") }]);
  });

  it("sends its ICE candidates and applies the peer's once the description is in", async () => {
    const h = harness();
    h.mesh.syncParty(SELF, party(SELF, LOW));
    await h.mesh.enable();
    await h.settle();
    const link = h.links[0]!;

    link.events.onIceCandidate({ candidate: "local-1", sdpMid: "0", sdpMLineIndex: 0 });
    expect(h.sent.at(-1)).toEqual({ to: LOW, signal: candidate("local-1") });

    // A candidate that beats the answer waits for it rather than being lost.
    await h.mesh.handleSignal(LOW, candidate("remote-early"));
    expect(link.candidates).toEqual([]);

    await h.mesh.handleSignal(LOW, answer("sdp-low"));
    await h.mesh.handleSignal(LOW, candidate("remote-late"));
    expect(link.candidates.map((c) => c.candidate)).toEqual(["remote-early", "remote-late"]);
  });

  it("yields to the other offer when it is polite and two offers cross", async () => {
    const h = harness();
    h.mesh.syncParty(SELF, party(SELF, LOW));
    await h.mesh.enable();
    await h.settle();
    const link = h.links[0]!;
    expect(link.state).toBe("have-local-offer");

    await h.mesh.handleSignal(LOW, offer("sdp-low"));

    expect(link.rolledBack).toBe(true);
    expect(h.links).toHaveLength(1);
    expect(h.sent.at(-1)).toEqual({ to: LOW, signal: answer("answer-to-sdp-low") });
  });

  it("keeps its own offer when it is impolite, and sends it again", async () => {
    const h = harness();
    h.mesh.syncParty(SELF, party(SELF, HIGH));
    await h.mesh.enable();
    await h.settle();
    expect(h.sent).toEqual([{ to: HIGH, signal: offer(`offer-to-${HIGH}`) }]);

    await h.mesh.handleSignal(HIGH, offer("sdp-high"));

    expect(h.links).toHaveLength(1);
    expect(h.links[0]!.rolledBack).toBe(false);
    expect(h.links[0]!.state).toBe("have-local-offer");
    // Re-sent, in case HIGH dropped the first copy before it had voice on.
    expect(h.sent).toEqual([
      { to: HIGH, signal: offer(`offer-to-${HIGH}`) },
      { to: HIGH, signal: offer(`offer-to-${HIGH}`) },
    ]);

    await h.mesh.handleSignal(HIGH, answer("sdp-answer"));
    expect(h.links[0]!.remote).toBe(true);
  });

  it("drops a repeat of an offer it has already answered", async () => {
    const h = harness();
    h.mesh.syncParty(SELF, party(SELF, LOW));
    await h.mesh.enable();
    await h.settle();
    await h.mesh.handleSignal(LOW, offer("sdp-low"));
    const sentBefore = h.sent.length;

    // LOW was impolite and re-sent the offer SELF already yielded to.
    await h.mesh.handleSignal(LOW, offer("sdp-low"));

    expect(h.links).toHaveLength(1);
    expect(h.links[0]!.closed).toBe(false);
    expect(h.sent).toHaveLength(sentBefore);
  });

  it("connects two meshes when one enabled voice long before the other", async () => {
    // Two real meshes wired back to back through their signals. SELF is impolite towards HIGH and
    // enables first, so HIGH drops SELF's offer; when HIGH enables, the pair must still connect.
    const self = harness();
    const high = harness();
    const deliver = async (from: typeof self, fromId: string, to: typeof self) => {
      while (from.sent.length > 0) {
        const next = from.sent.shift()!;
        await to.mesh.handleSignal(fromId, next.signal);
      }
    };
    self.mesh.syncParty(SELF, party(SELF, HIGH));
    high.mesh.syncParty(HIGH, party(SELF, HIGH));

    await self.mesh.enable();
    await self.settle();
    await deliver(self, SELF, high);
    expect(high.links).toHaveLength(0);

    await high.mesh.enable();
    await high.settle();
    for (let round = 0; round < 4; round += 1) {
      await deliver(high, HIGH, self);
      await deliver(self, SELF, high);
    }

    expect(self.linkFor(HIGH).remote).toBe(true);
    expect(high.linkFor(SELF).remote).toBe(true);
    expect(self.links.filter((link) => !link.closed)).toHaveLength(1);
    expect(high.links.filter((link) => !link.closed)).toHaveLength(1);
  });

  it("counts only peers whose connection is up", async () => {
    const h = harness();
    h.mesh.syncParty(SELF, party(SELF, LOW, HIGH));
    await h.mesh.enable();
    await h.settle();
    expect(h.mesh.state().peerCount).toBe(0);

    h.linkFor(LOW).events.onConnectionStateChange("connected");
    expect(h.mesh.state().peerCount).toBe(1);
    expect(h.states.at(-1)?.peerCount).toBe(1);

    h.linkFor(LOW).events.onConnectionStateChange("disconnected");
    expect(h.mesh.state().peerCount).toBe(0);
  });

  it("starts a fresh link when a peer offers again on a settled one", async () => {
    const h = harness();
    h.mesh.syncParty(SELF, party(SELF, LOW));
    await h.mesh.enable();
    await h.settle();
    await h.mesh.handleSignal(LOW, answer("sdp-low"));
    const first = h.links[0]!;
    expect(first.state).toBe("stable");

    // LOW re-enabled voice: its new offer cannot renegotiate the old connection.
    await h.mesh.handleSignal(LOW, offer("sdp-low-again"));

    expect(first.closed).toBe(true);
    expect(h.links).toHaveLength(2);
    expect(h.mesh.peerIds()).toEqual([LOW]);
    expect(h.sent.at(-1)).toEqual({ to: LOW, signal: answer("answer-to-sdp-low-again") });
  });

  it("ignores signals from outside the party and while voice is off", async () => {
    const h = harness();
    h.mesh.syncParty(SELF, party(SELF, LOW));
    await h.mesh.handleSignal(LOW, offer("too-early"));
    expect(h.links).toHaveLength(0);

    await h.mesh.enable();
    await h.settle();
    const linksBefore = h.links.length;
    await h.mesh.handleSignal("stranger", offer("sdp"));
    await h.mesh.handleSignal(SELF, offer("echo"));
    expect(h.links).toHaveLength(linksBefore);
  });

  it("drops a link whose negotiation fails, so it can be offered again", async () => {
    const h = harness({ reofferDelayMs: 1_000 });
    h.mesh.syncParty(SELF, party(SELF, LOW));
    await h.mesh.enable();
    await h.settle();
    const link = h.linkFor(LOW);
    link.failNext = true;

    await h.mesh.handleSignal(LOW, answer("garbled"));
    expect(link.closed).toBe(true);
    expect(h.mesh.peerIds()).toEqual([]);

    h.advance(1_000);
    h.mesh.syncParty(SELF, party(SELF, LOW));
    expect(h.mesh.peerIds()).toEqual([LOW]);
  });
});

describe("proximity volume", () => {
  async function connected() {
    const h = harness();
    h.mesh.syncParty(SELF, party(SELF, LOW, HIGH));
    await h.mesh.enable();
    await h.settle();
    return h;
  }

  it("starts every link silent until the server places the peer in range", async () => {
    const h = await connected();
    expect(h.links.map((link) => link.volume)).toEqual([0, 0]);
  });

  it("applies the server's volume to each remote stream", async () => {
    const h = await connected();
    h.mesh.applyRange([
      { playerId: LOW, volume: 0.8 },
      { playerId: HIGH, volume: 0.25 },
    ]);
    expect(h.linkFor(LOW).volume).toBe(0.8);
    expect(h.linkFor(HIGH).volume).toBe(0.25);
  });

  it("silences a peer the update leaves out, without closing its link", async () => {
    const h = await connected();
    h.mesh.applyRange([
      { playerId: LOW, volume: 0.8 },
      { playerId: HIGH, volume: 0.25 },
    ]);
    h.mesh.applyRange([{ playerId: LOW, volume: 0.7 }]);

    expect(h.linkFor(HIGH).volume).toBe(0);
    expect(h.linkFor(HIGH).closed).toBe(false);
    expect(h.mesh.peerIds()).toContain(HIGH);

    // Back in range, audible again on the same link.
    h.mesh.applyRange([{ playerId: HIGH, volume: 0.5 }]);
    expect(h.linkFor(HIGH).volume).toBe(0.5);
    expect(h.links).toHaveLength(2);
  });

  it("gives a link made after an update the volume already known for that peer", async () => {
    const h = harness();
    h.mesh.syncParty(SELF, party(SELF));
    await h.mesh.enable();
    h.mesh.applyRange([{ playerId: LOW, volume: 0.9 }]);
    h.mesh.syncParty(SELF, party(SELF, LOW));
    expect(h.links[0]!.volume).toBe(0.9);
  });
});

describe("mute and deafen", () => {
  it("mutes the microphone track and zeroes the input level", async () => {
    const h = harness();
    await h.mesh.enable();
    expect(h.mesh.inputLevel()).toBe(0.6);

    h.mesh.setMuted(true);
    expect(h.audio.muted).toBe(true);
    expect(h.mesh.inputLevel()).toBe(0);
    expect(h.mesh.state().muted).toBe(true);

    h.mesh.setMuted(false);
    expect(h.audio.muted).toBe(false);
  });

  it("applies a mute chosen before the microphone was captured", async () => {
    const h = harness();
    h.mesh.setMuted(true);
    await h.mesh.enable();
    expect(h.audio.muted).toBe(true);
  });

  it("silences every peer and the microphone while deafened, and restores both after", async () => {
    const h = harness();
    h.mesh.syncParty(SELF, party(SELF, LOW));
    await h.mesh.enable();
    await h.settle();
    h.mesh.applyRange([{ playerId: LOW, volume: 0.8 }]);

    h.mesh.setDeafened(true);
    expect(h.links[0]!.volume).toBe(0);
    expect(h.audio.muted).toBe(true);
    expect(h.mesh.inputLevel()).toBe(0);

    // Proximity updates keep arriving while deafened and must not leak through.
    h.mesh.applyRange([{ playerId: LOW, volume: 1 }]);
    expect(h.links[0]!.volume).toBe(0);

    h.mesh.setDeafened(false);
    expect(h.links[0]!.volume).toBe(1);
    expect(h.audio.muted).toBe(false);
  });

  it("keeps a separate mute through a deafen", async () => {
    const h = harness();
    await h.mesh.enable();
    h.mesh.setMuted(true);
    h.mesh.setDeafened(true);
    h.mesh.setDeafened(false);
    expect(h.audio.muted).toBe(true);
  });
});

describe("cleanup", () => {
  it("closes every link and releases the microphone on disable", async () => {
    const h = harness();
    h.mesh.syncParty(SELF, party(SELF, LOW, HIGH));
    await h.mesh.enable();
    await h.settle();

    h.mesh.disable();

    expect(h.links.every((link) => link.closed)).toBe(true);
    expect(h.audio.stopped).toBe(true);
    expect(h.mesh.peerIds()).toEqual([]);
    expect(h.mesh.state().status).toBe("off");
    expect(h.mesh.inputLevel()).toBe(0);

    // Later traffic finds nothing to reopen.
    await h.mesh.handleSignal(LOW, offer("sdp"));
    h.mesh.syncParty(SELF, party(SELF, LOW, HIGH));
    expect(h.links.filter((link) => !link.closed)).toHaveLength(0);
  });

  it("closes the link to a member who leaves or times out of the party", async () => {
    const h = harness();
    h.mesh.syncParty(SELF, party(SELF, LOW, HIGH));
    await h.mesh.enable();
    await h.settle();
    const lowLink = h.linkFor(LOW);

    h.mesh.syncParty(SELF, party(SELF, HIGH));

    expect(lowLink.closed).toBe(true);
    expect(h.mesh.peerIds()).toEqual([HIGH]);
  });

  it("keeps the link to a member whose socket dropped, since their audio need not have", async () => {
    const h = harness();
    h.mesh.syncParty(SELF, party(SELF, LOW));
    await h.mesh.enable();
    await h.settle();

    h.mesh.syncParty(SELF, party(SELF, { id: LOW, connected: false }));

    expect(h.links[0]!.closed).toBe(false);
    expect(h.mesh.peerIds()).toEqual([LOW]);
  });

  it("drops a failed connection and re-offers only after the delay", async () => {
    const h = harness({ reofferDelayMs: 5_000 });
    h.mesh.syncParty(SELF, party(SELF, LOW));
    await h.mesh.enable();
    await h.settle();
    const first = h.links[0]!;

    first.events.onConnectionStateChange("failed");
    expect(first.closed).toBe(true);
    expect(h.mesh.peerIds()).toEqual([]);

    h.mesh.syncParty(SELF, party(SELF, LOW));
    expect(h.links).toHaveLength(1);

    h.advance(5_000);
    h.mesh.syncParty(SELF, party(SELF, LOW));
    await h.settle();
    expect(h.links).toHaveLength(2);
    expect(h.sent.filter((s) => s.signal.kind === "offer")).toHaveLength(2);
  });

  it("rides out a recoverable disconnect without rebuilding", async () => {
    const h = harness();
    h.mesh.syncParty(SELF, party(SELF, LOW));
    await h.mesh.enable();
    await h.settle();

    h.links[0]!.events.onConnectionStateChange("disconnected");
    h.mesh.syncParty(SELF, party(SELF, LOW));

    expect(h.links).toHaveLength(1);
    expect(h.links[0]!.closed).toBe(false);
  });

  it("ignores events from a link it has already replaced", async () => {
    const h = harness();
    h.mesh.syncParty(SELF, party(SELF, LOW));
    await h.mesh.enable();
    await h.settle();
    await h.mesh.handleSignal(LOW, answer("sdp-low"));
    const stale = h.links[0]!;
    await h.mesh.handleSignal(LOW, offer("sdp-low-again"));
    const sentBefore = h.sent.length;

    stale.events.onIceCandidate({ candidate: "stale", sdpMid: null, sdpMLineIndex: null });
    stale.events.onConnectionStateChange("failed");

    expect(h.sent).toHaveLength(sentBefore);
    expect(h.mesh.peerIds()).toEqual([LOW]);
    expect(h.links[1]!.closed).toBe(false);
  });

  it("reconnects a whole party after voice is disabled and enabled again", async () => {
    const h = harness();
    h.mesh.syncParty(SELF, party(SELF, LOW, HIGH));
    await h.mesh.enable();
    await h.settle();
    h.mesh.disable();

    await h.mesh.enable();
    await h.settle();

    // The re-offer delay is per attempt within one enable; a fresh enable offers straight away.
    expect(h.links.filter((link) => !link.closed)).toHaveLength(2);
  });
});

describe("voiceStatusLabel", () => {
  const base: VoiceState = { status: "live", muted: false, deafened: false, peerCount: 2 };

  it("names each state the player can be in", () => {
    expect(voiceStatusLabel({ ...base, status: "off" })).toBe("off");
    expect(voiceStatusLabel({ ...base, status: "requesting" })).toBe("requesting microphone");
    expect(voiceStatusLabel({ ...base, status: "denied" })).toBe("microphone blocked");
    expect(voiceStatusLabel({ ...base, status: "unavailable" })).toBe("no microphone");
    expect(voiceStatusLabel(base)).toBe("on, 2 peers");
    expect(voiceStatusLabel({ ...base, peerCount: 1 })).toBe("on, 1 peer");
    expect(voiceStatusLabel({ ...base, muted: true })).toBe("muted");
    expect(voiceStatusLabel({ ...base, muted: true, deafened: true })).toBe("deafened");
  });
});
