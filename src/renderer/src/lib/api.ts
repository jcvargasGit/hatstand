import type { Bridge, HatstandApi } from '../../../shared/api';

declare global {
  interface Window {
    hatstand: Bridge;
  }
}

export const api = new Proxy({} as HatstandApi, {
  get(_target, method) {
    return (...args: never[]) => window.hatstand.invoke(method as keyof HatstandApi, ...(args as [never]));
  },
});

export function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/^Error invoking remote method 'hatstand': (Error: )?/, '');
}
