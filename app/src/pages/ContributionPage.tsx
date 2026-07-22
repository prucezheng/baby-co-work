import type { CareTask } from '../app/App';

interface ContributionPageProps {
  completedTasks: CareTask[];
  feedback: string;
}

const heatLevels = [3, 2, 0, 1, 3, 0, 2, 1, 3, 0, 2, 3, 0, 1, 3, 2, 0, 3, 1, 3, 0, 2, 3, 0, 3, 3, 2, 3];

export function ContributionPage({ completedTasks, feedback }: ContributionPageProps) {
  const contributionCount = completedTasks.length + 5;
  const weeklyGoal = Math.min(100, Math.round((contributionCount / 12) * 100));
  const filledWidth = `${Math.max(42, weeklyGoal)}%`;

  return (
    <section className="contribution-page surface-page">
      <article className="impact-card contribution-impact">
        <span className="impact-icon">●</span>
        <div>
          <small>今日成就反馈</small>
          <p>{feedback}</p>
        </div>
      </article>

      <section className="contribution-section">
        <h2>个人贡献 (过去7天)</h2>
        <div className="heatmap-frame" aria-label="过去七天贡献热力图">
          <div className="heatmap-grid">
            {heatLevels.map((level, index) => (
              <button
                aria-label={`贡献格 ${index + 1}，强度 ${level}`}
                className={`heat-cell level-${level}`}
                key={`${level}-${index}`}
                type="button"
              />
            ))}
          </div>
          <div className="heatmap-legend">
            <span>Mon</span>
            <span>Less</span>
            <i />
            <i className="level-1" />
            <i className="level-2" />
            <span>More</span>
            <span>Sun</span>
          </div>
        </div>
      </section>

      <section className="family-effort">
        <div>
          <span>FAMILY EFFORT</span>
          <strong>每周目标 {weeklyGoal}%</strong>
        </div>
        <div className="effort-track">
          <span style={{ width: filledWidth }} />
        </div>
        <p>Keep going, we are almost at the collective resting point.</p>
      </section>

      <section className="achievement-section">
        <h2>荣誉成就</h2>
        <div className="achievement-grid">
          <article>
            <span>↕</span>
            <strong>首次接力</strong>
            <small>无缝交接</small>
          </article>
          <article>
            <span className="filled">HI</span>
            <strong>稳定协作者</strong>
            <small>连续14天</small>
          </article>
        </div>
      </section>
    </section>
  );
}
