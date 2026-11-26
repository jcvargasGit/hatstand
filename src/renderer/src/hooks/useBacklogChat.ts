import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatAnswer, ChatTurn } from '../../../shared/backlog-chat';
import { api, errorMessage } from '../lib/api';

export type ChatExchange = { question: string; answer: ChatAnswer };

type ChatState = {
  exchanges: ChatExchange[];
  /** The question the agent is answering now. */
  pending: string | null;
  /** The question that got no answer, and why. */
  failed: { question: string; error: string } | null;
};

const EMPTY: ChatState = { exchanges: [], pending: null, failed: null };

const asHistory = (exchanges: ChatExchange[]): ChatTurn[] =>
  exchanges.flatMap(({ question, answer }): ChatTurn[] => [
    { role: 'person', text: question },
    { role: 'assistant', text: answer.answer },
  ]);

/** One conversation about the tasks of one client. It starts over when the client changes, and it is not saved. */
export function useBacklogChat(companyId: string) {
  const [state, setState] = useState<ChatState>(EMPTY);
  const key = `backlog-chat:${companyId}`;
  const asking = useRef<object | null>(null);

  const stop = useCallback(() => {
    if (!asking.current) return;
    asking.current = null;
    void api.cancelBacklogChat(key);
    setState((current) => ({ ...current, pending: null }));
  }, [key]);

  const ask = useCallback(
    (question: string, earlier: ChatExchange[]) => {
      const run = {};
      asking.current = run;
      setState({ exchanges: earlier, pending: question, failed: null });
      api.askBacklogChat({ key, companyId, question, history: asHistory(earlier) }).then(
        (answer) => {
          if (asking.current !== run) return;
          asking.current = null;
          setState({ exchanges: [...earlier, { question, answer }], pending: null, failed: null });
        },
        (caught: unknown) => {
          if (asking.current !== run) return;
          asking.current = null;
          setState({ exchanges: earlier, pending: null, failed: { question, error: errorMessage(caught) } });
        },
      );
    },
    [companyId, key],
  );

  const clear = useCallback(() => {
    stop();
    setState(EMPTY);
  }, [stop]);

  useEffect(() => clear, [clear]);

  return { ...state, ask, stop, clear };
}
