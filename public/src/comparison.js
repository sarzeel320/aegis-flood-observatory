let generation=0;
export function resetComparison(){
  generation++;
  document.getElementById('comparison-results').replaceChildren();
  document.getElementById('comparison-chart').replaceChildren();
  document.getElementById('comparison-note').textContent='Compare forecast rainfall for the same next 24 hourly intervals. No flood probability is inferred.';
  const button=document.getElementById('load-comparison');button.disabled=false;button.textContent='Compare live forecasts ↗';
}
export function initComparison(getRegion){
  const results=document.getElementById('comparison-results'),note=document.getElementById('comparison-note');
  const button=document.getElementById('load-comparison');
  button.addEventListener('click',async()=>{
    const request=++generation,region=getRegion();button.disabled=true;button.textContent='Loading comparison…';results.replaceChildren();document.getElementById('comparison-chart').replaceChildren();
    note.textContent=`Requesting model forecasts for ${region.name}…`;
    try{
      const response=await fetch(`/api/compare?lat=${region.lat}&lon=${region.lon}`,{signal:AbortSignal.timeout(16000)});
      const data=await response.json();if(!response.ok)throw new Error();if(request!==generation)return;
      const colors=['#d0dfb6','#82b8cc','#efc36e'];
      for(const [index,model] of data.models.entries()){
        const card=document.createElement('article');card.className='comparison-model';
        const title=document.createElement('h4');title.textContent=model.name;title.style.color=colors[index];
        const total=document.createElement('strong');total.textContent=model.totalMm==null?'—':model.totalMm.toFixed(1)+' mm';
        const detail=document.createElement('p');
        detail.textContent=model.status==='unavailable'?'Temporarily unavailable':model.totalMm==null?`Incomplete coverage: ${model.availableHours}/24 hours, ${model.completeMembers}/${model.memberCount} complete members.`:model.interval?`Ensemble P10–P90: ${model.interval.p10.toFixed(1)}–${model.interval.p90.toFixed(1)} mm · ${model.memberCount} members`:'24-hour accumulation · deterministic forecast';
        const resolution=document.createElement('p');resolution.className='fine';resolution.textContent=model.resolution;
        card.append(title,total,detail,resolution);results.append(card);
      }
      drawChart(data.models,colors);
      note.textContent=`${region.name} · retrieved ${new Date(data.fetchedAt).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})}. ${data.limitation}`;
    }catch{if(request!==generation)return;note.textContent='Forecast comparison is unavailable. Retry when the connection returns. No model values have been substituted.';}
    finally{if(request===generation){button.disabled=false;button.textContent='Refresh comparison ↻';}}
  });
}
function drawChart(models,colors){
  const svg=document.getElementById('comparison-chart'),ns='http://www.w3.org/2000/svg';
  const add=(tag,attributes,text)=>{const element=document.createElementNS(ns,tag);Object.entries(attributes).forEach(([key,value])=>element.setAttribute(key,value));if(text)element.textContent=text;svg.append(element);return element;};
  const valid=models.flatMap(m=>m.series||[]).map(p=>p.precipitationMm).filter(Number.isFinite);
  if(!valid.length)return;const max=Math.max(1,...valid);
  for(let i=0;i<=3;i++){const y=20+i*50;add('line',{x1:42,x2:860,y1:y,y2:y,stroke:'#ffffff15'});add('text',{x:0,y:y+4,fill:'#a0aba3','font-size':12},(max*(1-i/3)).toFixed(1));}
  models.forEach((model,index)=>{
    let drawing=false,path='';(model.series||[]).forEach((point,i)=>{if(!Number.isFinite(point.precipitationMm)){drawing=false;return;}path+=`${drawing?'L':'M'}${42+i/23*818},${170-point.precipitationMm/max*150} `;drawing=true;});
    add('path',{d:path,fill:'none',stroke:colors[index],'stroke-width':2.5});
  });
  add('text',{x:42,y:198,fill:'#a0aba3','font-size':12},'Next hour');add('text',{x:785,y:198,fill:'#a0aba3','font-size':12},'+24 hours');
}
