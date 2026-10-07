import { evaluateRoute } from './feasibility.mjs';
import { buildPlanningVehicles, timeOnServiceDay, vehicleTypeForOrder } from './planning.mjs';

function tupleCmp(a,b){for(let i=0;i<Math.max(a.length,b.length);i++){const x=a[i]??0,y=b[i]??0;if(x!==y)return x-y}return 0;}
function cloneRoute(r){return {...r,orders:[...r.orders]};}
function addMinutes(iso,m){return new Date(new Date(iso).getTime()+m*60000).toISOString();}

export function buildAdvancedShadowPlan({orders,drivers,policy,branches=['HCM','Hà Nội'],vehicles:providedVehicles=null,matrix=null}){
  const allowed=new Set(branches),vehicles=(providedVehicles||buildPlanningVehicles(policy,branches)).filter(v=>allowed.has(v.branch));
  let remaining=orders.filter(o=>allowed.has(o.branch)&&o.assigned_driver_id==null&&(o.execution_state||'at_depot')==='at_depot'&&o.suggested_vehicle_type!=='Cần rà soát');
  const blocked=orders.filter(o=>allowed.has(o.branch)&&o.assigned_driver_id==null&&(o.execution_state||'at_depot')==='at_depot'&&o.suggested_vehicle_type==='Cần rà soát').map(o=>({orderId:o.id,reasons:['ORDER_DATA_REVIEW']}));
  const inputCount=remaining.length;
  const driverPools={};for(const d of drivers.filter(d=>allowed.has(d.branch))){const k=`${d.branch}|${d.group_name}`;(driverPools[k]??=[]).push(d)}for(const v of Object.values(driverPools))v.sort((a,b)=>a.id-b.id);
  const resources=[];
  for(const vehicle of vehicles){const group=policy.vehicle_profiles[vehicle.type].driver_group,pool=driverPools[`${vehicle.branch}|${group}`]||[];const driver=pool.shift();if(driver)resources.push({vehicle,driver,trips:[]});}
  const scarcity=o=>vehicleTypeForOrder(o).length;
  const sortOrders=a=>a.sort((x,y)=>scarcity(x)-scarcity(y)||Number(y.total_weight_kg||0)-Number(x.total_weight_kg||0)||String(x.district||'').localeCompare(String(y.district||''),'vi')||x.id-y.id);
  sortOrders(remaining);
  const allRoutes=[];
  const maxTrips=Number(policy.max_trips_per_vehicle||1);
  for(let tripIndex=1;tripIndex<=maxTrips&&remaining.length;tripIndex++){
    const wave=[];
    for(const resource of resources){
      let startAt=timeOnServiceDay(orders[0]?.service_date||new Date().toISOString().slice(0,10),policy.workday.start).toISOString();
      if(resource.trips.length){const prev=resource.trips[resource.trips.length-1];startAt=addMinutes(prev.feasibility.metrics.plannedEnd,Number(policy.turnaround_minutes||0));}
      wave.push({routeId:`R-${resource.vehicle.id}-T${tripIndex}`,tripIndex,startAt,vehicle:resource.vehicle,driver:resource.driver,orders:[],resource});
    }
    const nextRemaining=[];
    for(const order of remaining){let best=null;
      for(const route of wave){if(route.vehicle.branch!==order.branch||!vehicleTypeForOrder(order).includes(route.vehicle.type))continue;
        for(let pos=0;pos<=route.orders.length;pos++){
          const trial=cloneRoute(route);trial.orders.splice(pos,0,order);const e=evaluateRoute({orders:trial.orders,vehicle:trial.vehicle,driver:trial.driver,policy,serviceDate:order.service_date,startAt:trial.startAt,matrix});if(e.status==='infeasible')continue;
          const extraAuto=order.suggested_vehicle_type==='Xe máy'&&route.vehicle.type==='auto'?Number(policy.objective.auto_for_motorbike_extra_km||0):0;
          const objective=[e.metrics.softLatenessMinutes,e.metrics.horizonOverrunMinutes,e.metrics.distanceKm+extraAuto,e.metrics.routeMinutes,route.orders.length];
          const option={route,pos,e,objective};if(!best||tupleCmp(objective,best.objective)<0)best=option;
        }
      }
      if(!best)nextRemaining.push(order);else best.route.orders.splice(best.pos,0,order);
    }
    for(const route of wave){if(!route.orders.length)continue;route.feasibility=evaluateRoute({orders:route.orders,vehicle:route.vehicle,driver:route.driver,policy,serviceDate:route.orders[0].service_date,startAt:route.startAt,matrix});route.resource.trips.push(route);allRoutes.push(route);}
    remaining=sortOrders(nextRemaining);
  }
  const unassigned=remaining.map(o=>({orderId:o.id,reasons:['NO_FEASIBLE_RESOURCE_UNDER_ASSUMPTIONS']}));
  const proposals=[],routeSummaries=[];
  for(const route of allRoutes){const e=route.feasibility;routeSummaries.push({routeId:route.routeId,tripIndex:route.tripIndex,startAt:route.startAt,vehicle:route.vehicle,driver:{id:route.driver.id,full_name:route.driver.full_name,group_name:route.driver.group_name},feasibility:e});
    e.stops.forEach(stop=>{const order=route.orders.find(o=>o.id===stop.orderId);proposals.push({orderId:stop.orderId,driverId:route.driver.id,vehicleId:route.vehicle.id,vehicleType:route.vehicle.type,routeId:route.routeId,tripIndex:route.tripIndex,sequence:stop.sequence,plannedArrival:stop.arrival,plannedDeparture:stop.departure,feasibilityStatus:e.status,hard:e.hard,review:[...new Set([...e.review,'TURNAROUND_ASSUMED'])],reason:`Shadow v2: ${route.vehicle.display_name} ${route.vehicle.id}, chuyến ${route.tripIndex}, stop ${stop.sequence}; route ${e.metrics.distanceKm} km / ${e.metrics.routeMinutes} phút. Dùng capacity/SLA/travel/turnaround assumptions chưa xác minh.`,score:{route:e.metrics,vehicle_type:route.vehicle.type,vehicle_id:route.vehicle.id,trip_index:route.tripIndex,sequence:stop.sequence,order_weight_kg:order.total_weight_kg,policy_version:policy.policy_version,matrix_version:policy.matrix_version}});});
  }
  return {algorithmVersion:'shadow_insertion_feasibility_v2',policyVersion:policy.policy_version,matrixVersion:policy.matrix_version,inputCount,proposalCount:proposals.length,blocked,unassigned,proposals,routes:routeSummaries};
}
