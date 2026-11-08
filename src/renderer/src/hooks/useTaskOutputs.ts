import { useEffect, useState } from 'react';
import type { TaskOutput } from '../../../shared/api';
import { api } from '../lib/api';

const REFRESH_MS = 3000;

export function useTaskOutputs(taskId: string): TaskOutput[] {
  const [outputs, setOutputs] = useState<TaskOutput[]>([]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const saved = await api.listTaskOutputs(taskId);
      if (active) setOutputs(saved);
    };
    setOutputs([]);
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [taskId]);

  return outputs;
}
