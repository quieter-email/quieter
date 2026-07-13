import { describe, expect, test } from "vite-plus/test";
import { encodePcmWav, getTranscriptionAudioFormat } from "./audio-transcription";

describe("audio transcription", () => {
  test("encodes mono 16-bit PCM WAV data", () => {
    const bytes = encodePcmWav([new Float32Array([-1, 0, 1])], 48_000);
    const view = new DataView(bytes.buffer);

    expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(bytes.subarray(8, 12))).toBe("WAVE");
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(48_000);
    expect(view.getUint32(40, true)).toBe(6);
    expect(view.getInt16(44, true)).toBe(-32_768);
    expect(view.getInt16(48, true)).toBe(32_767);
  });

  test("normalizes recorder mime types", () => {
    expect(getTranscriptionAudioFormat("audio/webm;codecs=opus")).toBe("webm");
    expect(getTranscriptionAudioFormat("audio/wave")).toBe("wav");
    expect(getTranscriptionAudioFormat("video/webm")).toBeNull();
  });
});
