import test from 'node:test';
import assert from 'node:assert/strict';
import {regions,riskIndex,category} from '../public/src/model.js';
test('Increasing saturation cannot decrease scenario risk across supported regions',()=>{for(const r of regions){let last=-1;for(let soil=0;soil<=100;soil++){const value=riskIndex({...r,soil});assert.ok(value>=last);last=value;}}});
test('Rain and saturation remain bounded even at extreme inputs',()=>{for(const rain of [-100,0,60,120,1000])for(const soil of [-100,0,100,1000]){const score=riskIndex({...regions[0],rain,soil});assert.ok(score>=0&&score<=100);}});
test('Dry scenario remains distinct from cloudburst',()=>{const r=regions[0];assert.ok(riskIndex({...r,rain:100,soil:96})>riskIndex({...r,rain:8,soil:20}));});
test('Display categories respect threshold boundaries',()=>{assert.equal(category(39),'Below watch');assert.equal(category(40),'Watch');assert.equal(category(64),'Watch');assert.equal(category(65),'High');});
test('Demonstration inputs no longer carry synthetic population or geometry',()=>{for(const r of regions){assert.equal(r.pop,null);assert.equal('footprint' in r,false);}});
