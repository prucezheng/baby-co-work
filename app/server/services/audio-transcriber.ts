import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getConfig } from '../config';

export class TranscriptionServiceError extends Error {
  readonly code: 'AUDIO_EMPTY' | 'AUDIO_TOO_LARGE' | 'TRANSCRIPTION_FAILED' | 'TRANSCRIPTION_TIMEOUT';

  constructor(code: TranscriptionServiceError['code'], message: string) {
    super(message);
    this.name = 'TranscriptionServiceError';
    this.code = code;
  }
}

export interface AudioTranscriber {
  transcribe(input: { buffer: Buffer; originalName?: string; mimeType?: string }): Promise<string>;
}

const MAX_AUDIO_BYTES = 26_214_400;
const DEFAULT_TIMEOUT_MS = 240_000;

function extensionForMime(mimeType: string | undefined, originalName: string | undefined): string {
  const originalExt = originalName?.split('.').pop()?.toLowerCase();
  if (originalExt && /^[a-z0-9]{2,5}$/.test(originalExt)) return originalExt;
  switch (mimeType) {
    case 'audio/wav':
      return 'wav';
    case 'audio/mpeg':
      return 'mp3';
    case 'audio/mp4':
      return 'm4a';
    case 'video/mp4':
      return 'mp4';
    case 'video/webm':
    case 'audio/webm':
    default:
      return 'webm';
  }
}

export function createAudioTranscriber(): AudioTranscriber {
  return {
    async transcribe({ buffer, originalName, mimeType }) {
      if (buffer.length === 0) {
        throw new TranscriptionServiceError('AUDIO_EMPTY', '录音为空');
      }
      if (buffer.length > MAX_AUDIO_BYTES) {
        throw new TranscriptionServiceError('AUDIO_TOO_LARGE', '录音文件超过限制');
      }

      const config = getConfig();
      const tempDir = await mkdtemp(join(tmpdir(), 'baby-voice-'));
      const ext = extensionForMime(mimeType, originalName);
      const audioPath = join(tempDir, `recording.${ext}`);

      try {
        await writeFile(audioPath, buffer);
        return await runTranscriber(config.pythonBin, config.audioTranscriberDir, audioPath);
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    }
  };
}

function runTranscriber(pythonBin: string, cwd: string, audioPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonBin, ['-m', 'ark_audio_transcriber', audioPath], {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new TranscriptionServiceError('TRANSCRIPTION_TIMEOUT', '语音转写超时'));
    }, DEFAULT_TIMEOUT_MS);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(new TranscriptionServiceError('TRANSCRIPTION_FAILED', error.message));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(
          new TranscriptionServiceError(
            'TRANSCRIPTION_FAILED',
            stderr.trim() || `语音转写进程退出：${code}`
          )
        );
        return;
      }
      const transcript = stdout.trim();
      if (!transcript || transcript === '[听不清]') {
        reject(new TranscriptionServiceError('TRANSCRIPTION_FAILED', '未识别到有效语音内容'));
        return;
      }
      resolve(transcript);
    });
  });
}
