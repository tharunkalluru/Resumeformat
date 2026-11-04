import { useCallback, useEffect, useRef, useState } from 'react';
import { aiErrorMessage, aiStatusMessage, canSendAiRequest, createAiClient } from '../tailoring/ai';

export interface AiReadiness {
  state: 'unchecked' | 'checking' | 'ready' | 'blocked' | 'unavailable';
  message: string;
}

/** Local configuration lookup only. Never verifies the account or sends content. */
export function useAiReadiness(active: boolean) {
  const [service, setService] = useState<AiReadiness>({ state: 'unchecked', message: 'Checking whether AI tailoring is available.' });
  const pending = useRef<AbortController | null>(null);
  const check = useCallback(async () => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setService({ state: 'checking', message: 'Checking AI availability…' });
    try {
      const status = await createAiClient().status(controller.signal);
      if (pending.current !== controller || controller.signal.aborted) return;
      setService({ state: canSendAiRequest(status) ? 'ready' : 'blocked', message: aiStatusMessage(status) });
    } catch (error) {
      if (pending.current === controller && !controller.signal.aborted) setService({ state: 'unavailable', message: aiErrorMessage(error) });
    } finally { if (pending.current === controller) pending.current = null; }
  }, []);
  useEffect(() => {
    if (active) void check();
    return () => { pending.current?.abort(); pending.current = null; };
  }, [active, check]);
  return { service, check };
}
