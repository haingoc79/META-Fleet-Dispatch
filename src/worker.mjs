import { buildAdvancedShadowPlan } from './shadow-dispatch-v2.mjs';
import { POLICY, buildPlanningVehicles } from './planning.mjs';

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
      if(request.method==='POST'&&u.pathname==='/api/import/workbook'){requireAdmin(user);return json(await importWorkbook(env,user.email,await request.json()));}
      if(request.method==='POST'&&u.pathname==='/api/dispatch/proposals'){requireAdmin(user);return json(await propose(env,user.email));}
      if(request.method==='POST'&&u.pathname==='/api/assignments'){requireAdmin(user);return json(await manualAssign(env,user.email,await request.json()));}
      return json({error:'NOT_FOUND'},404);
    }
    return env.ASSETS.fetch(request);
  }catch(e){return json({error:e.message||'INTERNAL_ERROR'},e.status||500);}
}};
