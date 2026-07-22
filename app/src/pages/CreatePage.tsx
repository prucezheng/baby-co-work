import { useMemo, useRef, useState } from 'react';
import type { FamilyMember } from '../domain/types';
import { publishTextTask, publishVoiceTask } from '../api/client';
import type { PublishedSubtask, PublishedTask } from '../api/client';
import { VoiceRecorder } from '../components/VoiceRecorder';
import type { VoiceRecording } from '../components/VoiceRecorder';
import videoPlusUrl from '../assets/figma-create/video-plus.png';

interface CreatePageProps {
  latestTask: PublishedTask | null;
  onPublished(task: PublishedTask): void;
}

const demoMembers: FamilyMember[] = [
  {
    member_id: 'member-dad',
    display_name: '爸爸',
    role: '爸爸',
    pin_hash: 'server-only-demo-hash',
    identity_claimed: true,
    experience: 'basic',
    available_slots: ['evening', 'night'],
    limitations: [],
    preference: 'assist',
    temporary_unavailable: false
  },
  {
    member_id: 'member-grandma',
    display_name: '奶奶',
    role: '奶奶',
    pin_hash: 'server-only-demo-hash',
    identity_claimed: true,
    experience: 'experienced',
    available_slots: ['morning', 'daytime'],
    limitations: ['不可夜间照护'],
    preference: 'simple',
    temporary_unavailable: false
  },
  {
    member_id: 'member-mom',
    display_name: '妈妈',
    role: '妈妈',
    pin_hash: 'server-only-demo-hash',
    identity_claimed: true,
    experience: 'experienced',
    available_slots: ['morning', 'daytime', 'evening', 'night'],
    limitations: [],
    preference: 'lead',
    temporary_unavailable: false
  }
];

type CreateStatus = 'idle' | 'transcribing' | 'generating' | 'success' | 'error';

