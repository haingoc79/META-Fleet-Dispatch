import { buildAdvancedShadowPlan } from './shadow-dispatch-v2.mjs';
import { POLICY, buildPlanningVehicles } from './planning.mjs';
import { buildSpatialRouteJobs, fetchRouteMatrix, optimizeMatrixSequence, routeMetrics, defaultRouteStart, nextTripStart, MAP_POLICY } from './map-routing.mjs';

let schemaReady;
const json=(x,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const now=()=>new Date().toISOString();
const uniq=a=>[...new Set(a)];

async function schema(env){
  if(!env.DB) throw Object.assign(new Error('D1_NOT_BOUND'),{status:503});
  if(!schemaReady) schemaReady=env.DB.exec(`
    CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY,service_date TEXT NOT NULL,branch TEXT NOT NULL,payload_json TEXT NOT NULL,cod_required INTEGER NOT NULL DEFAULT 1,cod_amount_due_vnd INTEGER NOT NULL DEFAULT 0,cod_status TEXT NOT NULL DEFAULT 'due',assigned_driver_id INTEGER,assignment_reason TEXT,version INTEGER NOT NULL DEFAULT 0,execution_state TEXT NOT NULL DEFAULT 'at_depot',updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_orders_branch ON orders(branch,id);
    CREATE TABLE IF NOT EXISTS drivers(id INTEGER PRIMARY KEY,branch TEXT NOT NULL,group_name TEXT NOT NULL,full_name TEXT NOT NULL,roster_status TEXT NOT NULL DEFAULT 'active_unverified',payload_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS import_batches(id INTEGER PRIMARY KEY AUTOINCREMENT,source TEXT NOT NULL,actor TEXT NOT NULL,service_date TEXT,order_count INTEGER NOT NULL,product_row_count INTEGER NOT NULL,driver_count INTEGER NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS dispatch_runs(id INTEGER PRIMARY KEY AUTOINCREMENT,actor TEXT NOT NULL,scope_json TEXT NOT NULL,algorithm_version TEXT NOT NULL,status TEXT NOT NULL,input_count INTEGER NOT NULL,proposal_count INTEGER NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS dispatch_proposals(id INTEGER PRIMARY KEY AUTOINCREMENT,run_id INTEGER NOT NULL,order_id INTEGER NOT NULL,driver_id INTEGER NOT NULL,vehicle_id TEXT NOT NULL,vehicle_type TEXT NOT NULL,route_id TEXT NOT NULL,trip_index INTEGER NOT NULL,sequence_no INTEGER NOT NULL,planned_arrival TEXT,planned_departure TEXT,feasibility_status TEXT NOT NULL,reason TEXT NOT NULL,score_json TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(run_id,order_id));
    CREATE TABLE IF NOT EXISTS assignment_audit(id INTEGER PRIMARY KEY AUTOINCREMENT,order_id INTEGER NOT NULL,action TEXT NOT NULL,actor TEXT NOT NULL,reason TEXT NOT NULL,before_driver_id INTEGER,after_driver_id INTEGER,before_version INTEGER NOT NULL,after_version INTEGER NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS map_config(branch TEXT PRIMARY KEY,depot_address TEXT NOT NULL,depot_place_id TEXT,depot_lat REAL,depot_lng REAL,geocode_status TEXT NOT NULL DEFAULT 'pending',geocode_fetched_at TEXT,geocode_expires_at TEXT,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS order_geocodes(order_id INTEGER NOT NULL,service_date TEXT NOT NULL,place_id TEXT,lat REAL,lng REAL,geocode_status TEXT NOT NULL,error_text TEXT,fetched_at TEXT NOT NULL,expires_at TEXT NOT NULL,PRIMARY KEY(order_id,service_date));
    CREATE TABLE IF NOT EXISTS map_route_jobs(id INTEGER PRIMARY KEY AUTOINCREMENT,run_id INTEGER NOT NULL,route_id TEXT NOT NULL,vehicle_id TEXT NOT NULL,vehicle_type TEXT NOT NULL,driver_id INTEGER NOT NULL,trip_index INTEGER NOT NULL,branch TEXT NOT NULL,order_ids_json TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',metrics_json TEXT,error_text TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(run_id,route_id));
    CREATE INDEX IF NOT EXISTS idx_map_jobs_run ON map_route_jobs(run_id,status,trip_index,id);
  `);
  return schemaReady;
}

function accessContext(request,env){
  if(env.MFD_ALLOW_UNAUTHENTICATED==='true') return {email:'preview@local',role:'admin',viewerDomain:'local'};
  const raw=request.headers.get('cf-access-authenticated-user-email')||request.headers.get('Cf-Access-Authenticated-User-Email');
  if(!raw) throw Object.assign(new Error('ACCESS_REQUIRED'),{status:401});
  const email=String(raw).trim().toLowerCase();
  const viewerDomain=String(env.MFD_VIEWER_DOMAIN||'meta.vn').trim().toLowerCase();
  if(!email.endsWith('@'+viewerDomain)) throw Object.assign(new Error('EMAIL_DOMAIN_DENIED'),{status:403});
  const admins=new Set(String(env.MFD_ADMIN_EMAILS||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean));
  return {email,role:admins.has(email)?'admin':'viewer',viewerDomain};
}
function requireAdmin(user){
  if(user.role!=='admin') throw Object.assign(new Error('READ_ONLY_USER'),{status:403});
}

function mapsKey(env){
  if(!env.GOOGLE_MAPS_API_KEY) throw Object.assign(new Error('MAPS_API_KEY_MISSING'),{status:409});
  return env.GOOGLE_MAPS_API_KEY;
}
function plusHours(iso,h){return new Date(new Date(iso).getTime()+h*3600000).toISOString();}
function activeCache(row){const exp=row?.expires_at||row?.geocode_expires_at;return Boolean(row&&row.geocode_status==='ok'&&exp&&new Date(exp)>new Date());}
async function googleGeocode(apiKey,address){
  const q=encodeURIComponent(String(address||'').trim()+', Việt Nam');
  const res=await fetch(`https://geocode.googleapis.com/v4/geocode/address/${q}?languageCode=vi&regionCode=vn`,{headers:{'X-Goog-Api-Key':apiKey,'X-Goog-FieldMask':'results.placeId,results.location,results.granularity'}});
  if(!res.ok)throw new Error(`GEOCODE_API_${res.status}:${(await res.text()).slice(0,220)}`);
  const body=await res.json(),x=body?.results?.[0];
  if(!x?.placeId||x?.location?.latitude==null||x?.location?.longitude==null)throw new Error('GEOCODE_NO_RESULT');
  return {placeId:x.placeId,lat:Number(x.location.latitude),lng:Number(x.location.longitude),granularity:x.granularity||null};
}
async function getMapConfig(env){const r=await env.DB.prepare('SELECT * FROM map_config ORDER BY branch').all();return r.results||[];}

async function mapDiagnostics(env){
  const s=await loadState(env),serviceDate=s.orders[0]?.service_date||null,omap=new Map(s.orders.map(o=>[Number(o.id),o]));
  if(!serviceDate)return {serviceDate:null,errorGroups:[],samples:[]};
  const rows=await env.DB.prepare(`SELECT order_id,geocode_status,error_text,fetched_at,expires_at FROM order_geocodes WHERE service_date=? AND geocode_status!='ok' ORDER BY fetched_at DESC`).bind(serviceDate).all();
  const groups=new Map(),samples=[];
  for(const r of rows.results||[]){
    const raw=String(r.error_text||'UNKNOWN'),key=raw.split(':')[0].slice(0,80);
    groups.set(key,(groups.get(key)||0)+1);
    if(samples.length<30){
      const o=omap.get(Number(r.order_id));
      samples.push({orderId:Number(r.order_id),branch:o?.branch||null,address:o?.full_address||null,district:o?.district||null,error:raw});
    }
  }
  return {serviceDate,totalFailed:(rows.results||[]).length,errorGroups:[...groups.entries()].map(([error,count])=>({error,count})).sort((a,b)=>b.count-a.count),samples};
}

async function mapStatus(env){
  const s=await loadState(env),configs=await getMapConfig(env),nowIso=now(),serviceDate=s.orders[0]?.service_date||null;
  const eligible=s.orders.filter(o=>o.assigned_driver_id==null&&(o.execution_state||'at_depot')==='at_depot'&&o.suggested_vehicle_type!=='Cần rà soát');
  let geocoded=0,failed=0;
  if(serviceDate){
    const g=await env.DB.prepare('SELECT order_id,geocode_status,expires_at FROM order_geocodes WHERE service_date=?').bind(serviceDate).all();
    const ok=new Set(),bad=new Set();
    for(const x of g.results||[]){if(x.geocode_status==='ok'&&x.expires_at&&x.expires_at>nowIso)ok.add(Number(x.order_id));else if(x.geocode_status==='error')bad.add(Number(x.order_id));}
    geocoded=eligible.filter(o=>ok.has(Number(o.id))).length;failed=eligible.filter(o=>bad.has(Number(o.id))).length;
  }
  const depotStatus=configs.map(x=>({branch:x.branch,address:x.depot_address,geocoded:activeCache(x),status:x.geocode_status}));
  const requiredBranches=[...new Set(eligible.map(o=>o.branch))];
  const depotsReady=requiredBranches.every(b=>depotStatus.some(x=>x.branch===b&&x.geocoded));
  return {provider:'google_maps_platform',apiConfigured:Boolean(env.GOOGLE_MAPS_API_KEY),serviceDate,eligibleOrders:eligible.length,geocodedOrders:geocoded,failedOrders:failed,depots:depotStatus,routeReady:Boolean(env.GOOGLE_MAPS_API_KEY)&&depotsReady&&(geocoded+failed===eligible.length)&&eligible.length>0};
}
async function saveMapConfig(env,p){
  const at=now(),rows=[['HCM',p.hcmDepot],['Hà Nội',p.hnDepot]].filter(x=>String(x[1]||'').trim());
  if(!rows.length)throw Object.assign(new Error('DEPOT_ADDRESS_REQUIRED'),{status:400});
  const stmts=rows.map(([branch,address])=>env.DB.prepare(`INSERT INTO map_config(branch,depot_address,geocode_status,updated_at) VALUES(?,?,'pending',?) ON CONFLICT(branch) DO UPDATE SET depot_address=excluded.depot_address,depot_place_id=NULL,depot_lat=NULL,depot_lng=NULL,geocode_status='pending',geocode_fetched_at=NULL,geocode_expires_at=NULL,updated_at=excluded.updated_at`).bind(branch,String(address).trim(),at));
  await env.DB.batch(stmts);return {ok:true,branches:rows.map(x=>x[0])};
}
async function geocodeStep(env){
  const apiKey=mapsKey(env),at=now(),exp=plusHours(at,MAP_POLICY.geocodeTtlHours),configs=await getMapConfig(env);
  let processed=0,success=0,failed=0;
  for(const c of configs){
    if(activeCache(c))continue;
    try{const g=await googleGeocode(apiKey,c.depot_address);await env.DB.prepare(`UPDATE map_config SET depot_place_id=?,depot_lat=?,depot_lng=?,geocode_status='ok',geocode_fetched_at=?,geocode_expires_at=?,updated_at=? WHERE branch=?`).bind(g.placeId,g.lat,g.lng,at,exp,at,c.branch).run();success++;}catch(e){await env.DB.prepare(`UPDATE map_config SET geocode_status='error',updated_at=? WHERE branch=?`).bind(at,c.branch).run();failed++;}processed++;
  }
  const s=await loadState(env),serviceDate=s.orders[0]?.service_date||null;if(!serviceDate)return {processed,success,failed,status:await mapStatus(env)};
  const gr=await env.DB.prepare('SELECT * FROM order_geocodes WHERE service_date=?').bind(serviceDate).all(),gm=new Map((gr.results||[]).map(x=>[Number(x.order_id),x]));
  const candidates=s.orders.filter(o=>{if(o.assigned_driver_id!=null||(o.execution_state||'at_depot')!=='at_depot'||o.suggested_vehicle_type==='Cần rà soát')return false;const row=gm.get(Number(o.id));return !row||!row.expires_at||new Date(row.expires_at)<=new Date();}).slice(0,MAP_POLICY.geocodeBatch);
  const results=await Promise.all(candidates.map(async o=>{
    try{const g=await googleGeocode(apiKey,o.full_address);return {o,g};}catch(e){return {o,error:e.message};}
  }));
  const stmts=[];
  for(const x of results){processed++;if(x.g){success++;stmts.push(env.DB.prepare(`INSERT INTO order_geocodes(order_id,service_date,place_id,lat,lng,geocode_status,error_text,fetched_at,expires_at) VALUES(?,?,?,?,?,'ok',NULL,?,?) ON CONFLICT(order_id,service_date) DO UPDATE SET place_id=excluded.place_id,lat=excluded.lat,lng=excluded.lng,geocode_status='ok',error_text=NULL,fetched_at=excluded.fetched_at,expires_at=excluded.expires_at`).bind(x.o.id,serviceDate,x.g.placeId,x.g.lat,x.g.lng,at,exp));}else{failed++;stmts.push(env.DB.prepare(`INSERT INTO order_geocodes(order_id,service_date,geocode_status,error_text,fetched_at,expires_at) VALUES(?,?,'error',?,?,?) ON CONFLICT(order_id,service_date) DO UPDATE SET geocode_status='error',error_text=excluded.error_text,fetched_at=excluded.fetched_at,expires_at=excluded.expires_at`).bind(x.o.id,serviceDate,x.error||'GEOCODE_FAILED',at,exp));}}
  if(stmts.length)await env.DB.batch(stmts);
  return {processed,success,failed,status:await mapStatus(env)};
}
async function mapData(env,orders){
  const serviceDate=orders[0]?.service_date,gr=serviceDate?await env.DB.prepare(`SELECT * FROM order_geocodes WHERE service_date=? AND geocode_status='ok' AND expires_at>?`).bind(serviceDate,now()).all():{results:[]};
  const geocodes=new Map((gr.results||[]).map(x=>[Number(x.order_id),{lat:Number(x.lat),lng:Number(x.lng),placeId:x.place_id}]));
  const cr=await env.DB.prepare(`SELECT * FROM map_config WHERE geocode_status='ok' AND geocode_expires_at>?`).bind(now()).all();
  const depots=new Map((cr.results||[]).map(x=>[x.branch,{lat:Number(x.depot_lat),lng:Number(x.depot_lng),placeId:x.depot_place_id,address:x.depot_address}]));
  return {geocodes,depots};
}
async function startMapProposal(env,user){
  mapsKey(env);const status=await mapStatus(env);if(!status.routeReady)throw Object.assign(new Error('MAP_NOT_READY'),{status:409});
  const s=await loadState(env),md=await mapData(env,s.orders),plan=buildSpatialRouteJobs({orders:s.orders,drivers:s.drivers,policy:POLICY,geocodes:md.geocodes,depots:md.depots}),at=now();
  const missing=s.orders.filter(o=>o.assigned_driver_id==null&&(o.execution_state||'at_depot')==='at_depot'&&o.suggested_vehicle_type!=='Cần rà soát'&&!md.geocodes.has(Number(o.id))).map(o=>({orderId:o.id,reasons:['MAP_GEOCODE_FAILED_OR_MISSING']}));
  plan.blocked.push(...missing);
  const scope={branches:['HCM','Hà Nội'],provider:'google_maps_platform',cluster:'spatial_bearing_v1',blocked:plan.blocked,unassigned:plan.unassigned};
  const run=await env.DB.prepare(`INSERT INTO dispatch_runs(actor,scope_json,algorithm_version,status,input_count,proposal_count,created_at) VALUES(?,?,'shadow_map_google_routes_v1','map_building',?,0,?) RETURNING id`).bind(user,JSON.stringify(scope),status.eligibleOrders,at).first();
  const stmts=plan.jobs.map(j=>env.DB.prepare(`INSERT INTO map_route_jobs(run_id,route_id,vehicle_id,vehicle_type,driver_id,trip_index,branch,order_ids_json,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'pending',?,?)`).bind(run.id,j.routeId,j.vehicle.id,j.vehicle.type,j.driver.id,j.tripIndex,j.vehicle.branch,JSON.stringify(j.orders.map(o=>o.id)),at,at));
  for(let i=0;i<stmts.length;i+=50)await env.DB.batch(stmts.slice(i,i+50));
  return {runId:run.id,jobs:plan.jobs.length,inputCount:plan.inputCount,blocked:plan.blocked,unassigned:plan.unassigned};
}
async function stepMapProposal(env,runId){
  const apiKey=mapsKey(env),run=await env.DB.prepare('SELECT * FROM dispatch_runs WHERE id=?').bind(runId).first();if(!run)throw Object.assign(new Error('RUN_NOT_FOUND'),{status:404});
  const minTrip=await env.DB.prepare(`SELECT MIN(trip_index) AS t FROM map_route_jobs WHERE run_id=? AND status='pending'`).bind(runId).first();
  if(minTrip?.t==null)return {runId,pending:0,done:Number((await env.DB.prepare(`SELECT COUNT(*) c FROM map_route_jobs WHERE run_id=? AND status='done'`).bind(runId).first()).c||0),errors:Number((await env.DB.prepare(`SELECT COUNT(*) c FROM map_route_jobs WHERE run_id=? AND status='error'`).bind(runId).first()).c||0)};
  const jr=await env.DB.prepare(`SELECT * FROM map_route_jobs WHERE run_id=? AND status='pending' AND trip_index=? ORDER BY id LIMIT ?`).bind(runId,minTrip.t,MAP_POLICY.matrixBatch).all();
  const s=await loadState(env),omap=new Map(s.orders.map(o=>[Number(o.id),o])),dmap=new Map(s.drivers.map(d=>[Number(d.id),d])),md=await mapData(env,s.orders);
  for(const job of jr.results||[]){
    try{
      const ids=JSON.parse(job.order_ids_json),orders=ids.map(id=>omap.get(Number(id))).filter(Boolean),depot=md.depots.get(job.branch);if(!depot)throw new Error('DEPOT_MISSING');
      const points=[depot,...orders.map(o=>md.geocodes.get(Number(o.id)))];if(points.some(x=>!x?.placeId))throw new Error('GEOCODE_MISSING');
      let startAt=defaultRouteStart(orders[0]?.service_date||new Date().toISOString().slice(0,10),POLICY);
      if(job.trip_index===1&&new Date(startAt)<new Date())startAt=new Date().toISOString();
      if(job.trip_index>1){const prev=await env.DB.prepare(`SELECT metrics_json FROM map_route_jobs WHERE run_id=? AND vehicle_id=? AND trip_index<? AND status='done' ORDER BY trip_index DESC LIMIT 1`).bind(runId,job.vehicle_id,job.trip_index).first();if(prev?.metrics_json)startAt=nextTripStart(JSON.parse(prev.metrics_json).plannedEnd);}
      const matrix=await fetchRouteMatrix({apiKey,placeIds:points.map(x=>x.placeId),vehicleType:job.vehicle_type,departureTime:startAt});
      const seq=optimizeMatrixSequence(matrix),metrics=routeMetrics({seq,matrix,startAt,serviceMinutes:Number(POLICY.service_minutes[job.vehicle_type]||10)}),at=now(),proposals=[];
      for(const stop of metrics.stops){const o=orders[stop.nodeIndex-1];if(!o)continue;proposals.push(env.DB.prepare(`INSERT INTO dispatch_proposals(run_id,order_id,driver_id,vehicle_id,vehicle_type,route_id,trip_index,sequence_no,planned_arrival,planned_departure,feasibility_status,reason,score_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,'review_required',?,?,?)`).bind(runId,o.id,job.driver_id,job.vehicle_id,job.vehicle_type,job.route_id,job.trip_index,stop.sequence,stop.arrival,stop.departure,`Map-aware: Google Routes ${matrix.travelMode}; spatial cluster + road-time matrix. Capacity/SLA vẫn có assumptions chưa xác minh.`,JSON.stringify({provider:'google_routes_v2',distance_km:metrics.distanceKm,travel_minutes:metrics.travelMinutes,leg_km:Number((stop.legMeters/1000).toFixed(2)),leg_minutes:Math.round(stop.legSeconds/60),map_mode_fallback:matrix.fallback,product_names:(o.products||[]).map(p=>p.model_name)}),at));}
      for(let i=0;i<proposals.length;i+=40)await env.DB.batch(proposals.slice(i,i+40));
      await env.DB.prepare(`UPDATE map_route_jobs SET status='done',metrics_json=?,updated_at=? WHERE id=?`).bind(JSON.stringify({...metrics,mapFallback:matrix.fallback,travelMode:matrix.travelMode}),at,job.id).run();
    }catch(e){await env.DB.prepare(`UPDATE map_route_jobs SET status='error',error_text=?,updated_at=? WHERE id=?`).bind(String(e.message||e).slice(0,500),now(),job.id).run();}
  }
  const counts=await env.DB.prepare(`SELECT status,COUNT(*) c FROM map_route_jobs WHERE run_id=? GROUP BY status`).bind(runId).all(),m=Object.fromEntries((counts.results||[]).map(x=>[x.status,Number(x.c)]));
  if(!m.pending){const pc=await env.DB.prepare('SELECT COUNT(*) c FROM dispatch_proposals WHERE run_id=?').bind(runId).first();await env.DB.prepare(`UPDATE dispatch_runs SET status=?,proposal_count=? WHERE id=?`).bind(m.error?'shadow_map_complete_with_errors':'shadow_map_complete',Number(pc.c||0),runId).run();}
  return {runId,pending:m.pending||0,done:m.done||0,errors:m.error||0};
}

function index(headers){const m={};(headers||[]).forEach((h,i)=>m[String(h||'').trim()]=i);return m;}
function weight(v){if(v==null||v==='')return null;if(typeof v==='number')return null;const m=String(v).trim().toLowerCase().replace(',','.').match(/^([0-9]+(?:\.[0-9]+)?)\s*(kg|g)$/);return m?(m[2]==='g'?Number(m[1])/1000:Number(m[1])):null;}

function normalize(payload){
  const [oh,...orows]=payload.orders||[],[ph,...prows]=payload.products||[],[dh,...drows]=payload.drivers||[];
  const oi=index(oh), products=new Map();
  for(const r of prows){const oid=Number(r?.[0]);if(!oid)continue;const p={product_id:r[1]??null,model_name:String(r[2]??''),d1:Number(r[3])||null,d2:Number(r[4])||null,d3:Number(r[5])||null,raw_weight:r[6]??null,weight_kg:weight(r[6]),unit_cost_vnd:Number(r[7])||0};if(!products.has(oid))products.set(oid,[]);products.get(oid).push(p);}
  const orders=[];
  for(const r of orows){
    const id=Number(r?.[oi.OrderID]);if(!id)continue;const ps=products.get(id)||[],flags=[];
    if(!ps.length)flags.push('MISSING_PRODUCT_DATA');if(ps.some(p=>p.weight_kg==null))flags.push('WEIGHT_UNKNOWN');
    const tw=ps.length&&ps.every(p=>p.weight_kg!=null)?ps.reduce((s,p)=>s+p.weight_kg,0):null;
    const dims=ps.flatMap(p=>[p.d1,p.d2,p.d3]).filter(Number.isFinite),maxDim=dims.length?Math.max(...dims):null;
    const cod=ps.reduce((s,p)=>s+p.unit_cost_vnd,0);if(cod<=0)flags.push('COD_AMOUNT_MISSING');
    let vehicle='Xe máy',reason='Hàng nhỏ/vừa theo heuristic MVP';
    if(flags.some(f=>f!=='COD_AMOUNT_MISSING')){vehicle='Cần rà soát';reason='Thiếu dữ liệu trọng lượng/sản phẩm';}
    else if(tw>=30||maxDim>=700||ps.some(p=>/tivi|máy giặt|máy sấy|tủ lạnh|điều hòa|loa thanh/i.test(p.model_name))){vehicle='Ô tô';reason='Trọng lượng/kích thước/nhóm hàng cồng kềnh';}
    orders.push({id,service_date:payload.serviceDate||'2026-10-07',order_date:String(r[oi.OrderDate]??''),branch:String(r[oi.ChiNhanh]??''),full_address:String(r[oi.FullAddress]??''),city_id:r[oi.ID_ThanhPho]??null,city:String(r[oi.ThanhPho]??''),district_id:r[oi.ID_Quan]??null,district:String(r[oi.Quan]??''),ward_id:r[oi.ID_Phuong]??null,ward:String(r[oi.Phuong]??''),product_count:ps.length,total_weight_kg:tw,max_dimension_mm:maxDim,suggested_vehicle_type:vehicle,suggestion_reason:reason,data_quality:flags.length?'warning':'ok',quality_flags:uniq(flags),products:ps,cod_required:true,cod_amount_due_vnd:cod,cod_status:'due'});
  }
  const drivers=drows.map(r=>({id:Number(r?.[0]),group_name:String(r?.[1]??''),full_name:String(r?.[2]??''),branch:String(r?.[3]??''),roster_status:'active_unverified'})).filter(x=>x.id);
  return {orders,drivers,productRows:prows.length};
}

async function importWorkbook(env,user,p){
  const x=normalize(p),at=now(),stmts=[];
  for(const d of x.drivers) stmts.push(env.DB.prepare(`INSERT INTO drivers(id,branch,group_name,full_name,roster_status,payload_json) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET branch=excluded.branch,group_name=excluded.group_name,full_name=excluded.full_name,roster_status=excluded.roster_status,payload_json=excluded.payload_json`).bind(d.id,d.branch,d.group_name,d.full_name,d.roster_status,JSON.stringify(d)));
  for(const o of x.orders) stmts.push(env.DB.prepare(`INSERT INTO orders(id,service_date,branch,payload_json,cod_required,cod_amount_due_vnd,cod_status,updated_at) VALUES(?,?,?,?,1,?,'due',?) ON CONFLICT(id) DO UPDATE SET service_date=excluded.service_date,branch=excluded.branch,payload_json=excluded.payload_json,cod_required=1,cod_amount_due_vnd=excluded.cod_amount_due_vnd,updated_at=excluded.updated_at`).bind(o.id,o.service_date,o.branch,JSON.stringify(o),o.cod_amount_due_vnd,at));
  for(let i=0;i<stmts.length;i+=50) await env.DB.batch(stmts.slice(i,i+50));
  await env.DB.prepare(`INSERT INTO import_batches(source,actor,service_date,order_count,product_row_count,driver_count,created_at) VALUES('xlsx_browser_upload',?,?,?,?,?,?)`).bind(user,p.serviceDate||'2026-10-07',x.orders.length,x.productRows,x.drivers.length,at).run();
  return {ok:true,orders:x.orders.length,drivers:x.drivers.length,productRows:x.productRows,codOrders:x.orders.length,codTotalVnd:x.orders.reduce((s,o)=>s+o.cod_amount_due_vnd,0),reviewRequired:x.orders.filter(o=>o.suggested_vehicle_type==='Cần rà soát').length};
}

async function loadState(env){
  const [or,dr]=await Promise.all([env.DB.prepare(`SELECT * FROM orders ORDER BY id`).all(),env.DB.prepare(`SELECT payload_json FROM drivers ORDER BY id`).all()]);
  const orders=(or.results||[]).map(r=>({...JSON.parse(r.payload_json),assigned_driver_id:r.assigned_driver_id,assignment_reason:r.assignment_reason,version:r.version,execution_state:r.execution_state,cod_amount_due_vnd:r.cod_amount_due_vnd,cod_status:r.cod_status}));
  const drivers=(dr.results||[]).map(r=>JSON.parse(r.payload_json));return {orders,drivers};
}
async function latestRun(env){const run=await env.DB.prepare(`SELECT * FROM dispatch_runs ORDER BY id DESC LIMIT 1`).first();if(!run)return null;const p=await env.DB.prepare(`SELECT * FROM dispatch_proposals WHERE run_id=? ORDER BY route_id,sequence_no`).bind(run.id).all();return {...run,proposals:(p.results||[]).map(x=>({...x,score:JSON.parse(x.score_json)}))};}
async function bootstrap(env,user){const s=await loadState(env);return {...s,currentUser:{email:user.email,role:user.role,canWrite:user.role==='admin'},latestRun:await latestRun(env),policy:{version:POLICY.policy_version,capacity:'unverified_assumption',travel:'unverified_heuristic',sla:'unverified_workday'}};}

async function propose(env,user){
  const s=await loadState(env),plan=buildAdvancedShadowPlan({orders:s.orders,drivers:s.drivers,policy:POLICY,branches:['HCM','Hà Nội'],vehicles:buildPlanningVehicles(POLICY,['HCM','Hà Nội'])}),at=now();
  const ins=await env.DB.prepare(`INSERT INTO dispatch_runs(actor,scope_json,algorithm_version,status,input_count,proposal_count,created_at) VALUES(?,? ,?,'shadow',?,?,?) RETURNING id`).bind(user,JSON.stringify(['HCM','Hà Nội']),plan.algorithmVersion,plan.inputCount,plan.proposalCount,at).first();
  const runId=ins.id,stmts=plan.proposals.map(p=>env.DB.prepare(`INSERT INTO dispatch_proposals(run_id,order_id,driver_id,vehicle_id,vehicle_type,route_id,trip_index,sequence_no,planned_arrival,planned_departure,feasibility_status,reason,score_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(runId,p.orderId,p.driverId,p.vehicleId,p.vehicleType,p.routeId,p.tripIndex,p.sequence,p.plannedArrival,p.plannedDeparture,p.feasibilityStatus,p.reason,JSON.stringify(p.score),at));
  for(let i=0;i<stmts.length;i+=50) await env.DB.batch(stmts.slice(i,i+50));
  return {runId,...plan};
}

async function manualAssign(env,user,p){
  const driverId=Number(p.driverId),ids=(p.orderIds||[]).map(Number).filter(Boolean),reason=String(p.reason||'').trim();if(!driverId||!ids.length||!reason)throw Object.assign(new Error('DRIVER_ORDERS_REASON_REQUIRED'),{status:400});
  const d=await env.DB.prepare(`SELECT * FROM drivers WHERE id=?`).bind(driverId).first();if(!d)throw Object.assign(new Error('DRIVER_NOT_FOUND'),{status:404});
  const qs=ids.map(()=>'?').join(','),rows=await env.DB.prepare(`SELECT * FROM orders WHERE id IN (${qs})`).bind(...ids).all();if((rows.results||[]).length!==ids.length)throw Object.assign(new Error('ORDER_NOT_FOUND'),{status:404});
  const at=now(),stmts=[];for(const r of rows.results){const o=JSON.parse(r.payload_json);if(o.branch!==d.branch)throw Object.assign(new Error('BRANCH_MISMATCH'),{status:409});if(o.suggested_vehicle_type==='Ô tô'&&d.group_name==='Xe máy')throw Object.assign(new Error('VEHICLE_INCOMPATIBLE'),{status:409});stmts.push(env.DB.prepare(`UPDATE orders SET assigned_driver_id=?,assignment_reason=?,version=version+1,updated_at=? WHERE id=? AND execution_state='at_depot'`).bind(driverId,reason,at,r.id));stmts.push(env.DB.prepare(`INSERT INTO assignment_audit(order_id,action,actor,reason,before_driver_id,after_driver_id,before_version,after_version,created_at) VALUES(?,'assign',?,?,?,?,?,?,?)`).bind(r.id,user,reason,r.assigned_driver_id,driverId,r.version,r.version+1,at));}
  await env.DB.batch(stmts);return {ok:true,driverId,orderIds:ids};
}

export default {async fetch(request,env){
  try{await schema(env);const u=new URL(request.url);if(u.pathname==='/healthz')return json({ok:true,service:'meta-fleet-dispatch',persistence:'cloudflare-d1',time:now()});
    if(u.pathname.startsWith('/api/')){
      const user=accessContext(request,env);
      if(request.method==='GET'&&u.pathname==='/api/bootstrap') return json(await bootstrap(env,user));
      if(request.method==='GET'&&u.pathname==='/api/map/status') return json(await mapStatus(env));
      if(request.method==='GET'&&u.pathname==='/api/map/diagnostics'){requireAdmin(user);return json(await mapDiagnostics(env));}
      if(request.method==='POST'&&u.pathname==='/api/import/workbook'){requireAdmin(user);return json(await importWorkbook(env,user.email,await request.json()));}
      if(request.method==='POST'&&u.pathname==='/api/map/config'){requireAdmin(user);return json(await saveMapConfig(env,await request.json()));}
      if(request.method==='POST'&&u.pathname==='/api/map/geocode-step'){requireAdmin(user);return json(await geocodeStep(env));}
      if(request.method==='POST'&&u.pathname==='/api/dispatch/map/start'){requireAdmin(user);return json(await startMapProposal(env,user.email));}
      if(request.method==='POST'&&u.pathname==='/api/dispatch/map/step'){requireAdmin(user);const p=await request.json();return json(await stepMapProposal(env,Number(p.runId)));}
      if(request.method==='POST'&&u.pathname==='/api/dispatch/proposals'){requireAdmin(user);return json(await propose(env,user.email));}
      if(request.method==='POST'&&u.pathname==='/api/assignments'){requireAdmin(user);return json(await manualAssign(env,user.email,await request.json()));}
      return json({error:'NOT_FOUND'},404);
    }
    return env.ASSETS.fetch(request);
  }catch(e){return json({error:e.message||'INTERNAL_ERROR'},e.status||500);}
}};
