/** Persist settings, but don't let a disconnected native hook or transport hold up app exit. */
export async function drainShutdown(persist: Promise<unknown>, cleanup: readonly Promise<unknown>[], timeoutMs = 2000): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.all([
      persist,
      Promise.race([Promise.allSettled(cleanup), new Promise<void>(resolve => { timer = setTimeout(resolve, timeoutMs); })]),
    ]);
  } finally { clearTimeout(timer); }
}
