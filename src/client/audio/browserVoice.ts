import type {
  CaptureResult,
  IceCandidate,
  LocalAudio,
  PeerConnectionState,
  PeerLink,
  PeerLinkEvents,
} from "./voiceMesh.js";

/** The captured microphone, plus the stream peer links send. */
export interface BrowserLocalAudio extends LocalAudio {
  readonly stream: MediaStream;
}

/**
 * Asks for the microphone. The meter's AudioContext is built before the permission prompt, while
 * the click that asked for voice still counts as a user gesture; built after, it can start
 * suspended and read silence forever.
 */
export async function captureMicrophone(): Promise<CaptureResult<BrowserLocalAudio>> {
  if (!navigator.mediaDevices?.getUserMedia) return { ok: false, reason: "unavailable" };

  const context = createAudioContext();

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (error) {
    void context?.close().catch(() => undefined);
    // No device at all, or one another application holds, is not something a permission prompt
    // can fix, so it is reported apart from a refusal.
    const name = error instanceof DOMException ? error.name : "";
    const missing = name === "NotFoundError" || name === "NotReadableError";
    return { ok: false, reason: missing ? "unavailable" : "denied" };
  }

  const meter = context ? createMeter(context, stream) : null;

  return {
    ok: true,
    audio: {
      stream,
      setMuted(muted) {
        // A disabled track sends silence and keeps the connection, so muting costs no renegotiation.
        for (const track of stream.getAudioTracks()) track.enabled = !muted;
      },
      level: () => meter?.level() ?? 0,
      stop() {
        for (const track of stream.getTracks()) track.stop();
        void context?.close().catch(() => undefined);
      },
    },
  };
}

function createAudioContext(): AudioContext | null {
  try {
    const context = new AudioContext();
    void context.resume().catch(() => undefined);
    return context;
  } catch {
    return null;
  }
}

/** RMS of the microphone's waveform, scaled so ordinary speech fills most of the meter. */
function createMeter(context: AudioContext, stream: MediaStream) {
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  context.createMediaStreamSource(stream).connect(analyser);
  const samples = new Float32Array(analyser.fftSize);

  return {
    level(): number {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += sample * sample;
      return Math.min(1, Math.sqrt(sum / samples.length) * 4);
    },
  };
}

/**
 * ICE servers from `VITE_ICE_SERVERS`, a comma-separated list of STUN/TURN URLs. Unset uses one
 * public STUN server so players on different networks can find each other; an empty value disables
 * STUN, which still works on one LAN.
 */
export function iceServersFrom(raw: string | undefined): RTCIceServer[] {
  const value = raw ?? "stun:stun.l.google.com:19302";
  return value
    .split(",")
    .map((url) => url.trim())
    .filter((url) => url.length > 0)
    .map((urls) => ({ urls }));
}

export function createBrowserPeerLink(
  local: BrowserLocalAudio,
  events: PeerLinkEvents,
  iceServers: RTCIceServer[],
): PeerLink {
  const connection = new RTCPeerConnection({ iceServers });
  for (const track of local.stream.getAudioTracks()) connection.addTrack(track, local.stream);

  // Remote WebRTC audio only plays through a media element; Web Audio alone stays silent in Chrome.
  const audio = new Audio();
  audio.autoplay = true;
  let volume = 0;

  connection.ontrack = (event) => {
    audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
    audio.volume = volume;
    void audio.play().catch(() => undefined);
  };

  connection.onicecandidate = (event) => {
    // A null or empty candidate marks the end of gathering, which the protocol has no message for.
    if (!event.candidate?.candidate) return;
    events.onIceCandidate({
      candidate: event.candidate.candidate,
      sdpMid: event.candidate.sdpMid,
      sdpMLineIndex: event.candidate.sdpMLineIndex,
    });
  };

  connection.onconnectionstatechange = () => {
    events.onConnectionStateChange(connection.connectionState as PeerConnectionState);
  };

  return {
    hasRemoteDescription: () => connection.remoteDescription !== null,

    async createOffer() {
      await connection.setLocalDescription(await connection.createOffer());
      return connection.localDescription?.sdp ?? "";
    },

    async acceptOffer(sdp) {
      if (connection.signalingState !== "stable") {
        await connection.setLocalDescription({ type: "rollback" });
      }
      await connection.setRemoteDescription({ type: "offer", sdp });
      await connection.setLocalDescription(await connection.createAnswer());
      return connection.localDescription?.sdp ?? "";
    },

    async acceptAnswer(sdp) {
      await connection.setRemoteDescription({ type: "answer", sdp });
    },

    async addIceCandidate(candidate: IceCandidate) {
      await connection.addIceCandidate(candidate);
    },

    setVolume(next) {
      volume = Math.min(1, Math.max(0, next));
      audio.volume = volume;
    },

    close() {
      connection.ontrack = null;
      connection.onicecandidate = null;
      connection.onconnectionstatechange = null;
      connection.close();
      audio.pause();
      audio.srcObject = null;
    },
  };
}
