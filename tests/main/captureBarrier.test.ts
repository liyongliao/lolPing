import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
vi.mock('../../src/main/paths',()=>({helperExePath:()=>''}));
import { CaptureBarrier } from '../../src/main/captureBarrier';
const fixture=resolve(__dirname,'fixtures/capture-barrier.mjs');
const barriers:CaptureBarrier[]=[];
const create=(mode='ready')=>{const b=new CaptureBarrier(process.execPath,[fixture,mode]);barriers.push(b);return b;};
afterEach(()=>barriers.splice(0).forEach(b=>b.dispose()));
describe('prewarmed capture barrier',()=>{
  it('supports repeated and concurrent requests with matching responses',async()=>{
    const b=create();await b.wait();await Promise.all([b.wait(),b.wait()]);await b.wait();
  });
  it('refuses to capture when native windows are still visible',async()=>{
    await expect(create('busy').wait()).rejects.toThrow('尚未隐藏');
  });
  it('rejects requests when the native service exits',async()=>{
    await expect(create('exit').wait()).rejects.toThrow('已退出');
  });
  it('releases the native service and refuses requests after disposal',async()=>{
    const b=create();await b.wait();b.dispose();await expect(b.wait()).rejects.toThrow('已关闭');
  });
});
