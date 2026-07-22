import { useMemo, useState } from 'react';
import { ContributionPage } from '../pages/ContributionPage';
import { CreatePage } from '../pages/CreatePage';
import { FamilyPage } from '../pages/FamilyPage';
import { TodayPage } from '../pages/TodayPage';
import type { PublishedSubtask, PublishedTask } from '../api/client';
import avatarUrl from '../assets/figma-create/avatar.png';
import chevronUrl from '../assets/figma-create/chevron.svg';
import navContributionUrl from '../assets/figma-create/nav-contribution.png';
import navCreateUrl from '../assets/figma-create/nav-create.png';
import navTodayUrl from '../assets/figma-create/nav-today.png';

export type AppTab = 'today' | 'create' | 'contribution' | 'family';

export interface MemberView {
  memberId: string;
  displayName: string;
  role: string;
  availability: string;
  focus: string;
  claimed: boolean;
  completedToday: number;
}

export interface CareTask extends PublishedTask {
  completed_at: string | null;
  skipped_at: string | null;
  edited_at: string | null;
  has_reference_video: boolean;
  subtasks: PublishedSubtask[];
}

const members: MemberView[] = [
  {
    memberId: 'member-mom',
    displayName: '妈妈',
    role: '主要协调者',
    availability: '全天可协调',
    focus: '喂养记录、动态调整',
    claimed: true,
    completedToday: 1
  },
  {
    memberId: 'member-dad',
    displayName: '爸爸',
    role: '晚间执行',
    availability: '19:00 后',
    focus: '睡前流程、物品准备',
    claimed: true,
    completedToday: 2
  },
  {
    memberId: 'member-grandma',
    displayName: '奶奶',
    role: '白天照护',
    availability: '07:00-17:00',
    focus: '衣物整理、护理台补给',
    claimed: true,
    completedToday: 1
  }
];

const initialTasks: CareTask[] = [
  {
    task_id: 'task-bedtime-prep',
    title: 'Bedtime Prep',
    raw_input: '爸爸今晚八点前把宝宝睡前用品准备好',
    input_type: 'text',
    assignee_member_id: 'member-dad',
    due_at: new Date(new Date().setHours(20, 0, 0, 0)).toISOString(),
    duration_min: 18,
    completion_criteria: '纸尿裤、睡袋、湿巾和夜灯都放到护理台旁边，睡前可以直接开始。',
    assignment_reason: '爸爸晚间可用，并且这项任务不需要连续照护经验。',
    status: 'open',
    safety_notice: null,
    completed_at: null,
    skipped_at: null,
    edited_at: null,
    has_reference_video: true,
    subtasks: [
      makeSubtask('task-bedtime-prep', '检查室温和夜灯', 1, true),
      makeSubtask('task-bedtime-prep', '补齐纸尿裤、湿巾和隔尿垫', 2, false),
      makeSubtask('task-bedtime-prep', '把睡袋和干净衣物放在护理台左侧', 3, false)
    ]
  },
  {
    task_id: 'task-laundry',
    title: '整理洗衣',
    raw_input: '奶奶明天早上帮忙把换洗衣物整理一下',
    input_type: 'voice',
    assignee_member_id: 'member-grandma',
    due_at: new Date(new Date().setHours(10, 30, 0, 0)).toISOString(),
    duration_min: 20,
    completion_criteria: '把 0-3 月衣物按内衣、外穿和包巾分开放好。',
    assignment_reason: '奶奶白天可用，并且熟悉宝宝衣物收纳位置。',
    status: 'open',
    safety_notice: null,
    completed_at: null,
    skipped_at: null,
    edited_at: null,
    has_reference_video: false,
    subtasks: [
      makeSubtask('task-laundry', '挑出今晚可直接使用的两套衣物', 1, false),
      makeSubtask('task-laundry', '把已洗和待洗衣物分开', 2, false)
    ]
  },
  {
    task_id: 'task-inventory',
    title: '记录库存',
    raw_input: '妈妈检查纸尿裤和棉柔巾库存',
    input_type: 'text',
    assignee_member_id: 'member-mom',
    due_at: new Date(new Date().setHours(18, 0, 0, 0)).toISOString(),
    duration_min: 8,
    completion_criteria: '记录剩余数量，低于两天用量时标记需要补货。',
    assignment_reason: '妈妈掌握当前消耗速度，适合做最终检查。',
    status: 'open',
    safety_notice: null,
    completed_at: null,
    skipped_at: null,
    edited_at: null,
    has_reference_video: false,
    subtasks: [makeSubtask('task-inventory', '查看纸尿裤和棉柔巾剩余量', 1, false)]
  }
];

