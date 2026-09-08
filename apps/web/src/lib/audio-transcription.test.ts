import { describe, expect, test } from "vite-plus/test";

import {
  encodePcmWav,
  getTranscriptionAudioFormat,
  prepareTranscriptionRecording,
} from "./audio-transcription";

describe("audio transcription", () => {
  test("preserves supported audio bytes without decoding or transcoding", async () => {
    await expect(
      prepareTranscriptionRecording({
        blob: new Blob([new Uint8Array([0, 1, 128, 255])]),
        durationMs: 1000,
        mimeType: "audio/mpeg",
      })
    ).resolves.toStrictEqual({
      audioBase64: "AAGA/w==",
      durationMs: 1000,
      format: "mp3",
    });
  });

  test("rejects excessive duration before decoding browser audio", async () => {
    await expect(
      prepareTranscriptionRecording({
        blob: new Blob(),
        durationMs: 60_001,
        mimeType: "audio/webm",
      })
    ).rejects.toMatchObject({ status: 400 });
  });

  test("encodes mono 16-bit PCM WAV data", () => {
    const bytes = encodePcmWav([new Float32Array([-1, 0, 1])], 48_000);
    const view = new DataView(bytes.buffer);

    expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(bytes.subarray(8, 12))).toBe("WAVE");
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(48_000);
  });

  test("writes PCM payload bounds", () => {
    const bytes = encodePcmWav([new Float32Array([-1, 0, 1])], 48_000);
    const view = new DataView(bytes.buffer);

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
