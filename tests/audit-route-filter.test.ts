import {Router} from 'express';
import {expect,it,vi} from 'vitest';
import {formatAcademyDate} from '../client/src/lib/localeFormat';
const mocks=vi.hoisted(()=>({query:vi.fn()}));
vi.mock('../server/modules/academy/academy-core',async()=>{
 const {readFileSync}=await import('node:fs');
 const source=readFileSync('server/modules/academy/academy-core.ts','utf8');
 const extract=(name:string)=>source.match(new RegExp('export const '+name+' = ([\\s\\S]*?\\n});'))![1].replace('(value: unknown)','(value)');
 const nullableText=new Function('return '+extract('nullableText'))();
 const nullableDate=new Function('nullableText','return '+extract('nullableDate'))(nullableText);
 return {ACADEMY_TIME_ZONE:'Asia/Tashkent',query:mocks.query,nullableText,nullableDate,parseId:(v:unknown)=>Number(v)||null,ensureAdministrationModuleAccess:()=>true};
});
vi.mock('../server/modules/academy/academy-analytics',()=>({}));
vi.mock('../server/modules/academy/academy-scheduling',async()=>{const {zonedWallClockToInstant}=await import('../server/lib/academy-time');return {parseDateOnly:(value:unknown)=>{const match=String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);return match?zonedWallClockToInstant({year:Number(match[1]),month:Number(match[2]),day:Number(match[3])},'Asia/Tashkent'):null;}};});
vi.mock('../server/modules/academy/meta-marketing-analytics',()=>({}));
vi.mock('../server/modules/academy/sales-dashboard-metrics',()=>({}));
vi.mock('../server/services/meta-marketing',()=>({}));
vi.mock('../server/lib/logger',()=>({logger:{error:vi.fn()}}));
import {registerAcademyModuleRoutes} from '../server/modules/academy/module.router';
const audit=async(query:any)=>{
 mocks.query.mockClear();mocks.query.mockResolvedValue([]);
 const router=Router();registerAcademyModuleRoutes(router);
 const route=router.stack.find((layer:any)=>layer.route?.path==='/audit')!.route!;
 const json=vi.fn(),status=vi.fn().mockReturnThis();
 await route.stack[0].handle({query,user:{id:7,module:'administration',modules:['administration']}} as any,{json,status} as any,vi.fn());
 expect(status).not.toHaveBeenCalled();return mocks.query.mock.calls.find(([sql]:any)=>sql.includes('SELECT a.*'))!;
};
it('audit date filtering uses academy day boundaries',async()=>{
 const [sql,params]=await audit({from:'2026-10-08',to:'2026-10-08'});
 expect(sql).toContain('a.created_at >= $1');expect(sql).toContain('a.created_at < $2');
 expect(params[0].toISOString()).toBe('2026-10-07T19:00:00.000Z');
 expect(params[1].toISOString()).toBe('2026-10-08T19:00:00.000Z');
 const shownAsOct8=new Date('2026-10-07T20:00:00.000Z');
 expect(formatAcademyDate(shownAsOct8,'en',{year:'numeric',month:'2-digit',day:'2-digit'})).toBe('10/08/2026');
 expect(shownAsOct8>=params[0] && shownAsOct8<params[1]).toBe(true);
 const shownAsOct9=new Date('2026-10-08T20:00:00.000Z');
 expect(formatAcademyDate(shownAsOct9,'en',{year:'numeric',month:'2-digit',day:'2-digit'})).toBe('10/09/2026');
 expect(shownAsOct9>=params[0] && shownAsOct9<params[1]).toBe(false);
});
it('archive filter excludes restoration actions',async()=>{
 const [_sql,params]=await audit({action:'ARCHIVE'});
 expect(params[0]).toBe('(^|_)ARCHIVE(_|$)');
 const selectedPredicate=new RegExp(String(params[0]),'i');
 expect(selectedPredicate.test('ARCHIVE_ACADEMY_GROUP')).toBe(true);
 expect(selectedPredicate.test('BULK_ARCHIVE_ACADEMY_LEAD')).toBe(true);
 expect(selectedPredicate.test('UNARCHIVE_ACADEMY_GROUP')).toBe(false);
});
