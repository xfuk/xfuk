import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EvaluationLog, EventKind, csvCell } from '../src/core/evalLog.js';

function clock(start = 1000) {
  let t = start;
  return { now: () => t, tick: (ms) => (t += ms) };
}

test('通知から修正までの時間を計算する', () => {
  const c = clock();
  const log = new EvaluationLog({ now: c.now, participant: 'P01', condition: 'earcon' });
  log.log(EventKind.DETECTED, { key: 'k1', type: 'spelling', text: 'teh' });
  c.tick(200);
  log.log(EventKind.NOTIFIED, { key: 'k1', type: 'spelling', text: 'teh' });
  c.tick(3000);
  log.log(EventKind.RESOLVED, { key: 'k1', type: 'spelling', text: 'teh' });
  log.log(EventKind.DETECTED, { key: 'k2', type: 'grammar', text: 'a apple' });
  const per = log.perError();
  assert.equal(per.length, 2);
  assert.equal(per[0].timeToFixFromNotifyMs, 3000);
  assert.equal(per[0].timeToFixFromDetectMs, 3200);
  assert.equal(per[1].resolvedAt, undefined);
  const s = log.summary();
  assert.equal(s.detected, 2);
  assert.equal(s.resolved, 1);
  assert.equal(s.unresolved, 1);
  assert.equal(s.meanTimeToFixMs, 3000);
  assert.equal(s.medianTimeToFixMs, 3000);
  assert.equal(s.participant, 'P01');
});

test('CSV 出力はヘッダとエスケープを含む', () => {
  const log = new EvaluationLog({ now: () => 0, participant: 'P', condition: 'C' });
  log.log(EventKind.NOTE, { detail: 'has "quote", comma' });
  const csv = log.toCSV();
  const lines = csv.trim().split('\r\n');
  assert.equal(lines[0], 't,iso,participant,condition,kind,key,type,text,paragraphIndex,detail');
  assert.ok(lines[1].endsWith('"has ""quote"", comma"'));
  assert.ok(log.perErrorCSV().startsWith('participant,condition,key'));
});

test('csvCell', () => {
  assert.equal(csvCell(undefined), '');
  assert.equal(csvCell('a'), 'a');
  assert.equal(csvCell('a,b'), '"a,b"');
});

test('summary で時間が無い場合は null', () => {
  const log = new EvaluationLog();
  assert.equal(log.summary().meanTimeToFixMs, null);
});
