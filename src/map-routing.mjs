import { buildPlanningVehicles, timeOnServiceDay, vehicleTypeForOrder } from './planning.mjs';

const MAP_POLICY={
  geocodeBatch:12,
  matrixBatch:4,
  geocodeTtlHours:24,
  maxTripsPerVehicle:3,
  turnaroundMinutes:20,
  radiusKm:{motorbike:60,auto:120},
  anglePenaltyKmPerDegree:0.22,
  radialPenalty:0.35
};

export function haversineKm(a,b){
  const R=6371,toRad=x=>x*Math.PI/180;
  const dLat=toRad(b.lat-a.lat),dLng=toRad(b.lng-a.lng);
  const x=Math.sin(dLat/2)**2+Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.min(1,Math.sqrt(x)));
}
export function bearingDeg(a,b){
  const r=Math.PI/180,d=180/Math.PI,p1=a.lat*r,p2=b.lat*r,dl=(b.lng-a.lng)*r;
  return (Math.atan2(Math.sin(dl)*Math.cos(p2),Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dl))*d+360)%360;
}
export function angularDiff(a,b){let d=Math.abs(a-b)%360;return d>180?360-d:d;}
function avgCoord(points){return {lat:points.reduce((s,p)=>s+p.lat,0)/points.length,lng:points.reduce((s,p)=>s+p.lng,0)/points.length};}
function coordOf(order,geocodes){return geocodes.get(Number(order.id))||null;}
function compatible(order,type){return vehicleTypeForOrder(order).includes(type);}
function weightOf(order){const n=Number(order.total_weight_kg);return Number.isFinite(n)?n:0;}

function buildResources(drivers,vehicles,policy){
  const pools={};
  for(const d of drivers){const k=`${d.branch}|${d.group_name}`;(pools[k]??=[]).push(d);}
  Object.values(pools).forEach(a=>a.sort((x,y)=>x.id-y.id));
  const resources=[];
  for(const v of vehicles){
    const group=policy.vehicle_profiles[v.type]?.driver_group,pool=pools[`${v.branch}|${group}`]||[];
    const d=pool.shift();if(d)resources.push({vehicle:v,driver:d});
  }
  return resources;
}
function canAdd(route,order){
  if(!compatible(order,route.vehicle.type)||order.branch!==route.vehicle.branch)return false;
  if(route.orders.length>=Number(route.vehicle.max_route_orders||999))return false;
  const nextW=route.weightKg+weightOf(order);
  if(route.vehicle.payload_limit_kg!=null&&nextW>Number(route.vehicle.payload_limit_kg))return false;
  return true;
}
function candidateCost(route,order,geocodes,depot){
  const c=coordOf(order,geocodes);if(!c)return Infinity;
  const pts=route.orders.map(o=>coordOf(o,geocodes)).filter(Boolean);
  if(!pts.length)return -haversineKm(depot,c);
  const center=avgCoord(pts),base=haversineKm(center,c);
  const seed=coordOf(route.orders[0],geocodes),seedBearing=bearingDeg(depot,seed),candBearing=bearingDeg(depot,c);
  const angle=angularDiff(seedBearing,candBearing);
  const meanRadius=pts.reduce((s,p)=>s+haversineKm(depot,p),0)/pts.length;
  const radial=Math.abs(meanRadius-haversineKm(depot,c));
  return base+angle*MAP_POLICY.anglePenaltyKmPerDegree+radial*MAP_POLICY.radialPenalty;
}
function fillSlots(orders,slots,geocodes,depot){
  const remaining=[...orders],active=[];
  while(remaining.length&&slots.length){
    const slot=slots.shift();
    let seedIndex=-1,seedDistance=-1;
    for(let i=0;i<remaining.length;i++){
      const o=remaining[i],c=coordOf(o,geocodes);if(!c||!canAdd(slot,o))continue;
      const d=haversineKm(depot,c);if(d>seedDistance){seedDistance=d;seedIndex=i;}
    }
    if(seedIndex<0)break;
    const seed=remaining.splice(seedIndex,1)[0];slot.orders.push(seed);slot.weightKg+=weightOf(seed);active.push(slot);
  }
  let progressed=true;
  while(remaining.length&&progressed){
    progressed=false;
    for(const route of active){
      let best=-1,bestCost=Infinity;
      for(let i=0;i<remaining.length;i++){
        const o=remaining[i];if(!canAdd(route,o))continue;
        const cost=candidateCost(route,o,geocodes,depot);if(cost<bestCost){bestCost=cost;best=i;}
      }
      if(best>=0){const o=remaining.splice(best,1)[0];route.orders.push(o);route.weightKg+=weightOf(o);progressed=true;}
      if(!remaining.length)break;
    }
  }
  return {routes:active,remaining};
}

