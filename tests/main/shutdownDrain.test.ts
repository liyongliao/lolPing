import { describe, expect, it } from 'vitest';
import { drainShutdown } from '../../src/main/shutdownDrain';
describe('shutdown drain',()=>{
  it('does not wait indefinitely for a lost helper, while still saving settings',async()=>{
    let saved=false;
    const persist=new Promise<void>(resolve=>setTimeout(()=>{saved=true;resolve();},30));
    await drainShutdown(persist,[new Promise(()=>{})],5);
    expect(saved).toBe(true);
  });
  it('finishes promptly when cleanup completed without waiting for the deadline',async()=>{
    const start=Date.now();await drainShutdown(Promise.resolve(),[Promise.reject(new Error('already closed'))],1000);
    expect(Date.now()-start).toBeLessThan(200);
  });
  it('reports a settings write failure',async()=>{
    await expect(drainShutdown(Promise.reject(new Error('disk error')),[],50)).rejects.toThrow('disk error');
  });
});
