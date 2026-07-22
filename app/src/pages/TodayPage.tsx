import { useMemo, useState } from 'react';
import type { AppTab, CareTask, MemberView } from '../app/App';

interface TodayPageProps {
  feedback: string;
  tasks: CareTask[];
  members: MemberView[];
  memberMap: Map<string, MemberView>;
  onComplete(taskId: string): void;
  onDecompose(taskId: string): void;
  onReassign(taskId: string, memberId: string): void;
  onSkip(taskId: string): void;
  onSwitchTab(tab: AppTab): void;
  onToggleSubtask(taskId: string, subtaskId: string): void;
}

export function TodayPage({
  feedback,
  tasks,
  members,
  memberMap,
  onComplete,
  onDecompose,
  onReassign,
  onSkip,
  onSwitchTab,
  onToggleSubtask
}: TodayPageProps) {
  const [selectedTaskId, setSelectedTaskId] = useState(tasks[0]?.task_id ?? '');
  const selectedTask = tasks.find((task) => task.task_id === selectedTaskId) ?? null;
  const completedCount = tasks.filter((task) => task.status === 'completed').length + 4;
  const totalCount = Math.max(7, tasks.length + 4);
  const progress = Math.min(100, Math.round((completedCount / totalCount) * 100));

  const sortedTasks = useMemo(
    () =>
      [...tasks].sort((a, b) => {
        if (a.status === 'completed' && b.status !== 'completed') return 1;
        if (a.status !== 'completed' && b.status === 'completed') return -1;
        return (a.due_at ?? '').localeCompare(b.due_at ?? '');
      }),
    [tasks]
  );

  return (
    <section className="today-page surface-page">
      <div className="today-hero">
        <p>今日任务</p>
        <h1>{completedCount}/{totalCount}</h1>
        <span>照护计划完成度 {progress}%</span>
      </div>

      <article className="impact-card today-impact">
        <span className="impact-icon">●</span>
        <div>
          <small>今日成就反馈</small>
          <p>{feedback}</p>
        </div>
      </article>

      <div className="section-row">
        <h2>To-do</h2>
        <button type="button" onClick={() => onSwitchTab('create')}>
          新建
        </button>
      </div>

      <div className="task-list">
        {sortedTasks.map((task) => {
          const assignee = memberMap.get(task.assignee_member_id ?? '')?.displayName ?? '待认领';
          const doneSteps = task.subtasks.filter((subtask) => subtask.completed).length;
          return (
            <article className={`task-card ${task.status}`} key={task.task_id}>
              <button className="task-main" type="button" onClick={() => setSelectedTaskId(task.task_id)}>
                <span className="task-state" aria-hidden="true">
                  {task.status === 'completed' ? '✓' : ''}
                </span>
                <span>
                  <strong>{task.title}</strong>
                  <small>
                    {formatTime(task.due_at)} · {assignee} · {doneSteps}/{task.subtasks.length} 步
                  </small>
                </span>
              </button>
              <button
                className="task-complete"
                type="button"
                disabled={task.status === 'completed'}
                onClick={() => onComplete(task.task_id)}
              >
                完成
              </button>
            </article>
          );
        })}
      </div>

      {selectedTask ? (
        <TaskDetailSheet
          members={members}
          task={selectedTask}
          memberMap={memberMap}
          onComplete={onComplete}
          onDecompose={onDecompose}
          onReassign={onReassign}
          onSkip={onSkip}
          onToggleSubtask={onToggleSubtask}
        />
      ) : null}
    </section>
  );
}

function TaskDetailSheet({
  task,
  members,
  memberMap,
  onComplete,
  onDecompose,
  onReassign,
  onSkip,
  onToggleSubtask
}: {
  task: CareTask;
  members: MemberView[];
  memberMap: Map<string, MemberView>;
  onComplete(taskId: string): void;
  onDecompose(taskId: string): void;
  onReassign(taskId: string, memberId: string): void;
  onSkip(taskId: string): void;
  onToggleSubtask(taskId: string, subtaskId: string): void;
}) {
  const assignee = memberMap.get(task.assignee_member_id ?? '');
  return (
    <aside className="task-detail" aria-label="任务详情">
      <div className="task-detail-head">
        <span>{task.input_type === 'voice' ? '语音创建' : '文字创建'}</span>
        <strong>{assignee?.displayName ?? '待认领'}</strong>
      </div>
      <h2>{task.title}</h2>
      <p>{task.completion_criteria}</p>

      <div className="detail-grid">
        <span>截止 {formatTime(task.due_at)}</span>
        <span>预计 {task.duration_min} min</span>
      </div>

      <div className="subtask-list">
        {task.subtasks.map((subtask) => (
          <label key={subtask.subtask_id}>
            <input
              checked={subtask.completed}
              type="checkbox"
              onChange={() => onToggleSubtask(task.task_id, subtask.subtask_id)}
            />
            <span>{subtask.title}</span>
          </label>
        ))}
      </div>

      {task.has_reference_video ? (
        <button className="reference-video" type="button">
          <span>▶</span>
          查看“怎么完成”的参考视频
        </button>
      ) : null}

      <div className="assignee-switcher" aria-label="改派任务">
        {members.map((member) => (
          <button
            className={task.assignee_member_id === member.memberId ? 'is-selected' : ''}
            key={member.memberId}
            type="button"
            onClick={() => onReassign(task.task_id, member.memberId)}
          >
            {member.displayName}
          </button>
        ))}
      </div>

      <div className="detail-actions">
        <button type="button" onClick={() => onDecompose(task.task_id)}>
          AI 分解
        </button>
        <button type="button" onClick={() => onSkip(task.task_id)}>
          跳过
        </button>
        <button className="solid-action" type="button" disabled={task.status === 'completed'} onClick={() => onComplete(task.task_id)}>
          本人完成
        </button>
      </div>
    </aside>
  );
}

function formatTime(value: string | null) {
  if (!value) return '待定';
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}
