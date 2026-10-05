# 0012 - Client Voice Mesh

## Context

The server relays WebRTC handshakes between party members (`voiceSignal` / `voiceSignalRelay`) and
sends each player a `voiceRangeUpdated` with a volume for every peer they can see and hear
(decision 0005). Voice is "always connected with distance-based volume": the party should stay
connected and proximity should only change how loud each peer is.

## Decision

The browser keeps one `RTCPeerConnection` per party member, in a full mesh. The logic lives in
`src/client/audio/voiceMesh.ts` and never touches a browser API; `src/client/audio/browserVoice.ts`
supplies the microphone and the peer connections. That split is what lets Vitest cover negotiation,
volume, and cleanup with fakes, while a Playwright spec covers two real Chromium peers.

- **Opt-in capture.** The microphone is captured only when the player clicks Enable Voice, and held
  until they disable voice, leave, time out of the reconnect window, or are refused on a rejoin.
  A socket drop alone keeps it: the audio does not run through the server.
- **Who offers.** Any side with voice on offers to every connected party member it has no link to.
  An offer reaching a player without voice is dropped. When two offers cross, the player with the
  higher id is polite and yields. The impolite side re-sends its pending offer, which covers the
  case where the other side dropped it earlier for lack of voice; a polite side that already
  answered recognizes the repeat by its SDP and drops it.
- **No renegotiation.** Tracks are fixed when a link is built, and muting disables the track rather
  than removing it. So an offer arriving on a settled link means the other side started over, and
  it gets a fresh link.
- **Volume.** Every remote stream plays at the volume of the latest `voiceRangeUpdated`. A peer the
  update leaves out plays at 0 and keeps its link, so it is audible again the moment it is back.
  Deafen holds every stream at 0 and mutes the microphone too.
- **Failure.** A link whose connection reaches `failed` or `closed`, or whose negotiation throws,
  is dropped and offered again on a later party sync, no sooner than `DEFAULT_REOFFER_DELAY_MS`
  (5s) after the last attempt, so a peer that cannot connect does not drain the signaling budget.
- **ICE servers.** `VITE_ICE_SERVERS` lists STUN/TURN URLs. Unset uses one public STUN server; an
  empty value uses none, which is enough on one LAN. No TURN server is provided.

## Consequences

- No protocol change. The client sends only shapes the server already validates.
- A full mesh sends each player's audio to up to three peers, which is fine for parties of four.
- Players behind symmetric NATs cannot connect without a TURN server; that is deployment work.
- Proximity is advisory to the client: audio is peer to peer, so a modified client could ignore the
  volume. The server cannot enforce it without relaying audio, which is out of scope.
