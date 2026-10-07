import { nodeKey, travelEstimate, timeOnServiceDay, vehicleTypeForOrder } from './planning.mjs';

function minutesBetween(a,b){return Math.round((b-a)/60000);}
function addMinutes(d,m){return new Date(d.getTime()+m*60000);}
function uniq(a){return [...new Set(a)];}
function matrixKey(branch,type,from,to){return `${branch}|${type}|${from}|${to}`;}
function travelFor({matrix,policy,branch,type,from,to}){
  const x=matrix?.get?.(matrixKey(branch,type,from,to));
  if(x)return {minutes:Number(x.minutes??x.travel_minutes),km:Number(x.km??x.distance_km),source:x.source||'database',verified:x.verified===true||x.verification_status==='verified',matrixVersion:x.matrixVersion||x.matrix_version||policy.matrix_version};
  return travelEstimate(policy,branch,type,from,to);
}
function windowFor(order,policy){
  if(order.planning_sla?.window_end)return {start:order.planning_sla.window_start?new Date(order.planning_sla.window_start):null,end:new Date(order.planning_sla.window_end),verified:order.planning_sla.verification_status==='verified',source:order.planning_sla.source||'database'};
  const day=order.service_date||new Date().toISOString().slice(0,10);return {start:timeOnServiceDay(day,policy.workday.start),end:timeOnServiceDay(day,policy.workday.end),verified:false,source:'planning_assumption'};
}

