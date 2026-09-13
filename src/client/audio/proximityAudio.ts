export type VoiceStatus =
  | "voice disabled"
  | "requesting microphone"
  | "microphone ready"
  | "microphone denied";

export async function requestMicrophonePreview(): Promise<VoiceStatus> {
  if (!navigator.mediaDevices?.getUserMedia) {
    return "microphone denied";
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    return "microphone ready";
  } catch {
    return "microphone denied";
  }
}