export function buildSpatialRouteJobs({orders,drivers,policy,geocodes,depots}){
  const branches=[...new Set(orders.map(o=>o.branch))],vehicles=buildPlanningVehicles(policy,branches),resources=buildResources(drivers,vehicles,policy);
  const eligible=orders.filter(o=>o.assigned_driver_id==null&&(o.execution_state||'at_depot')==='at_depot'&&o.suggested_vehicle_type!=='Cần rà soát'&&geocodes.has(Number(o.id)));
  const blocked=[];
  const usable=[];
  for(const o of eligible){
    const depot=depots.get(o.branch),c=coordOf(o,geocodes);
    if(!depot){blocked.push({orderId:o.id,reasons:['DEPOT_NOT_CONFIGURED']});continue;}
    const allowed=vehicleTypeForOrder(o),type=allowed[0]||'motorbike',radius=haversineKm(depot,c),limit=MAP_POLICY.radiusKm[type]||120;
    if(radius>limit){blocked.push({orderId:o.id,reasons:[`MAP_OUTLIER_${Math.round(radius)}KM`]});continue;}
    usable.push(o);
  }
  const jobs=[],unassigned=[];
  for(const branch of branches){
    const depot=depots.get(branch);if(!depot)continue;
    const branchResources=resources.filter(r=>r.vehicle.branch===branch);
    const mkSlots=type=>{
      const rs=branchResources.filter(r=>r.vehicle.type===type),slots=[];
      for(let trip=1;trip<=MAP_POLICY.maxTripsPerVehicle;trip++)for(const r of rs)slots.push({routeId:`MAP-${r.vehicle.id}-T${trip}`,tripIndex:trip,vehicle:r.vehicle,driver:r.driver,orders:[],weightKg:0});
      return slots;
    };
    const autoOrders=usable.filter(o=>o.branch===branch&&o.suggested_vehicle_type==='Ô tô');
    const motoOrders=usable.filter(o=>o.branch===branch&&o.suggested_vehicle_type==='Xe máy');
    const auto=fillSlots(autoOrders,mkSlots('auto'),geocodes,depot);auto.routes.forEach(r=>jobs.push(r));
    const moto=fillSlots(motoOrders,mkSlots('motorbike'),geocodes,depot);moto.routes.forEach(r=>jobs.push(r));
    // Overflow motorbike orders may use spare auto trip slots.
    if(moto.remaining.length){
      const used=new Set(jobs.filter(j=>j.vehicle.branch===branch&&j.vehicle.type==='auto').map(j=>j.routeId));
      const spare=mkSlots('auto').filter(s=>!used.has(s.routeId));
      const overflow=fillSlots(moto.remaining,spare,geocodes,depot);overflow.routes.forEach(r=>jobs.push(r));overflow.remaining.forEach(o=>unassigned.push({orderId:o.id,reasons:['NO_SPATIAL_CAPACITY']}));
    }
    auto.remaining.forEach(o=>unassigned.push({orderId:o.id,reasons:['NO_AUTO_SPATIAL_CAPACITY']}));
  }
  return {jobs,blocked,unassigned,inputCount:eligible.length};
}