export function evaluateRoute({orders,vehicle,driver,policy,serviceDate,startAt=null,matrix=null}){
  const hard=[],review=[],legs=[],stops=[];
  if(!vehicle||!driver)return {status:'infeasible',hard:['RESOURCE_MISSING'],review,metrics:{},legs,stops};
  if(vehicle.branch!==driver.branch)hard.push('RESOURCE_BRANCH_MISMATCH');
  const expectedGroup=policy.vehicle_profiles[vehicle.type]?.driver_group;
  if(expectedGroup&&driver.group_name!==expectedGroup)hard.push('DRIVER_GROUP_MISMATCH');
  if(driver.compatible_vehicle_type&&driver.compatible_vehicle_type!==vehicle.type)hard.push('DRIVER_VEHICLE_QUALIFICATION_MISMATCH');
  if(driver.roster_status!=='active_unverified'&&driver.roster_status!=='active')review.push('ROSTER_STATUS_UNVERIFIED');
  if(!driver.shift_start||!driver.shift_end)review.push('SHIFT_UNVERIFIED');
  if(vehicle.capacity_status!=='verified')review.push('VEHICLE_CAPACITY_UNVERIFIED');
  const totalWeight=orders.reduce((s,o)=>s+(Number.isFinite(Number(o.total_weight_kg))?Number(o.total_weight_kg):0),0);
  if(orders.some(o=>o.total_weight_kg==null))review.push('WEIGHT_UNKNOWN');
  if(vehicle.payload_limit_kg!=null&&totalWeight>Number(vehicle.payload_limit_kg))hard.push('CAPACITY_WEIGHT');
  if(vehicle.max_route_orders!=null&&orders.length>Number(vehicle.max_route_orders))hard.push('ROUTE_ORDER_COUNT');
  for(const o of orders){
    if(o.branch!==vehicle.branch)hard.push('ORDER_BRANCH_MISMATCH');
    if(o.data_quality!=='ok'||o.suggested_vehicle_type==='Cần rà soát')review.push(`ORDER_DATA_REVIEW:${o.id}`);
    const allowed=vehicleTypeForOrder(o);if(!allowed.includes(vehicle.type))hard.push(`VEHICLE_INCOMPATIBLE:${o.id}`);
    if(o.max_dimension_mm==null)review.push(`DIMENSION_UNKNOWN:${o.id}`);
    else if(vehicle.max_dimension_mm!=null&&Number(o.max_dimension_mm)>Number(vehicle.max_dimension_mm))hard.push(`DIMENSION_LIMIT:${o.id}`);
    if(o.suggested_vehicle_type==='Ô tô'&&(Number(o.total_weight_kg||0)>=50||Number(o.max_dimension_mm||0)>=900)&&!driver.helper_verified)review.push(`HELPER_REQUIREMENT_UNKNOWN:${o.id}`);
  }
  const day=serviceDate||orders[0]?.service_date||new Date().toISOString().slice(0,10);
  let clock=startAt?new Date(startAt):timeOnServiceDay(day,policy.workday.start),prev='DEPOT',km=0,travelMin=0,serviceMin=0,softLateness=0;
  const plannedStart=clock.toISOString();if(startAt)review.push('ROUTE_START_FROM_RESOURCE_CALENDAR');
  if(driver.shift_start&&clock<new Date(driver.shift_start))clock=new Date(driver.shift_start);
  for(let i=0;i<orders.length;i++){
    const o=orders[i],next=nodeKey(o),leg=travelFor({matrix,policy,branch:vehicle.branch,type:vehicle.type,from:prev,to:next});if(!leg.verified)review.push('TRAVEL_MATRIX_UNVERIFIED');
    clock=addMinutes(clock,leg.minutes);travelMin+=leg.minutes;km+=leg.km;
    const w=windowFor(o,policy);if(!w.verified)review.push('SLA_WINDOW_UNVERIFIED');if(w.start&&clock<w.start)clock=new Date(w.start);
    const arrival=clock.toISOString(),svc=Number(policy.service_minutes[vehicle.type]||10);clock=addMinutes(clock,svc);serviceMin+=svc;
    const completion=clock;if(completion>w.end){const late=Math.max(0,minutesBetween(w.end,completion));if(w.verified)hard.push(`HARD_SLA:${o.id}`);else softLateness+=late;}
    stops.push({sequence:i+1,orderId:o.id,nodeKey:next,arrival,departure:clock.toISOString(),serviceMinutes:svc,slaWindowEnd:w.end.toISOString(),slaVerified:w.verified});legs.push({from:prev,to:next,...leg});prev=next;
  }
  const back=travelFor({matrix,policy,branch:vehicle.branch,type:vehicle.type,from:prev,to:'DEPOT'});if(!back.verified)review.push('TRAVEL_MATRIX_UNVERIFIED');travelMin+=back.minutes;km+=back.km;clock=addMinutes(clock,back.minutes);legs.push({from:prev,to:'DEPOT',...back});
  if(driver.shift_end&&clock>new Date(driver.shift_end))hard.push('SHIFT_END');
  const defaultEnd=timeOnServiceDay(day,policy.workday.end),horizonOverrun=Math.max(0,minutesBetween(defaultEnd,clock));if(horizonOverrun>0&&!driver.shift_end)review.push('PLANNING_HORIZON_OVERRUN');
  const status=hard.length?'infeasible':review.length?'review_required':'feasible';
  return {status,hard:uniq(hard),review:uniq(review),metrics:{orders:orders.length,totalWeightKg:Number(totalWeight.toFixed(2)),distanceKm:Number(km.toFixed(2)),travelMinutes:travelMin,serviceMinutes:serviceMin,routeMinutes:travelMin+serviceMin,softLatenessMinutes:softLateness,horizonOverrunMinutes:horizonOverrun,plannedStart,plannedEnd:clock.toISOString()},legs,stops};
}

export function evaluateAssignment({order,vehicle,driver,policy,matrix=null}){return evaluateRoute({orders:[order],vehicle,driver,policy,serviceDate:order.service_date,matrix});}
export function buildMatrixMap(rows=[]){const m=new Map();for(const r of rows)m.set(matrixKey(r.branch,r.vehicle_type||r.vehicleType,r.from_node||r.fromNode,r.to_node||r.toNode),r);return m;}
