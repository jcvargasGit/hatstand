import { useState } from 'react';
import type { Snapshot } from '../../../shared/api';
import { useAction } from '../hooks/useAction';
import { api } from '../lib/api';
import { boardLanes, moveOnBoard, type BoardCard, type LaneId } from '../lib/board';
import { doneWarning } from '../lib/task-journey';
import { TaskBoardCard } from './TaskBoardCard';

type TaskBoardProps = {
  snapshot: Snapshot;
  companyId: string | null;
  onSelectTask: (taskId: string) => void;
  onOpenClosed: (companyId: string) => void;
  onChanged: () => Promise<void>;
};

export function TaskBoard({ snapshot, companyId, onSelectTask, onOpenClosed, onChanged }: TaskBoardProps) {
  const [dragging, setDragging] = useState<BoardCard | null>(null);
  const [dropLane, setDropLane] = useState<LaneId | null>(null);
  const [closing, setClosing] = useState<{ card: BoardCard; warning: string } | null>(null);
  const { error, busy, run } = useAction();

  const move = (card: BoardCard, lane: LaneId) => {
    const warning = lane === 'done' && moveOnBoard(card, lane).kind === 'patch' ? doneWarning(card) : null;
    if (warning) {
      setClosing({ card, warning });
      return;
    }
    void applyMove(card, lane);
  };

  const applyMove = (card: BoardCard, lane: LaneId) =>
    run(async () => {
      const result = moveOnBoard(card, lane);
      if (result.kind === 'none') return;
      if (result.kind === 'refuse') throw new Error(result.reason);
      if (result.kind === 'close') await api.stopSession(result.sessionId);
      await api.updateTask(card.task.id, result.patch);
      if (result.kind === 'start') await api.startSession(card.task.id);
      if (result.kind === 'resume') await api.resumeSession(result.sessionId);
      await onChanged();
    });

  const act = (action: () => Promise<unknown>) =>
    run(async () => {
      await action();
      await onChanged();
    });

  return (
    <>
      {error && <p className="error">{error}</p>}
      {closing && (
        <p className="panel-confirm" role="alert">
          <span>{closing.warning}</span>
          <button
            disabled={busy}
            onClick={() => {
              setClosing(null);
              void applyMove(closing.card, 'done');
            }}
          >
            Mark done anyway
          </button>
          <button className="quiet" onClick={() => setClosing(null)}>
            Cancel
          </button>
        </p>
      )}
      <div className="board" aria-label="Task board">
        {boardLanes(snapshot, companyId).map((lane) => (
          <section
            key={lane.id}
            className={`board-lane lane-${lane.id}${lane.cards.length === 0 ? ' is-empty' : ''}${dropLane === lane.id ? ' is-drop' : ''}`}
            aria-label={lane.title}
            onDragOver={(event) => {
              if (!dragging) return;
              event.preventDefault();
              setDropLane(lane.id);
            }}
            onDragLeave={() => setDropLane((current) => (current === lane.id ? null : current))}
            onDrop={(event) => {
              event.preventDefault();
              setDropLane(null);
              if (dragging) move(dragging, lane.id);
              setDragging(null);
            }}
          >
            <h2>
              {lane.title}
              <span className="board-count">{lane.cards.length}</span>
            </h2>
            <ul>
              {lane.cards.map((card) => (
                <TaskBoardCard
                  key={card.task.id}
                  card={card}
                  showClient={!companyId}
                  accounts={snapshot.accounts.accounts}
                  busy={busy}
                  onSelect={() => onSelectTask(card.task.id)}
                  onMove={(target) => move(card, target)}
                  onStop={() => {
                    if (card.session) void act(() => api.stopSession(card.session?.id ?? ''));
                  }}
                  onOpenInEditor={() => void act(() => api.openTaskInEditor(card.task.id))}
                  onDragStart={() => setDragging(card)}
                  onDragEnd={() => {
                    setDragging(null);
                    setDropLane(null);
                  }}
                />
              ))}
            </ul>
            {lane.id === 'done' && companyId && (
              <button className="quiet board-closed-link" onClick={() => onOpenClosed(companyId)}>
                See all closed
              </button>
            )}
          </section>
        ))}
      </div>
    </>
  );
}
