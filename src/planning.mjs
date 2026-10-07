export const POLICY = {
  policy_version:'cloudflare_planning_assumptions_v0.5',matrix_version:'district_heuristic_v1',
  workday:{start:'08:00',end:'18:00'},service_minutes:{motorbike:8,auto:15},
  fleet_counts:{HCM:{motorbike:8,auto:5},'Hà Nội':{motorbike:15,auto:5}},
  vehicle_profiles:{
    motorbike:{display_name:'Xe máy',driver_group:'Xe máy',payload_limit_kg:25,max_dimension_mm:700,max_route_orders:12,capacity_status:'unverified_assumption'},
    auto:{display_name:'Ô tô',driver_group:'Lái xe',payload_limit_kg:250,max_dimension_mm:1800,max_route_orders:10,capacity_status:'unverified_assumption'}
  },
  travel_heuristic:{same_district_minutes:{motorbike:8,auto:10},cross_district_minutes:{motorbike:22,auto:26},depot_minutes:{motorbike:20,auto:24},same_district_km:3,cross_district_km:9,depot_km:10,source:'heuristic_unverified_v1'},
  objective:{auto_for_motorbike_extra_km:3},max_trips_per_vehicle:3,turnaround_minutes:20
};
export function vehicleTypeForOrder(order){if(order.suggested_vehicle_type==='Ô tô')return['auto'];if(order.suggested_vehicle_type==='Xe máy')return['motorbike','auto'];return[]}
export function nodeKey(order){return order?.district_id!=null?`DISTRICT:${order.district_id}`:`DISTRICT_NAME:${order?.district||order?.city||'UNKNOWN'}`}
export function buildPlanningVehicles(policy=POLICY,branches=['HCM','Hà Nội']){const out=[];for(const branch of branches){const counts=policy.fleet_counts?.[branch]||{};for(const type of ['motorbike','auto']){const p=policy.vehicle_profiles[type],n=Number(counts[type]||0);for(let i=1;i<=n;i++)out.push({id:`${branch==='HCM'?'HCM':'HN'}-${type==='motorbike'?'MOTO':'AUTO'}-${String(i).padStart(2,'0')}`,branch,type,display_name:p.display_name,payload_limit_kg:p.payload_limit_kg,max_dimension_mm:p.max_dimension_mm,max_route_orders:p.max_route_orders,verification_status:'unverified_declared_fleet_slot',capacity_status:p.capacity_status,status:'planning_available'})}}return out}
export function travelEstimate(policy,branch,vehicleType,fromKey,toKey){const h=policy.travel_heuristic;if(fromKey===toKey)return{minutes:0,km:0,source:h.source,verified:false,matrixVersion:policy.matrix_version};const depot=fromKey==='DEPOT'||toKey==='DEPOT';const minutes=depot?h.depot_minutes[vehicleType]:h.cross_district_minutes[vehicleType],km=depot?h.depot_km:h.cross_district_km;return{minutes,km,source:h.source,verified:false,matrixVersion:policy.matrix_version,branch}}
export function timeOnServiceDay(serviceDate,hhmm){const[h,m]=String(hhmm).split(':').map(Number);return new Date(`${serviceDate}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00+07:00`)}
