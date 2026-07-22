import { useEffect, useRef, useState } from 'react';
import circleUrl from '../assets/figma-create/hand-drawn-circle.png';
import micUrl from '../assets/figma-create/mic.svg';

export interface VoiceRecording {
  blob: Blob;
  durationSec: number;
}

interface VoiceRecorderProps {
  disabled?: boolean;
  onRecordingReady(recording: VoiceRecording): void;
  onError(message: string): void;
}

const MAX_SECONDS = 60;

export function VoiceRecorder({ disabled = false, onRecordingReady, onError }: VoiceRecorderProps) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);

  useEffect(() => {
    if (!recording) return undefined;
    const timer = window.setInterval(() => {
      const elapsed = Math.min(MAX_SECONDS, Math.floor((Date.now() - startedAtRef.current) / 1000));
      setSeconds(elapsed);
      if (elapsed >= MAX_SECONDS) {
        stopRecording();
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, [recording]);

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : undefined;
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      setSeconds(0);

      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      });
      recorder.addEventListener('stop', () => {
        stream.getTracks().forEach((track) => track.stop());
        const durationSec = Math.max(1, Math.min(MAX_SECONDS, Math.ceil((Date.now() - startedAtRef.current) / 1000)));
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        if (blob.size === 0) {
          onError('未录到声音，请重试或改用文字输入');
          return;
        }
        onRecordingReady({ blob, durationSec });
      });
      recorder.start();
      setRecording(true);
    } catch {
      onError('无法使用麦克风，请允许录音权限，或改用文字输入');
    }
  }

  function stopRecording() {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;
    recorder.stop();
    setRecording(false);
  }

  function cancelRecording() {
    chunksRef.current = [];
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stream.getTracks().forEach((track) => track.stop());
      recorder.stop();
    }
    setRecording(false);
    setSeconds(0);
  }

  return (
    <div className="voice-recorder">
      <div className="recorder-actions">
        {recording ? (
          <>
            <button className="primary-button" type="button" onClick={stopRecording}>
              停止录音
            </button>
            <button className="ghost-button" type="button" onClick={cancelRecording}>
              取消
            </button>
          </>
        ) : (
          <button className="record-button" type="button" disabled={disabled} onClick={startRecording}>
            <img className="record-circle" src={circleUrl} alt="" aria-hidden="true" />
            <img className="mic-icon" src={micUrl} alt="" aria-hidden="true" />
            开始录音
          </button>
        )}
        <span className="timer" aria-live="polite">
          {recording ? `${seconds}s / 60s` : '(最长 60s)'}
        </span>
      </div>
    </div>
  );
}
