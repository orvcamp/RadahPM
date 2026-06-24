// src/components/GanttChart.jsx
//
// A lightweight CSS/SVG-free Gantt rendered with absolutely positioned
// divs over a date-scaled track. No charting library dependency —
// keeps the bundle small and avoids version-compatibility issues.

function diffDays(a, b) {
  return Math.round((new Date(b) - new Date(a)) / (1000 * 60 * 60 * 24));
}

export default function GanttChart({ phases, tasks }) {
  const datedTasks = tasks.filter((t) => t.startDate || t.dueDate);

  if (datedTasks.length === 0) {
    return (
      <div className="empty-state">
        <h3>No scheduled tasks yet</h3>
        <p className="text-sm">Add start and due dates to tasks to see them on the timeline.</p>
      </div>
    );
  }

  const allDates = datedTasks.flatMap((t) => [t.startDate, t.dueDate].filter(Boolean));
  const minDate = new Date(Math.min(...allDates.map((d) => new Date(d))));
  const maxDate = new Date(Math.max(...allDates.map((d) => new Date(d))));
  // pad either end by a few days for breathing room
  minDate.setDate(minDate.getDate() - 2);
  maxDate.setDate(maxDate.getDate() + 2);

  const totalDays = Math.max(diffDays(minDate, maxDate), 1);

  function leftPct(date) {
    return (diffDays(minDate, date) / totalDays) * 100;
  }
  function widthPct(start, end) {
    const days = Math.max(diffDays(start, end), 0.5);
    return (days / totalDays) * 100;
  }

  // Group tasks by phase; tasks with no phase go under "Unphased"
  const phaseMap = new Map();
  phases.forEach((p) => phaseMap.set(p.id, { ...p, tasks: [] }));
  const unphased = { id: "unphased", name: "Unphased Tasks", tasks: [] };

  datedTasks.forEach((t) => {
    if (t.phaseId && phaseMap.has(t.phaseId)) {
      phaseMap.get(t.phaseId).tasks.push(t);
    } else {
      unphased.tasks.push(t);
    }
  });

  const groups = [...phaseMap.values(), unphased].filter((g) => g.tasks.length > 0);

  return (
    <div className="gantt-wrap">
      {groups.map((group) => (
        <div key={group.id}>
          <div className="gantt-phase-header">{group.name}</div>
          {group.tasks.map((task) => {
            const start = task.startDate ? new Date(task.startDate) : new Date(task.dueDate);
            const end = task.dueDate ? new Date(task.dueDate) : new Date(task.startDate);

            return (
              <div className="gantt-row" key={task.id}>
                <div className="gantt-label" title={task.title}>
                  {task.title.length > 28 ? task.title.slice(0, 26) + "…" : task.title}
                  {task.assignedToName && (
                    <span className="text-steel" style={{ marginLeft: "0.4rem", fontSize: "0.72rem" }}>
                      ({task.assignedToName.split(" ")[0]})
                    </span>
                  )}
                </div>
                <div className="gantt-track">
                  {task.isMilestone ? (
                    <div
                      className="gantt-milestone"
                      style={{ left: `${leftPct(start)}%` }}
                      title={`${task.title} — ${start.toLocaleDateString()}`}
                    />
                  ) : (
                    <div
                      className={`gantt-bar ${task.status}`}
                      style={{
                        left: `${leftPct(start)}%`,
                        width: `${Math.max(widthPct(start, end), 2)}%`,
                      }}
                      title={`${task.title}: ${start.toLocaleDateString()} – ${end.toLocaleDateString()}`}
                    >
                      {task.status === "completed" ? "✓" : ""}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
