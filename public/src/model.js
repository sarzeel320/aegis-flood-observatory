// Demonstration scenario inputs for the ten study catchments. Catchment GEOMETRY is no longer defined here:
// it comes from /api/v1/catchments (HydroBASINS v1.c level 8). The values below (rain, soil, slope, built, trees)
// remain explicitly assumed classroom inputs for the sensitivity index; `pop` is retained only as a fallback label
// until the WorldPop exposure figure loads from /api/v1/catchments/:id/exposure.
export const regions = [
 {id:'kedarnath',name:'Kedarnath',state:'Uttarakhand',group:'Himalayas',lat:30.7352,lon:79.0669,rain:38,soil:82,slope:36,built:18,trees:32,pop:null,river:'Mandakini catchment'},
 {id:'manali',name:'Manali',state:'Himachal Pradesh',group:'Himalayas',lat:32.2432,lon:77.1892,rain:29,soil:76,slope:29,built:35,trees:46,pop:null,river:'Upper Beas catchment'},
 {id:'gangtok',name:'Gangtok',state:'Sikkim',group:'Northeast',lat:27.3389,lon:88.6065,rain:31,soil:79,slope:32,built:48,trees:40,pop:null,river:'Teesta catchment'},
 {id:'wayanad',name:'Wayanad',state:'Kerala',group:'Western Ghats',lat:11.6854,lon:76.1320,rain:26,soil:84,slope:24,built:23,trees:61,pop:null,river:'Kabini headwaters'},
 {id:'srinagar',name:'Srinagar',state:'Jammu & Kashmir',group:'Himalayas',lat:34.0837,lon:74.7973,rain:16,soil:63,slope:14,built:64,trees:22,pop:null,river:'Jhelum catchment'},
 {id:'shillong',name:'Shillong',state:'Meghalaya',group:'Northeast',lat:25.5788,lon:91.8933,rain:21,soil:71,slope:22,built:42,trees:48,pop:null,river:'Umkhrah catchment'},
 {id:'tawang',name:'Tawang',state:'Arunachal Pradesh',group:'Northeast',lat:27.5861,lon:91.8594,rain:18,soil:68,slope:38,built:12,trees:55,pop:null,river:'Tawang Chu catchment'},
 {id:'darjeeling',name:'Darjeeling',state:'West Bengal',group:'Eastern hills',lat:27.0410,lon:88.2663,rain:24,soil:74,slope:33,built:39,trees:42,pop:null,river:'Rangeet catchment'},
 {id:'ooty',name:'Ooty',state:'Tamil Nadu',group:'Western Ghats',lat:11.4102,lon:76.6950,rain:18,soil:65,slope:26,built:28,trees:56,pop:null,river:'Nilgiri headwaters'},
 {id:'mahabaleshwar',name:'Mahabaleshwar',state:'Maharashtra',group:'Western Ghats',lat:17.9307,lon:73.6477,rain:22,soil:72,slope:25,built:24,trees:52,pop:null,river:'Krishna headwaters'}
];
export const clamp = (n,min,max) => Math.min(max,Math.max(min,n));
// Transparent classroom sensitivity index. NOT a probability or trained flood model.
export function riskIndex({rain,soil,slope,built,trees},hour=0) {
  const rainFactor = clamp(rain/60,0,1)*42;
  const soilFactor = clamp(soil/100,0,1)*30;
  const slopeFactor = clamp(slope/45,0,1)*12;
  const surfaceFactor = clamp(built/100,0,1)*10 + (1-clamp(trees/100,0,1))*6;
  const timelineFactor = hour === 0 ? 0 : Math.sin(hour/24*Math.PI)*9;
  return Math.round(clamp(rainFactor+soilFactor+slopeFactor+surfaceFactor+timelineFactor,0,100));
}
export const category = score => score>=65 ? 'High' : score>=40 ? 'Watch' : 'Below watch';
// Map styling only. Colour is derived from the demonstration index and never feeds any computation.
export const riskColor = score => {
  const t=clamp((score-40)/45,0,1);
  const from=[239,195,110],to=[204,64,47];
  return '#'+from.map((v,i)=>Math.round(v+(to[i]-v)*t).toString(16).padStart(2,'0')).join('');
};
