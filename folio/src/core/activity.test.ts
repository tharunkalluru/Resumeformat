import { describe, expect, it } from 'vitest';
import { activitySummary, dayRange, localDay, mergeActivity } from './activity';
import type { PrivateProfile } from './activity';
import { completedTailoring, setPresentation } from './folio';
import { approveTemplate } from './commands';
import { createApplication } from './applications';
import { fixtureProject } from './testFixture';

const profile:PrivateProfile={name:'',headline:'',timeZone:'America/Los_Angeles',countingSince:'2026-09-30T00:00:00.000Z',events:[]};
describe('private successful-tailoring activity',()=>{
  it('counts receipts once across backup copies, keeps removed history, and excludes future timestamps',async()=>{
    const app=setPresentation(await createApplication(await approveTemplate(await fixtureProject(),[]),{title:'Engineer',company:'Fixture',description:'React dashboards'}),{historyKnown:true});
    const ready=completedTailoring(app,'receipt','2026-10-01T00:30:00.000Z'),copy={...structuredClone(ready),id:'backup-copy'};
    const events=mergeActivity([ready,copy]);expect(events).toHaveLength(1);
    expect(activitySummary([ready,copy],profile,new Date('2026-10-07T12:00:00Z'))).toMatchObject({allTime:1,month:0,jobs:1});
    expect(activitySummary([],{...profile,events},new Date('2026-10-07T12:00:00Z')).allTime).toBe(1);
    expect(activitySummary([ready],profile,new Date('2026-09-30T00:00:00Z')).allTime).toBe(0);
    expect(activitySummary([app],profile,new Date('2026-10-07T12:00:00Z')).allTime).toBe(0);
  });
  it('distinguishes known zero from legacy unknown and preserves the unknown flag after deletion',async()=>{
    const legacy=await createApplication(await approveTemplate(await fixtureProject(),[]));
    expect(activitySummary([],profile).allTime).toBe(0);
    expect(activitySummary([legacy],profile).allTime).toBeNull();
    expect(activitySummary([],{...profile,historyUnavailable:true}).allTime).toBeNull();
  });
  it('uses civil dates through DST and never generates future heatmap cells',()=>{
    expect(localDay('2026-11-01T08:30:00Z','America/Los_Angeles')).toBe('2026-11-01');
    expect(localDay('2026-11-01T09:30:00Z','America/Los_Angeles')).toBe('2026-11-01');
    expect(localDay('2026-10-01T00:30:00Z','America/Los_Angeles')).toBe('2026-09-30');
    const days=dayRange('2026-10-07',26);expect(days.at(-1)).toBe('2026-10-07');expect(new Set(days).size).toBe(days.length);
    expect(dayRange('2026-10-07',8,8).every(day=>day<'2026-10-07')).toBe(true);
  });
});