function makeRequestId(prefix: string) {
  if ('randomUUID' in crypto) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function CreatePage({ latestTask, onPublished }: CreatePageProps) {
  const [text, setText] = useState('爸爸今晚八点前把宝宝睡前用品准备好');
  const [status, setStatus] = useState<CreateStatus>('idle');
  const [message, setMessage] = useState('');
  const [transcript, setTranscript] = useState('');
  const pendingRecordingRef = useRef<VoiceRecording | null>(null);

  const canSubmitText = text.trim().length >= 2 && text.trim().length <= 500 && status !== 'generating' && status !== 'transcribing';
  const statusLabel = useMemo(() => {
    if (status === 'transcribing') return '正在把语音变成任务…';
    if (status === 'generating') return '正在补充步骤并安排负责人…';
    if (status === 'success') return '任务已发布，你可以继续修改';
    if (status === 'error') return message;
    return '输入一件需要家人完成的照护安排';
  }, [message, status]);

  async function submitText(rawInput = text) {
    const normalized = rawInput.trim();
    if (normalized.length < 2 || normalized.length > 500) {
      setStatus('error');
      setMessage('文字输入需为 2–500 个字符');
      return;
    }
    setStatus('generating');
    setMessage('');
    try {
      const task = await publishTextTask({
        requestId: makeRequestId('text'),
        rawInput: normalized,
        members: demoMembers,
        currentTime: new Date().toISOString(),
        dailyLoadMinutes: { 'member-dad': 0, 'member-grandma': 30, 'member-mom': 45 }
      });
      onPublished(task);
      setStatus('success');
      setMessage('任务已发布，你可以继续修改');
    } catch (error) {
      const fallbackTask = buildFallbackTask(normalized);
      onPublished(fallbackTask);
      setStatus('success');
      setMessage(error instanceof Error ? `API 未及时返回：${error.message}` : 'API 未及时返回，已按原文保存任务');
    }
  }

  async function submitVoice(recording: VoiceRecording) {
    pendingRecordingRef.current = recording;
    setStatus('transcribing');
    setMessage('');
    setTranscript('');
    try {
      const result = await publishVoiceTask({
        requestId: makeRequestId('voice'),
        audio: recording.blob,
        durationSec: recording.durationSec,
        members: demoMembers,
        currentTime: new Date().toISOString(),
        dailyLoadMinutes: { 'member-dad': 0, 'member-grandma': 30, 'member-mom': 45 }
      });
      setTranscript(result.transcript);
      setText(result.transcript);
      onPublished(result.task);
      setStatus('success');
      setMessage('语音已转成任务并发布');
      pendingRecordingRef.current = null;
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : '语音转写失败，录音已保留，可重试或改用文字');
    }
  }

  function retryVoice() {
    if (pendingRecordingRef.current) {
      void submitVoice(pendingRecordingRef.current);
    }
  }

  return (
    <section className="create-page">
      <div className={`status-banner ${status}`} role={status === 'error' ? 'alert' : 'status'} aria-live="polite">
        <span />
        {statusLabel}
      </div>

      <section className="input-panel">
        <label htmlFor="task-input">说说需要家人做什么</label>
        <textarea
          id="task-input"
          maxLength={500}
          minLength={2}
          placeholder="例如：爸爸今晚八点前把宝宝睡前用品准备好"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <div className="input-meta">
          <span>{text.trim().length}/500</span>
          <button type="button" onClick={() => setText('奶奶明天早上帮忙把换洗衣物整理一下，放到护理台旁边')}>
            使用示例
          </button>
        </div>
        <div className="hand-drawn-lines" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </section>

      <section className="voice-panel" aria-label="语音创建任务">
        <VoiceRecorder
          disabled={status === 'generating' || status === 'transcribing'}
          onRecordingReady={(recording) => void submitVoice(recording)}
          onError={(error) => {
            setStatus('error');
            setMessage(error);
          }}
        />
        {status === 'error' && pendingRecordingRef.current ? (
          <div className="retry-row">
            <button className="outline-button" type="button" onClick={retryVoice}>
              重试转写
            </button>
            <button className="ghost-button" type="button" onClick={() => setStatus('idle')}>
              改用文字
            </button>
          </div>
        ) : null}
      </section>

      <section className="video-note">
        <img src={videoPlusUrl} alt="" />
        <strong>参考视频</strong>
        <p>添加“怎么完成”的参考视频</p>
        <small>支持 MP4, MOV 格式</small>
        <button type="button" disabled>
          视频不会生成任务
        </button>
      </section>

      <button className="primary-button submit" type="button" disabled={!canSubmitText} onClick={() => void submitText()}>
        生成并发布任务
      </button>

      {transcript ? (
        <section className="transcript-card">
          <h2>语音转写</h2>
          <p>{transcript}</p>
        </section>
      ) : null}

      {latestTask ? (
        <article className="result-card">
          <div className="result-head">
            <span>{latestTask.input_type === 'voice' ? '语音任务' : '文字任务'}</span>
            <strong>{latestTask.assignee_member_id ? `负责人：${memberName(latestTask.assignee_member_id)}` : '待认领'}</strong>
          </div>
          <h2>{latestTask.title}</h2>
          <p>{latestTask.completion_criteria}</p>
          <div className="task-facts">
            <span>预计 {latestTask.duration_min} 分钟</span>
            <span>{latestTask.due_at ? new Date(latestTask.due_at).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '时间待定'}</span>
          </div>
          <ol>
            {latestTask.subtasks.map((subtask) => (
              <li key={subtask.subtask_id}>{subtask.title}</li>
            ))}
          </ol>
          <small>{latestTask.assignment_reason}</small>
          {latestTask.safety_notice ? <p className="safety-notice">{latestTask.safety_notice}</p> : null}
        </article>
      ) : null}
    </section>
  );
}

function memberName(memberId: string) {
  return demoMembers.find((member) => member.member_id === memberId)?.display_name ?? memberId;
}

function buildFallbackTask(rawInput: string): PublishedTask {
  const assignee = rawInput.includes('奶奶') ? 'member-grandma' : rawInput.includes('妈妈') ? 'member-mom' : 'member-dad';
  const title = rawInput.includes('睡前')
    ? '准备睡前用品'
    : rawInput.includes('衣')
      ? '整理宝宝衣物'
      : rawInput.includes('库存') || rawInput.includes('纸尿裤')
        ? '检查护理库存'
        : rawInput.slice(0, 16);
  const taskId = makeRequestId('fallback-task');
  const subtasks = ['确认需要完成的物品', '按家庭约定放到固定位置', '完成后在今日任务里标记'].map((text, index) =>
    makeFallbackSubtask(taskId, text, index + 1)
  );

  return {
    task_id: taskId,
    title,
    raw_input: rawInput,
    input_type: 'text',
    assignee_member_id: assignee,
    due_at: new Date(new Date().setHours(20, 0, 0, 0)).toISOString(),
    duration_min: 12,
    completion_criteria: '按原始安排完成，并在 To-do 中由本人标记完成。',
    assignment_reason: '演示降级任务：真实 API 未在时间窗口内返回，先按家庭角色关键词分配。',
    status: 'open',
    safety_notice: null,
    subtasks
  };
}

function makeFallbackSubtask(taskId: string, title: string, order: number): PublishedSubtask {
  return {
    subtask_id: `${taskId}-sub-${order}`,
    parent_task_id: taskId,
    title,
    order,
    required: order === 1,
    source: order === 1 ? 'user' : 'knowledge',
    completed: false
  };
}
