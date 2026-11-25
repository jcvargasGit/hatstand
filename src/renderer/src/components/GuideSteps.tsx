import { ArrowRight, Check, SendHorizontal, UserRound } from 'lucide-react';
import { allStepsDone, autoContinueStep, canLeaveCurrentStep, isGuideStepDone, nextOpenStep, stepsDoneAhead } from '../../../shared/guide-progress';
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

const CONTINUES = 'Hatstand sends each next step by itself. It stops before a step that needs your OK or that you do, and when the agent asks you something.';

/** Why a guide that continues by itself is waiting now, or that it is not. */
function continueNote(guide: TaskGuide): string {
  const next = nextOpenStep(guide);
  const step = next === null ? undefined : guide.steps[next];
  if (step?.approval) return `It continues by itself up to here: step ${(next ?? 0) + 1} needs your OK, so you send it.`;
  if (step?.you) return `It continues by itself up to here: step ${(next ?? 0) + 1} is yours to do.`;
  return CONTINUES;
}

const stepList = (steps: number[]) => (steps.length === 1 ? `step ${steps[0]}` : `steps ${steps.slice(0, -1).join(', ')} and ${steps.at(-1)}`);

function stepNote(guide: TaskGuide, session: Session | undefined, agentBusy: boolean, hasDraft: boolean): string {
  const step = guide.steps[guide.current];
  const next = nextOpenStep(guide);
  const ahead = stepsDoneAhead(guide);
  const alsoDone = ahead.length > 0 ? ` The agent also finished ${stepList(ahead)}.` : '';
  if (agentBusy) return hasDraft ? 'You can send your text when the agent is waiting for you at its prompt.' : 'You can change step when the agent is waiting for you at its prompt.';
  if (hasDraft) return step?.approval ? APPROVAL_NOTE : 'Your text is in the terminal. Send it to the agent, or clear it to change step.';
  if (allStepsDone(guide)) return 'The agent finished every step of the guide.';
  if (guide.autoContinue && !step?.you && session && session.state !== 'stopped' && next !== null) return canLeaveCurrentStep(guide) && autoContinueStep(guide) === null ? continueNote(guide) + alsoDone : CONTINUES + alsoDone;
  if (step?.you) return `Your part: ${step.you}${alsoDone}`;
  if (!session || session.state === 'stopped') return (step?.approval ? APPROVAL_NOTE : 'Starting the session gives the agent the prompt for this step.') + alsoDone;
  if (next === null) return canLeaveCurrentStep(guide) ? 'The agent finished this step. It was the last one left.' : `This is the last step left.${alsoDone}`;
  return canLeaveCurrentStep(guide) ? `The agent finished this step.${alsoDone}` : `Next step turns on when the agent says this step is finished. To move anyway, choose a step above.${alsoDone}`;
}

export function GuideSteps({ task, guide, session, onChanged }: GuideStepsProps) {
  const { error, busy, run } = useAction();
  const agentBusy = session?.state === 'working' || session?.state === 'needs-input';
  const hasDraft = session?.draft === true && session.state !== 'stopped';
  const finished = task.status === 'done' || task.archivedAt !== undefined;
  const blocked = busy || agentBusy || finished || hasDraft;
  const next = nextOpenStep(guide);

  const moveTo = (index: number) =>
    run(async () => {
      await api.moveGuideStep(task.id, index);
      await onChanged();
    });

  const setAutoContinue = (autoContinue: boolean) =>
    run(async () => {
      await api.setGuideAutoContinue(task.id, autoContinue);
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
          {guide.steps.map((step, index) => {
            const done = isGuideStepDone(guide, index);
            return (
              <li key={`${index}-${step.name}`} className={done ? 'is-done' : undefined}>
                <button
                  className="guide-step"
                  aria-current={index === guide.current ? 'step' : undefined}
                  aria-label={`${index + 1} ${step.name}${done ? ', finished' : ''}`}
                  disabled={blocked || index === guide.current}
                  onClick={() => void moveTo(index)}
                >
                  <span className="guide-number">{done ? <Check size={12} /> : index + 1}</span>
                  {step.name}
                  {step.you && <UserRound size={13} aria-label="You do this step" />}
                  {step.approval && <span className="guide-approval">Needs your OK</span>}
                </button>
              </li>
            );
          })}
        </ol>
        {!finished && next !== null && (
          <label className="guide-continue" title={CONTINUES}>
            <input type="checkbox" checked={guide.autoContinue === true} disabled={busy} onChange={(event) => void setAutoContinue(event.target.checked)} />
            Continue by itself
          </label>
        )}
        {hasDraft ? (
          <button className="guide-next" disabled={busy || agentBusy || finished} onClick={() => void sendDraft(session.id)}>
            Send to agent
            <SendHorizontal size={14} />
          </button>
        ) : (
          next !== null && (
            <button className="guide-next" disabled={blocked || !canLeaveCurrentStep(guide)} title={`Step ${next + 1}: ${guide.steps[next]?.name ?? ''}`} onClick={() => void moveTo(next)}>
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