function sec(v){const n=parseFloat(String(v||'0').replace(/s$/,''));return Number.isFinite(n)?n:Infinity;}
export async function fetchRouteMatrix({apiKey,placeIds,vehicleType,departureTime=null}){
  const points=placeIds.map(placeId=>({waypoint:{placeId}}));
  const body={origins:points,destinations:points,travelMode:vehicleType==='motorbike'?'TWO_WHEELER':'DRIVE',routingPreference:'TRAFFIC_AWARE',languageCode:'vi',regionCode:'vn'};
  if(departureTime&&new Date(departureTime)>new Date())body.departureTime=departureTime;
  let res=await fetch('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix',{method:'POST',headers:{'content-type':'application/json','X-Goog-Api-Key':apiKey,'X-Goog-FieldMask':'originIndex,destinationIndex,status,condition,distanceMeters,duration'},body:JSON.stringify(body)});
  let fallback=false;
  if(!res.ok&&vehicleType==='motorbike'){
    body.travelMode='DRIVE';fallback=true;
    res=await fetch('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix',{method:'POST',headers:{'content-type':'application/json','X-Goog-Api-Key':apiKey,'X-Goog-FieldMask':'originIndex,destinationIndex,status,condition,distanceMeters,duration'},body:JSON.stringify(body)});
  }
  if(!res.ok)throw new Error(`ROUTES_API_${res.status}:${(await res.text()).slice(0,240)}`);
  const rows=await res.json(),n=placeIds.length,dur=Array.from({length:n},()=>Array(n).fill(Infinity)),dist=Array.from({length:n},()=>Array(n).fill(Infinity));
  for(let i=0;i<n;i++){dur[i][i]=0;dist[i][i]=0;}
  for(const x of rows){
    if(x?.condition!=='ROUTE_EXISTS'||x?.status?.code)continue;
    dur[x.originIndex][x.destinationIndex]=sec(x.duration);
    dist[x.originIndex][x.destinationIndex]=Number(x.distanceMeters||0);
  }
  return {dur,dist,fallback,travelMode:body.travelMode};
}
function routeCost(seq,m){let s=0,prev=0;for(const idx of seq){s+=m[prev][idx];prev=idx;}return s+m[prev][0];}
function nearestNeighbor(n,dur){
  const left=new Set(Array.from({length:n-1},(_,i)=>i+1)),seq=[];let cur=0;
  while(left.size){let best=null,cost=Infinity;for(const j of left){if(dur[cur][j]<cost){cost=dur[cur][j];best=j;}}if(best==null)best=[...left][0];seq.push(best);left.delete(best);cur=best;}
  return seq;
}
function twoOpt(seq,dur){
  let best=[...seq],bestCost=routeCost(best,dur),changed=true,loops=0;
  while(changed&&loops++<5){changed=false;for(let i=0;i<best.length-1;i++)for(let k=i+1;k<best.length;k++){const cand=[...best.slice(0,i),...best.slice(i,k+1).reverse(),...best.slice(k+1)],c=routeCost(cand,dur);if(c+1<bestCost){best=cand;bestCost=c;changed=true;}}}
  return best;
}
export function optimizeMatrixSequence(matrix){
  const seq=twoOpt(nearestNeighbor(matrix.dur.length,matrix.dur),matrix.dur);return seq;
}
export function routeMetrics({seq,matrix,startAt,serviceMinutes}){
  let clock=new Date(startAt),prev=0,totalSec=0,totalM=0;const stops=[];
  for(let p=0;p<seq.length;p++){const idx=seq[p],travel=matrix.dur[prev][idx],meters=matrix.dist[prev][idx];if(!Number.isFinite(travel))throw new Error('ROUTE_MATRIX_GAP');clock=new Date(clock.getTime()+travel*1000);const arrival=clock.toISOString();clock=new Date(clock.getTime()+serviceMinutes*60000);stops.push({nodeIndex:idx,sequence:p+1,arrival,departure:clock.toISOString(),legSeconds:travel,legMeters:meters});totalSec+=travel;totalM+=meters;prev=idx;}
  const backSec=matrix.dur[prev][0],backM=matrix.dist[prev][0];if(Number.isFinite(backSec)){totalSec+=backSec;totalM+=backM;clock=new Date(clock.getTime()+backSec*1000);}
  return {stops,distanceKm:Number((totalM/1000).toFixed(2)),travelMinutes:Math.round(totalSec/60),plannedStart:new Date(startAt).toISOString(),plannedEnd:clock.toISOString()};
}
export function defaultRouteStart(serviceDate,policy){return timeOnServiceDay(serviceDate,policy.workday.start).toISOString();}
export function nextTripStart(previousEnd){return new Date(new Date(previousEnd).getTime()+MAP_POLICY.turnaroundMinutes*60000).toISOString();}
export { MAP_POLICY };
