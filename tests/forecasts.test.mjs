import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeForecast} from '../lib/forecasts.mjs';
const time=Array.from({length:24},(_,i)=>`2026-09-12T${String(i).padStart(2,'0')}:00`);
const now=Date.parse('2026-09-11T23:30:00+05:30');
test('ensemble total interval uses member totals, not a sum of hourly percentiles',()=>{
  const result=summarizeForecast({hourly:{time,a:Array.from({length:24},(_,i)=>i%2?0:2),b:Array.from({length:24},(_,i)=>i%2?2:0)}},['a','b'],now);
  assert.equal(result.totalMm,24);assert.deepEqual(result.interval,{p10:24,p90:24});
});
test('missing precipitation cannot become zero rain or a complete 24-hour total',()=>{
  const values=Array(24).fill(1);values[8]=null;
  const result=summarizeForecast({hourly:{time,a:values}},['a'],now);
  assert.equal(result.totalMm,null);assert.equal(result.availableHours,23);assert.equal(result.series[8].precipitationMm,null);
});
test('a truncated forecast is not reported as a full 24-hour accumulation',()=>{
  const result=summarizeForecast({hourly:{time:time.slice(0,12),a:Array(12).fill(2)}},['a'],now);
  assert.equal(result.totalMm,null);assert.equal(result.availableHours,12);
});
test('comparison selects future intervals using the requested India time zone',()=>{
  const result=summarizeForecast({hourly:{time,a:Array(24).fill(1)}},['a'],Date.parse('2026-09-12T06:15:00+05:30'));
  assert.equal(result.series[0].time,'2026-09-12T07:00+05:30');
});
