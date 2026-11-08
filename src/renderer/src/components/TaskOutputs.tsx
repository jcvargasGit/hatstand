import { useEditorName } from '../hooks/useEditorName';
import { useTaskOutputs } from '../hooks/useTaskOutputs';
import { TaskOutputRow } from './TaskOutputRow';

export function TaskOutputs({ taskId }: { taskId: string }) {
  const outputs = useTaskOutputs(taskId);
  const editorName = useEditorName();
  if (outputs.length === 0) return null;
  return (
    <section className="overview-card overview-wide" aria-label="Agent output">
      <h3>Agent output</h3>
      <ul className="task-outputs">
        {outputs.map((output) => (
          <TaskOutputRow key={output.name} taskId={taskId} output={output} editorName={editorName} />
        ))}
      </ul>
    </section>
  );
}
