// 语音转文字：MVP 阶段客户端已提供 transcript 字段，
// 此服务作为后续真实转写的扩展点（接入 Ark / Whisper 等）。

export interface AudioTranscriber {
  transcribe(audioBase64: string, mimeType: string): Promise<string>;
}

/** MVP stub：直接返回空字符串，实际转写由客户端完成 */
export function createAudioTranscriber(): AudioTranscriber {
  return {
    async transcribe(_audioBase64: string, _mimeType: string): Promise<string> {
      // 生产环境接入 Ark ASR 或 Whisper
      return '';
    }
  };
}