export function App() {
  const [activeTab, setActiveTab] = useState<AppTab>('today');
  const [tasks, setTasks] = useState<CareTask[]>(initialTasks);
  const [currentMemberId, setCurrentMemberId] = useState('member-dad');
  const [feedback, setFeedback] = useState('今天完成 5 / 7，睡前流程已经更顺了。');

  const memberMap = useMemo(() => new Map(members.map((member) => [member.memberId, member])), []);
  const completedTasks = tasks.filter((task) => task.status === 'completed');

  function addPublishedTask(task: PublishedTask) {
    const hydratedTask: CareTask = {
      ...task,
      status: task.status === 'completed' ? 'completed' : 'open',
      completed_at: null,
      skipped_at: null,
      edited_at: null,
      has_reference_video: false
    };
    setTasks((current) => [hydratedTask, ...current]);
    setFeedback('任务已发布到今日 To-do，负责人可以直接执行。');
    setActiveTab('today');
  }

  function completeTask(taskId: string) {
    setTasks((current) =>
      current.map((task) =>
        task.task_id === taskId
          ? {
              ...task,
              status: 'completed',
              completed_at: new Date().toISOString(),
              subtasks: task.subtasks.map((subtask) => ({ ...subtask, completed: true }))
            }
          : task
      )
    );
    const task = tasks.find((item) => item.task_id === taskId);
    const memberName = memberMap.get(task?.assignee_member_id ?? '')?.displayName ?? '家人';
    setFeedback(`${memberName}完成了${task?.title ?? '这项任务'}，让今晚的照护安排更稳。`);
  }

  function toggleSubtask(taskId: string, subtaskId: string) {
    setTasks((current) =>
      current.map((task) =>
        task.task_id === taskId
          ? {
              ...task,
              subtasks: task.subtasks.map((subtask) =>
                subtask.subtask_id === subtaskId ? { ...subtask, completed: !subtask.completed } : subtask
              )
            }
          : task
      )
    );
  }

  function decomposeTask(taskId: string) {
    setTasks((current) =>
      current.map((task) => {
        if (task.task_id !== taskId || task.subtasks.length >= 4) return task;
        const generated = [
          '确认需要完成的区域和物品',
          '先处理宝宝会马上用到的部分',
          '把完成标准拍照或留言给家庭成员',
          '检查是否遗漏安全提醒'
        ].slice(0, Math.max(0, 4 - task.subtasks.length));
        return {
          ...task,
          edited_at: new Date().toISOString(),
          subtasks: [
            ...task.subtasks,
            ...generated.map((title, index) => makeSubtask(task.task_id, title, task.subtasks.length + index + 1, false, 'ai'))
          ]
        };
      })
    );
    setFeedback('AI 已把父任务补成更清楚的执行步骤。');
  }

  function reassignTask(taskId: string, memberId: string) {
    setTasks((current) =>
      current.map((task) =>
        task.task_id === taskId
          ? { ...task, assignee_member_id: memberId, edited_at: new Date().toISOString(), status: 'open' }
          : task
      )
    );
    setFeedback(`任务已改派给${memberMap.get(memberId)?.displayName ?? '家庭成员'}。`);
  }

  function skipTask(taskId: string) {
    setTasks((current) =>
      current.map((task) =>
        task.task_id === taskId ? { ...task, status: 'skipped', skipped_at: new Date().toISOString() } : task
      )
    );
    setFeedback('已记录跳过原因，后续计划会优先调整受影响任务。');
  }

  const page = {
    today: (
      <TodayPage
        feedback={feedback}
        memberMap={memberMap}
        members={members}
        tasks={tasks}
        onComplete={completeTask}
        onDecompose={decomposeTask}
        onReassign={reassignTask}
        onSkip={skipTask}
        onSwitchTab={setActiveTab}
        onToggleSubtask={toggleSubtask}
      />
    ),
    create: <CreatePage latestTask={null} onPublished={addPublishedTask} />,
    contribution: <ContributionPage completedTasks={completedTasks} feedback={feedback} />,
    family: (
      <FamilyPage
        currentMemberId={currentMemberId}
        members={members}
        tasks={tasks}
        onCurrentMemberChange={setCurrentMemberId}
      />
    )
  }[activeTab];

  return (
    <main className="app-shell">
      <section className="phone-shell" aria-label="新生儿家庭协作台">
        <header className="top-bar">
          <button className="brand-block" type="button" aria-label="家庭菜单" onClick={() => setActiveTab('family')}>
            <span className="brand-avatar">
              <img src={avatarUrl} alt="" />
            </span>
            <span>NEWBORN CARE</span>
          </button>
          <button className="top-menu-button" type="button" aria-label="展开家庭菜单" onClick={() => setActiveTab('family')}>
            <img src={chevronUrl} alt="" />
          </button>
        </header>

        <div className="page-transition" key={activeTab}>
          {page}
        </div>

        <nav className="bottom-tabs" aria-label="底部导航">
          {[
            ['today', '今日', navTodayUrl],
            ['create', '创建', navCreateUrl],
            ['contribution', '贡献', navContributionUrl],
            ['family', '家庭', navTodayUrl]
          ].map(([key, label, icon]) => (
            <button
              aria-current={activeTab === key ? 'page' : undefined}
              className={activeTab === key ? 'is-active' : ''}
              key={key}
              type="button"
              onClick={() => setActiveTab(key as AppTab)}
            >
              <span className="nav-icon">
                <img src={icon} alt="" />
              </span>
              {label}
            </button>
          ))}
        </nav>
      </section>
    </main>
  );
}

function makeSubtask(
  taskId: string,
  title: string,
  order: number,
  completed = false,
  source: PublishedSubtask['source'] = 'knowledge'
): PublishedSubtask {
  return {
    subtask_id: `${taskId}-sub-${order}`,
    parent_task_id: taskId,
    title,
    order,
    required: order === 1,
    source,
    completed
  };
}
