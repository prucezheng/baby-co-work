import type { CareTask, MemberView } from '../app/App';

interface FamilyPageProps {
  currentMemberId: string;
  members: MemberView[];
  tasks: CareTask[];
  onCurrentMemberChange(memberId: string): void;
}

export function FamilyPage({ currentMemberId, members, tasks, onCurrentMemberChange }: FamilyPageProps) {
  const openTasks = tasks.filter((task) => task.status !== 'completed');
  const currentMember = members.find((member) => member.memberId === currentMemberId) ?? members[0];

  return (
    <section className="family-page surface-page">
      <section className="family-identity">
        <span>当前身份</span>
        <h1>{currentMember.displayName}</h1>
        <p>{currentMember.role} · {currentMember.availability}</p>
      </section>

      <section className="pin-panel">
        <div>
          <h2>4 位 PIN</h2>
          <p>演示态已记住身份，正式接口由后端校验 PIN 和会话。</p>
        </div>
        <div className="pin-dots" aria-label="PIN 已设置">
          <span />
          <span />
          <span />
          <span />
        </div>
      </section>

      <section className="member-roster">
        <div className="section-row">
          <h2>家庭成员</h2>
          <span>{members.length} 人</span>
        </div>
        {members.map((member) => {
          const assignedCount = openTasks.filter((task) => task.assignee_member_id === member.memberId).length;
          return (
            <button
              className={member.memberId === currentMemberId ? 'member-card is-current' : 'member-card'}
              key={member.memberId}
              type="button"
              onClick={() => onCurrentMemberChange(member.memberId)}
            >
              <span>{member.displayName.slice(0, 1)}</span>
              <strong>{member.displayName}</strong>
              <small>{member.focus}</small>
              <em>{assignedCount} 个待执行</em>
            </button>
          );
        })}
      </section>

      <section className="assignment-rules">
        <h2>自动分配依据</h2>
        <div className="rule-list">
          <p>晚间任务优先给当前可用成员，避免让妈妈继续承担提醒。</p>
          <p>白天整理类任务优先给熟悉物品位置的成员。</p>
          <p>找不到合适成员时，任务会发布为待认领，不阻断主流程。</p>
        </div>
      </section>
    </section>
  );
}
