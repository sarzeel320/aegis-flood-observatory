let requestId=0;
export async function lookupPlace(query){
  const request=++requestId,dialog=document.getElementById('place-dialog'),results=document.getElementById('place-results'),status=document.getElementById('place-status');
  results.replaceChildren();document.getElementById('place-weather').replaceChildren();status.textContent=`Searching India for “${query}”…`;dialog.showModal();
  try{
    const response=await fetch(`/api/places?q=${encodeURIComponent(query)}`,{signal:AbortSignal.timeout(12000)});const data=await response.json();if(!response.ok)throw new Error();if(request!==requestId)return;
    status.textContent=data.results.length?'Select a matching place. Flood predictions are not available outside the demonstration catchments.':'No matching place found. Try a nearby town or a longer name.';
    for(const place of data.results){const button=document.createElement('button');button.className='button outline full';button.textContent=`${place.name}, ${place.state} ↗`;button.addEventListener('click',()=>loadPlaceWeather(place,request));results.append(button);}
  }catch{if(request===requestId)status.textContent='Place lookup is unavailable. Check the connection and try again.';}
}
async function loadPlaceWeather(place,parentRequest){
  const request=++requestId,target=document.getElementById('place-weather');target.replaceChildren();
  const title=document.createElement('h3');title.textContent=`${place.name}, ${place.state}`;
  const coordinates=document.createElement('p');coordinates.className='fine';coordinates.textContent=`${place.latitude.toFixed(4)}° N, ${place.longitude.toFixed(4)}° E · GeoNames via Open-Meteo`;
  const result=document.createElement('p');result.setAttribute('role','status');result.textContent='Loading current weather model data…';
  const risk=document.createElement('p');risk.className='fine';risk.textContent='Flood risk: unknown. Absence of a forecast is not an indication of safety.';
  target.append(title,coordinates,result,risk);
  try{
    const response=await fetch(`/api/weather?lat=${place.latitude}&lon=${place.longitude}`,{signal:AbortSignal.timeout(16000)});const data=await response.json();if(!response.ok)throw new Error();if(request!==requestId)return;
    result.textContent=`${data.current?.temperature_2m??'—'} °C · ${data.current?.precipitation??'—'} mm current precipitation. Retrieved ${new Date(data.fetchedAt).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})}.`;
  }catch{if(request===requestId)result.textContent='Weather currently unavailable. No readings have been substituted.';}
}
