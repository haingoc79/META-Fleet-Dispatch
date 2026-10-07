const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const money=n=>new Intl.NumberFormat('vi-VN',{style:'currency',currency:'VND',maximumFractionDigits:0}).format(Number(n||0));
const num=n=>new Intl.NumberFormat('vi-VN',{maximumFractionDigits:1}).format(Number(n||0));
const time=x=>x?new Date(x).toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit'}):'-';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const todayVN=()=>new Date(Date.now()+7*3600000).toISOString().slice(0,10);
let state={orders:[],drivers:[],latestRun:null,currentUser:null,mapStatus:null};

async function api(url,opt={}){
  const r=await fetch(url,{headers:{'content-type':'application/json',...(opt.headers||{})},...opt});
  const ct=r.headers.get('content-type')||'';
  if(!ct.includes('application/json'))throw new Error('Phiên đăng nhập Access đã hết hoặc phản hồi không hợp lệ.');
  const x=await r.json();if(!r.ok)throw new Error(x.error||`HTTP ${r.status}`);return x;
}
function setTab(name){
  $$('nav button').forEach(x=>x.classList.toggle('active',x.dataset.tab===name));
  $$('.tab').forEach(x=>x.classList.toggle('active',x.id===name));
  if(name==='plan')renderPlan();if(name==='map')renderMap();
}
function planMap(){const m=new Map();for(const p of state.latestRun?.proposals||[])m.set(Number(p.order_id),p);return m;}
function driverMap(){return new Map(state.drivers.map(d=>[Number(d.id),d]));}
function kpi(label,value){return `<div class="kpi"><span>${esc(label)}</span><b>${esc(value)}</b></div>`;}
function productNames(o){return (o?.products||[]).map(p=>String(p.model_name||'').trim()).filter(Boolean);}
function productText(o){return productNames(o).join(' · ');}
function productHtml(o,max=2){
  const names=productNames(o);if(!names.length)return '<span class="muted">Chưa có tên SP</span>';
  const head=names.slice(0,max).map(esc).join('<br>'),more=names.length>max?`<div class="more">+${names.length-max} sản phẩm khác</div>`:'';
  return head+more;
}
function filteredOrders(){
  const q=$('#q').value.trim().toLowerCase(),b=$('#branch').value;
  return state.orders.filter(o=>(!b||o.branch===b)&&(!q||String(o.id).includes(q)||String(o.full_address||'').toLowerCase().includes(q)||String(o.district||'').toLowerCase().includes(q)||productText(o).toLowerCase().includes(q)));
}
function renderOrders(){
  const pmap=planMap(),dmap=driverMap(),orders=filteredOrders(),review=state.orders.filter(o=>o.suggested_vehicle_type==='Cần rà soát').length,cod=state.orders.reduce((s,o)=>s+Number(o.cod_amount_due_vnd||0),0);
  $('#kpis').innerHTML=[kpi('Tổng đơn',state.orders.length),kpi('HCM',state.orders.filter(o=>o.branch==='HCM').length),kpi('Hà Nội',state.orders.filter(o=>o.branch==='Hà Nội').length),kpi('COD phải thu',money(cod)),kpi('Cần rà soát',review),kpi('Đã có proposal',pmap.size)].join('');
  $('#ordersBody').innerHTML=orders.map(o=>{const p=pmap.get(Number(o.id)),d=p?dmap.get(Number(p.driver_id)):null;return `<tr>
    <td><span class="link" data-id="${o.id}">${o.id}</span></td><td>${esc(o.branch)}</td><td>${esc(o.district||'-')}</td><td>${esc(o.full_address)}</td>
    <td class="productcell">${productHtml(o)}</td><td>${o.total_weight_kg==null?'?':num(o.total_weight_kg)}</td><td>${money(o.cod_amount_due_vnd)}</td>
    <td><span class="badge ${o.suggested_vehicle_type==='Cần rà soát'?'warn':''}">${esc(o.suggested_vehicle_type)}</span></td><td>${esc(d?.full_name||'-')}</td><td>${p?`${esc(p.route_id)} / #${p.sequence_no}`:'-'}</td>
  </tr>`}).join('');
  $$('[data-id]').forEach(x=>x.onclick=()=>showDetail(Number(x.dataset.id)));
}
function planGroups(){
  const dmap=driverMap(),omap=new Map(state.orders.map(o=>[Number(o.id),o])),groups=new Map();
  for(const p of state.latestRun?.proposals||[]){
    const id=Number(p.driver_id),d=dmap.get(id)||{id,full_name:`Driver ${id}`,branch:'-',group_name:'-'};
    if(!groups.has(id))groups.set(id,{driver:d,rows:[],trips:new Map(),cod:0,kg:0});
    const g=groups.get(id),o=omap.get(Number(p.order_id));g.rows.push({p,o});g.cod+=Number(o?.cod_amount_due_vnd||0);g.kg+=Number(o?.total_weight_kg||0);
    if(!g.trips.has(p.route_id))g.trips.set(p.route_id,[]);g.trips.get(p.route_id).push({p,o});
  }
  return [...groups.values()];
}
function parseScope(){try{return JSON.parse(state.latestRun?.scope_json||'{}')}catch{return {}}}
function renderPlan(){
  const groups=planGroups(),run=state.latestRun,assigned=run?.proposals?.length||0,totalCod=groups.reduce((s,g)=>s+g.cod,0),trips=groups.reduce((s,g)=>s+g.trips.size,0),isMap=run?.algorithm_version==='shadow_map_google_routes_v1';
  $('#planSource').className=isMap?'sourcesafe':'sourcewarn';
  $('#planSource').textContent=isMap?'Map-aware: spatial clustering + Google Routes road-time matrix. Shadow proposal, chưa tự commit assignment.':'Heuristic cũ – chưa dùng bản đồ thật. Chỉ dùng để đối chiếu, không nên coi là tuyến vận hành tối ưu.';
  $('#planSummary').innerHTML=[kpi('Run',run?.id||'-'),kpi('Nguồn tuyến',isMap?'Google Routes':'Heuristic'),kpi('Đơn được phân',assigned),kpi('Chuyến',trips),kpi('Nhân sự có đơn',groups.length),kpi('COD theo proposal',money(totalCod))].join('');
  $('#driverPlans').innerHTML=groups.sort((a,b)=>b.rows.length-a.rows.length).map(g=>`<div class="card drivercard">
    <div class="driverhead"><div><b>${esc(g.driver.full_name)}</b><div class="muted">${esc(g.driver.branch)} · ${esc(g.driver.group_name)}</div></div><span class="badge">${g.rows.length} đơn</span></div>
    <div class="metrics"><span class="metric">Chuyến <b>${g.trips.size}</b></span><span class="metric">COD <b>${money(g.cod)}</b></span><span class="metric">Khối lượng <b>${num(g.kg)} kg</b></span></div>
    ${[...g.trips.entries()].map(([rid,rows])=>{rows.sort((a,b)=>a.p.sequence_no-b.p.sequence_no);const first=rows[0]?.p?.score||{};const routeInfo=isMap&&first.distance_km!=null?` · ${num(first.distance_km)} km · ${first.travel_minutes||'-'} phút chạy`:'';return `<div class="trip"><b>${esc(rid)}</b> · ${rows.length} đơn${routeInfo} · kết thúc ${time(rows.at(-1)?.p.planned_departure)}
      <div class="stops">${rows.map(x=>{const s=x.p.score||{},leg=isMap&&s.leg_km!=null?`<br><span class="muted">Chặng: ${num(s.leg_km)} km · ${s.leg_minutes||0} phút</span>`:'';return `<div class="stop"><b>#${x.p.sequence_no} · ${x.o?.id}</b><br>${esc(x.o?.district||'')}<br><strong>${productHtml(x.o,1)}</strong><br>ETA ${time(x.p.planned_arrival)} · ${money(x.o?.cod_amount_due_vnd)}${leg}</div>`}).join('')}</div>
    </div>`}).join('')}
  </div>`).join('');
  const proposed=new Set((run?.proposals||[]).map(p=>Number(p.order_id))),scope=parseScope(),blocked=[...(scope.blocked||[]),...(scope.unassigned||[])];
  const reviewMissing=state.orders.filter(o=>o.suggested_vehicle_type==='Cần rà soát'&&!proposed.has(Number(o.id))).map(o=>({orderId:o.id,reasons:['ORDER_DATA_REVIEW']}));
  const all=[...blocked,...reviewMissing],seen=new Set(),unique=all.filter(x=>{const id=Number(x.orderId);if(seen.has(id))return false;seen.add(id);return true;});
  $('#unassigned').innerHTML=`<div class="drivercard"><b>Chưa phân / cần rà soát: ${unique.length}</b><div class="muted">${unique.slice(0,60).map(x=>`${x.orderId}: ${(x.reasons||[]).join('/')}`).join('<br>')}${unique.length>60?'<br>…':''}</div></div>`;
}
function renderDrivers(){
  const groups=planGroups(),gm=new Map(groups.map(g=>[Number(g.driver.id),g]));
  $('#driversBody').innerHTML=state.drivers.map(d=>{const g=gm.get(Number(d.id));return `<tr><td>${esc(d.full_name)}</td><td>${esc(d.branch)}</td><td>${esc(d.group_name)}</td><td>${g?.rows.length||0}</td><td>${g?.trips.size||0}</td><td>${money(g?.cod||0)}</td><td>${num(g?.kg||0)}</td></tr>`}).join('');
}
function showDetail(id){
  const o=state.orders.find(x=>Number(x.id)===id),p=planMap().get(id),d=p?driverMap().get(Number(p.driver_id)):null;if(!o)return;
  $('#detailContent').innerHTML=`<h2>Đơn ${o.id}</h2><p><b>${esc(o.full_address)}</b></p><p>${esc(o.branch)} · ${esc(o.district)} · ${esc(o.ward)}</p><p>COD: <b>${money(o.cod_amount_due_vnd)}</b> · ${esc(o.cod_status)}</p><p>Đề xuất xe: <b>${esc(o.suggested_vehicle_type)}</b> — ${esc(o.suggestion_reason)}</p><p>Dữ liệu: ${esc((o.quality_flags||[]).join(', ')||'OK')}</p><p>Proposal: ${d?`${esc(d.full_name)} · ${esc(p.route_id)} · stop ${p.sequence_no} · ETA ${time(p.planned_arrival)}`:'chưa có'}</p><h3>Sản phẩm</h3>${(o.products||[]).map(x=>`<div>${esc(x.model_name)} · ${x.weight_kg??'?'} kg · ${money(x.unit_cost_vnd)}</div>`).join('')}`;
  $('#detail').showModal();
}
function applyRoleUi(){
  const canWrite=state.currentUser?.canWrite===true;
  $('#proposal').style.display=canWrite?'':'none';$('#refreshPlan').style.display=canWrite?'':'none';
  const importTab=document.querySelector('[data-tab="import"]');if(importTab)importTab.style.display=canWrite?'':'none';
  for(const id of ['saveDepots','geocodeBtn','retryQuotaBtn','mapProposalBtn']){const el=$('#'+id);if(el)el.style.display=canWrite?'':'none';}
  $('#mode').textContent=state.currentUser?`${state.currentUser.email} · ${state.currentUser.role==='admin'?'Admin/Dispatcher':'Viewer'}`:'D1 online';
}
function renderMap(){
  const s=state.mapStatus||{depots:[]},depots=s.depots||[],hcm=depots.find(x=>x.branch==='HCM'),hn=depots.find(x=>x.branch==='Hà Nội');
  if(document.activeElement!==$('#hcmDepot'))$('#hcmDepot').value=hcm?.address||'';
  if(document.activeElement!==$('#hnDepot'))$('#hnDepot').value=hn?.address||'';
  const depReady=depots.filter(x=>x.geocoded).length;
  $('#mapStatus').innerHTML=[kpi('Google API',s.apiConfigured?'Đã cấu hình':'Thiếu key'),kpi('Depot geocode',`${depReady}/2`),kpi('Đơn geocode',`${s.geocodedOrders||0}/${s.eligibleOrders||0}`),kpi('Quota blocked',s.quotaBlockedOrders||0),kpi('Lỗi địa chỉ khác',Math.max(0,(s.failedOrders||0)-(s.quotaBlockedOrders||0))),kpi('Route-ready',s.routeReady?'Có':'Chưa')].join('');
  $('#mapBadge').textContent=s.routeReady?'Sẵn sàng tối ưu':'Chưa sẵn sàng';$('#mapBadge').className='badge '+(s.routeReady?'good':'warn');
  if(!s.apiConfigured)$('#mapProgress').textContent='Thiếu Cloudflare Secret GOOGLE_MAPS_API_KEY. Code đã sẵn sàng nhưng chưa gọi dữ liệu bản đồ.';
  else if((s.quotaBlockedOrders||0)>0)$('#mapProgress').textContent=`Google Geocoding đang bị daily quota: ${s.quotaBlockedOrders} đơn bị block. Tăng quota rồi bấm Retry đơn bị quota.`;
}
async function refreshMap(){state.mapStatus=await api('/api/map/status');renderMap();return state.mapStatus;}
async function refresh(){
  const [boot,map]=await Promise.all([api('/api/bootstrap'),api('/api/map/status')]);state={...boot,mapStatus:map};
  renderOrders();renderPlan();renderDrivers();renderMap();applyRoleUi();
}
async function saveDepots(){
  if(!state.currentUser?.canWrite)return;
  const hcmDepot=$('#hcmDepot').value.trim(),hnDepot=$('#hnDepot').value.trim();if(!hcmDepot||!hnDepot)return alert('Cần nhập chính xác cả điểm xuất phát HCM và Hà Nội.');
  try{$('#saveDepots').disabled=true;await api('/api/map/config',{method:'POST',body:JSON.stringify({hcmDepot,hnDepot})});$('#mapProgress').textContent='Đã lưu depot. Tiếp theo: Chuẩn hóa địa chỉ.';await refreshMap();}catch(e){alert(e.message)}finally{$('#saveDepots').disabled=false;}
}
async function retryQuota(){
  if(!state.currentUser?.canWrite)return;
  try{
    $('#retryQuotaBtn').disabled=true;
    const before=await refreshMap();
    if(!(before.quotaBlockedOrders>0))return alert('Không còn đơn nào bị quota.');
    const reset=await api('/api/map/retry-quota',{method:'POST',body:'{}'});
    $('#mapProgress').textContent=`Đã reset ${reset.reset} đơn bị quota. Đang geocode lại…`;
    await geocodeAll();
  }catch(e){$('#mapProgress').textContent='Retry quota lỗi: '+e.message;}finally{$('#retryQuotaBtn').disabled=false;}
}

async function geocodeAll(){
  if(!state.currentUser?.canWrite)return;try{
    $('#geocodeBtn').disabled=true;let loops=0,s=await refreshMap();if(!s.apiConfigured)throw new Error('MAPS_API_KEY_MISSING');
    while(loops++<80){
      const left=(s.eligibleOrders||0)-(s.geocodedOrders||0)-(s.failedOrders||0);if(left<=0)break;
      $('#mapProgress').textContent=`Đang geocode: ${s.geocodedOrders||0}/${s.eligibleOrders||0}; còn ${left}; lỗi ${s.failedOrders||0}.`;
      const r=await api('/api/map/geocode-step',{method:'POST',body:'{}'});s=r.status;
      if(!r.processed)break;
    }
    state.mapStatus=s;renderMap();$('#mapProgress').textContent=`Geocode hoàn tất: ${s.geocodedOrders}/${s.eligibleOrders}; lỗi ${s.failedOrders}. ${s.routeReady?'Có thể tối ưu theo bản đồ.':'Kiểm tra API/depot/các địa chỉ lỗi.'}`;
  }catch(e){$('#mapProgress').textContent='Lỗi geocode: '+e.message;}finally{$('#geocodeBtn').disabled=false;}
}
async function runMapProposal(){
  if(!state.currentUser?.canWrite)return alert('Tài khoản Viewer chỉ được xem.');
  try{
    $('#proposal').disabled=$('#refreshPlan').disabled=$('#mapProposalBtn').disabled=true;
    const ms=await refreshMap();if(!ms.routeReady){setTab('map');throw new Error('MAP_NOT_READY: cần Google API key, 2 depot và hoàn tất geocode trước.');}
    const start=await api('/api/dispatch/map/start',{method:'POST',body:'{}'});let loops=0,r={pending:start.jobs,done:0,errors:0};
    $('#mapProgress').textContent=`Đã tạo ${start.jobs} route jobs. Bắt đầu Google Routes matrix…`;
    while(r.pending>0&&loops++<80){
      r=await api('/api/dispatch/map/step',{method:'POST',body:JSON.stringify({runId:start.runId})});
      $('#mapProgress').textContent=`Run ${start.runId}: done ${r.done}, pending ${r.pending}, errors ${r.errors}.`;
    }
    await refresh();setTab('plan');
    if(r.errors)alert(`Map run hoàn tất với ${r.errors} route lỗi. Các route này được giữ ở trạng thái review.`);
  }catch(e){alert(e.message)}finally{$('#proposal').disabled=$('#refreshPlan').disabled=$('#mapProposalBtn').disabled=false;}
}
async function runProposal(){const s=await refreshMap();if(!s.routeReady){setTab('map');return alert('Cần hoàn tất cấu hình Bản đồ & tuyến trước khi chạy phân đơn.');}return runMapProposal();}
async function upload(){
  if(!state.currentUser?.canWrite)return alert('Tài khoản Viewer chỉ được xem.');
  const f=$('#file').files[0];if(!f)return alert('Chọn file Excel');if(!window.XLSX)return alert('Thư viện XLSX chưa tải');
  try{$('#upload').disabled=true;const wb=XLSX.read(await f.arrayBuffer(),{type:'array',cellDates:true});const sheet=n=>XLSX.utils.sheet_to_json(wb.Sheets[n],{header:1,raw:true,defval:null});const payload={serviceDate:todayVN(),orders:sheet('Đơn'),products:sheet('Sản phẩm'),drivers:sheet('Giao Hàng')};const r=await api('/api/import/workbook',{method:'POST',body:JSON.stringify(payload)});$('#importResult').textContent=JSON.stringify(r,null,2);await refresh();}catch(e){$('#importResult').textContent=e.stack||e.message}finally{$('#upload').disabled=false;}
}

$$('nav button').forEach(b=>b.onclick=()=>setTab(b.dataset.tab));
$('#q').oninput=renderOrders;$('#branch').onchange=renderOrders;$('#proposal').onclick=runProposal;$('#refreshPlan').onclick=runProposal;$('#upload').onclick=upload;
$('#saveDepots').onclick=saveDepots;$('#geocodeBtn').onclick=geocodeAll;$('#retryQuotaBtn').onclick=retryQuota;$('#mapProposalBtn').onclick=runMapProposal;$('.close').onclick=()=>$('#detail').close();
refresh().catch(e=>{$('#mode').textContent='Chưa sẵn sàng';document.body.insertAdjacentHTML('afterbegin',`<div style="padding:10px;background:#fff0d6;color:#7a4c00">${esc(e.message)}</div>`)});
