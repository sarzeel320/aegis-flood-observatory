const finite = n => typeof n === 'number' && Number.isFinite(n);
const mean = values => values.reduce((sum,n)=>sum+n,0)/values.length;
function quantile(values,p) {
  const sorted=[...values].sort((a,b)=>a-b),at=(sorted.length-1)*p;
  return sorted[Math.floor(at)]+(sorted[Math.ceil(at)]-sorted[Math.floor(at)])*(at%1);
}
// Open-Meteo timestamps are requested in Asia/Kolkata, with hour-ending rain sums.
export function summarizeForecast(payload,keys,now=Date.now()) {
  const hourly=payload?.hourly;
  if(!Array.isArray(hourly?.time)||keys.length===0)throw new Error('Forecast series missing');
  const indices=hourly.time.map((time,index)=>({time,index})).filter(({time})=>Date.parse(time+'+05:30')>now).slice(0,24);
  const members=keys.map(key=>indices.map(({index})=>hourly[key]?.[index]));
  const complete=members.filter(values=>values.length===24&&values.every(finite));
  const totals=complete.map(values=>values.reduce((sum,n)=>sum+n,0));
  const series=indices.map(({time},i)=>{
    const values=members.map(member=>member[i]);
    return {time:time+'+05:30',precipitationMm:values.every(finite)?mean(values):null};
  });
  return {series,expectedHours:24,availableHours:series.filter(v=>finite(v.precipitationMm)).length,
    totalMm:totals.length===keys.length?mean(totals):null,
    memberCount:keys.length,completeMembers:complete.length,
    interval:totals.length===keys.length&&totals.length>1?{p10:quantile(totals,.1),p90:quantile(totals,.9)}:null,
    latitude:payload.latitude,longitude:payload.longitude};
}
async function defaultFetchJSON(url){
  const response=await fetch(url,{signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw new Error('Forecast provider unavailable');
  return response.json();
}
export async function compareForecasts(lat,lon,{fetchJSON=defaultFetchJSON}={}){
  const params=new URLSearchParams({latitude:String(lat),longitude:String(lon),hourly:'precipitation',forecast_days:'2',timezone:'Asia/Kolkata'});
  const [ecmwf,google]=await Promise.allSettled([
    fetchJSON(`https://api.open-meteo.com/v1/forecast?${params}&models=ecmwf_aifs025_single,ecmwf_ifs`),
    fetchJSON(`https://ensemble-api.open-meteo.com/v1/ensemble?${params}&models=google_weathernext2_ensemble`)
  ]);
  const definitions=[
    {id:'aifs',name:'ECMWF AIFS Single',resolution:'0.25° · native 6-hour steps',result:ecmwf,keys:['precipitation_ecmwf_aifs025_single']},
    {id:'ifs',name:'ECMWF IFS',resolution:'Provider IFS grid · verify returned coordinates',result:ecmwf,keys:['precipitation_ecmwf_ifs']},
    {id:'weathernext2',name:'Google WeatherNext 2',resolution:'0.25° · native 6-hour steps',result:google,keys:google.status==='fulfilled'?Object.keys(google.value.hourly||{}).filter(k=>/^precipitation(?:_member\d+)?$/.test(k)):[]}
  ];
  const now=Date.now();
  const models=definitions.map(({result,keys,...definition})=>{
    try{if(result.status!=='fulfilled')throw new Error();return {...definition,status:'available',...summarizeForecast(result.value,keys,now)};}
    catch{return {...definition,status:'unavailable',error:'No valid forecast returned. Retry later.'};}
  });
  return {source:'Open-Meteo distribution of ECMWF and Google forecasts',fetchedAt:new Date(now).toISOString(),kind:'weather-model-comparison',models,
    limitation:'Hourly output is provider-interpolated where native steps are coarser. Inter-model agreement is not flood probability or confidence. WeatherNext 3 is not part of this comparison.'};
}
