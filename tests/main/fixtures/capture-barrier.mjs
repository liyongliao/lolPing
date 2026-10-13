import { createInterface } from 'node:readline';
const mode=process.argv[2];
console.log('ready');
createInterface({input:process.stdin}).on('line',line=>{
  if(mode==='exit')process.exit(1);
  console.log('999999 ready'); // unrelated responses must not satisfy a request
  console.log(`${line} ${mode==='busy'?'busy':'ready'}`);
}).on('close',()=>process.exit(0));
