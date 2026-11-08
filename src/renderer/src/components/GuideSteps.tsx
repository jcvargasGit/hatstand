import { ArrowRight, Check, SendHorizontal, UserRound } from 'lucide-react';
import type { Session, Task, TaskGuide } from '../../../shared/schemas';
import { useAction } from '../hooks/useAction';
import { api } from '../lib/api';

type GuideStepsProps = {
  task: Task;
  guide: TaskGuide;
  session: Session | undefined;
  onChanged: () => Promise<void>;
};

const APPROVAL_NOTE = 'This step acts outside your computer. Read the prompt and the draft before you send it.';

function isStepFinished(guide: TaskGuide, session: Session | undefined): boolean {
  const step = guide.steps[guide.current];
  const waitsForAgent = Boolean(step?.prompt) && !step?.you;
  return !waitsForAgent || session?.stepDone === guide.current + 1;
}

function stepNote(guide: TaskGuide, session: Session | undefined, agentBusy: boolean, hasDraft: boolean): string {
  const step = guide.steps[guide.current];
  const isLast = guide.current >= guide.steps.length - 1;
  if (agentBusy) return hasDraft ? 'You can send your text when the agent is waiting for you at its prompt.' : 'You can change step when the agent is waiting for you at its prompt.';
  if (hasDraft) return step?.approval ? APPROVAL_NOTE : 'Your text is in the terminal. Send it to the agent, or clear it to change step.';
  if (step?.you) return `Your part: ${step.you}`;
  if (!session || session.state === 'stopped') return step?.approval ? APPROVAL_NOTE : 'Starting the session writes the prompt for this step.';
  if (isLast) return 'This is the last step of the guide.';
  return isStepFinished(guide, session) ? 'The agent finished this step.' : 'Next step turns on when the agent says this step is finished. To move anyway, choose a step above.';
}

export function GuideSteps({ task, guide, session, onChanged }: GuideStepsProps) {
  const { error, busy, run } = useAction();
  const agentBusy = session?.state === 'working' || session?.state === 'needs-input';
  const hasDraft = session?.draft === true && session.state !== 'stopped';
  const finished = task.status === 'done' || task.archivedAt !== undefined;
  const blocked = busy || agentBusy || finished || hasDraft;
  const isLast = guide.current >= guide.steps.length - 1;

  const moveTo = (index: number) =>
    run(async () => {
      await api.moveGuideStep(task.id, index);
      await onChanged();
    });

  const sendDraft = (sessionId: string) =>
    run(async () => {
      await api.sendDraft(sessionId);
      await onChanged();
    });

  return (
    <section className="guide" aria-label="Guide">
      <div className="guide-bar">
        <strong className="guide-name">{guide.name}</strong>
        <ol className="guide-steps">
          {guide.steps.map((step, index) => (
            <li key={`${index}-${step.name}`}>
              <button
                className="guide-step"
                aria-current={index === guide.current ? 'step' : undefined}
                disabled={blocked || index === guide.current}
                onClick={() => void moveTo(index)}
              >
                <span className="guide-number">{index < guide.current ? <Check size={12} /> : index + 1}</span>
                {step.name}
                {step.you && <UserRound size={13} aria-label="You do this step" />}
                {step.approval && <span className="guide-approval">Needs your OK</span>}
              </button>
            </li>
          ))}
        </ol>
        {hasDraft ? (
          <button className="guide-next" disabled={busy || agentBusy || finished} onClick={() => void sendDraft(session.id)}>
            Send to agent
            <SendHorizontal size={14} />
          </button>
        ) : (
          !isLast && (
            <button className="guide-next" disabled={blocked || !isStepFinished(guide, session)} onClick={() => void moveTo(guide.current + 1)}>
              Next step
              <ArrowRight size={14} />
            </button>
          )
        )}
      </div>
      {!finished && <p className="guide-note">{stepNote(guide, session, agentBusy, hasDraft)}</p>}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
