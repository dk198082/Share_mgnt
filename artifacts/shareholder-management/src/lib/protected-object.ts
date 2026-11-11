import { useEffect, useState } from 'react';
import { fileUrl } from '@/lib/format';


type State = { url: string | null; loading: boolean; error: string | null };

/** Fetches a private storage object with the pilot session cookie as a revocable blob URL. */
export function useProtectedObject(objectPath: string | null | undefined, nonce = 0) {
  const [state, setState] = useState<State>({ url: null, loading: !!objectPath, error: null });

  useEffect(() => {
    if (!objectPath) { setState({ url: null, loading: false, error: null }); return; }
    let cancelled = false;
    let created: string | null = null;
    const ctrl = new AbortController();
    setState({ url: null, loading: true, error: null });
    (async () => {
      try {
        const res = await fetch(fileUrl(objectPath), {
          credentials: 'include',
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(res.status === 403 || res.status === 401 ? 'Not permitted to view this image.' : `Image could not be loaded (${res.status}).`);
        const blob = await res.blob();
        if (cancelled) return;
        created = URL.createObjectURL(blob);
        setState({ url: created, loading: false, error: null });
      } catch (e) {
        if (cancelled) return;
        setState({ url: null, loading: false, error: e instanceof Error ? e.message : 'Image could not be loaded.' });
      }
    })();
    return () => { cancelled = true; ctrl.abort(); if (created) URL.revokeObjectURL(created); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objectPath, nonce]);

  return state;
}
