export function createInitializationCache(load,{clock=Date.now,retryDelayMs=60_000}={}) {
 let pending,value,lastError,retryAt=0;
 return function initialize(){
  if(value!==undefined)return Promise.resolve(value);
  if(pending)return pending;
  if(lastError&&clock()<retryAt)return Promise.reject(lastError);
  pending=Promise.resolve().then(load).then(result=>{
   value=result;lastError=undefined;retryAt=0;return result;
  },error=>{
   lastError=error;retryAt=clock()+retryDelayMs;throw error;
  }).finally(()=>{pending=undefined;});
  return pending;
 };
}
