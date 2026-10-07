import assert from 'node:assert/strict';
import { POLICY } from '../src/planning.mjs';
import { buildSpatialRouteJobs, optimizeMatrixSequence, routeMetrics, haversineKm } from '../src/map-routing.mjs';

const policy=structuredClone(POLICY);
policy.fleet_counts={HCM:{motorbike:1,auto:0}};
const orders=[
  {id:1,branch:'HCM',service_date:'2026-10-07',suggested_vehicle_type:'Xe máy',total_weight_kg:2,assigned_driver_id:null,execution_state:'at_depot'},
  {id:2,branch:'HCM',service_date:'2026-10-07',suggested_vehicle_type:'Xe máy',total_weight_kg:2,assigned_driver_id:null,execution_state:'at_depot'}
];
const drivers=[{id:10,branch:'HCM',group_name:'Xe máy',full_name:'Test Rider'}];
const depot={lat:10.77,lng:106.69,placeId:'DEPOT'};
const geocodes=new Map([[1,{lat:10.80,lng:106.72,placeId:'A'}],[2,{lat:13.50,lng:106.70,placeId:'B'}]]);
const plan=buildSpatialRouteJobs({orders,drivers,policy,geocodes,depots:new Map([['HCM',depot]])});
assert.equal(plan.jobs.length,1);
assert.deepEqual(plan.jobs[0].orders.map(o=>o.id),[1]);
assert.equal(plan.blocked.length,1);
assert.equal(plan.blocked[0].orderId,2);
assert.match(plan.blocked[0].reasons[0],/^MAP_OUTLIER_/);
assert.ok(haversineKm(depot,geocodes.get(2))>60);

const matrix={
  dur:[[0,10,50,60],[10,0,10,50],[50,10,0,10],[60,50,10,0]],
  dist:[[0,1000,5000,6000],[1000,0,1000,5000],[5000,1000,0,1000],[6000,5000,1000,0]]
};
const seq=optimizeMatrixSequence(matrix);
assert.deepEqual(seq,[1,2,3]);
const metrics=routeMetrics({seq,matrix,startAt:'2026-10-07T01:00:00.000Z',serviceMinutes:5});
assert.equal(metrics.stops.length,3);
assert.equal(metrics.distanceKm,9);
assert.equal(metrics.travelMinutes,2);
console.log('map-routing: PASS', {jobs:plan.jobs.length,blocked:plan.blocked.length,seq,km:metrics.distanceKm});
