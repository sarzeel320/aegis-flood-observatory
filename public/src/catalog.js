// Shared client for the versioned backend. Fetches are cached per page load; failures resolve to explicit
// unavailable states so the UI can show them rather than substituting values.
const cache=new Map();
async function getJSON(path,timeout=20000){const response=await fetch(path,{signal:AbortSignal.timeout(timeout)});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||`HTTP ${response.status}`);return data;}
export function cached(path,timeout){if(!cache.has(path))cache.set(path,getJSON(path,timeout).catch(error=>{cache.delete(path);throw error;}));return cache.get(path);}
export const loadCatchments=()=>cached('/api/v1/catchments');
export const loadModelStatus=()=>cached('/api/v1/model-status',30000);
export const loadSources=()=>cached('/api/v1/sources',30000);
export const loadExposure=id=>cached(`/api/v1/catchments/${encodeURIComponent(id)}/exposure`,90000);
export const loadForecast=id=>getJSON(`/api/v1/catchments/${encodeURIComponent(id)}/forecast`,60000);
export const loadRivers=id=>cached(`/api/v1/catchments/${encodeURIComponent(id)}/rivers`);
export const loadShelters=id=>getJSON(`/api/v1/catchments/${encodeURIComponent(id)}/shelters`);
export const loadNotificationStatus=()=>cached('/api/v1/notifications/status');
export async function saveScenario(body){const response=await fetch('/api/v1/scenarios',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':`ui-${crypto.randomUUID()}`},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||`HTTP ${response.status}`);return data;}
export const formatTime=iso=>iso?new Date(iso).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Kolkata'})+' IST':'unknown';
export const formatNumber=n=>Number.isFinite(n)?n.toLocaleString('en-IN'):'—';
