export function createLimiter(limit=1,maxQueued=16){
 let active=0;const waiting=[];
 function pump(){while(active<limit&&waiting.length){const job=waiting.shift();active++;Promise.resolve().then(job.run).then(job.resolve,job.reject).finally(()=>{active--;pump();});}}
 return run=>new Promise((resolve,reject)=>{if(waiting.length>=maxQueued){reject(Error('准备队列已满，请稍后再试'));return;}waiting.push({run,resolve,reject});pump();});
}
