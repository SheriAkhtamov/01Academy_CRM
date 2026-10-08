import {expect,it} from 'vitest';
import {auditValue} from '../client/src/lib/auditPresentation';
import {i18n} from '../client/src/lib/i18n';
it('resolves teacher PK independently of employee PK',()=>{
 i18n.setLanguage('en');
 // academy_teachers.id=3 -> user_id=27. users.id=3 is the admin.
 const teachers=[{id:3,fullName:'Actual assigned teacher'}];
 const employees=[{id:3,fullName:'Unrelated administrator'},{id:27,fullName:'Actual assigned teacher'}];
 expect(auditValue('teacher_id',3,{t:i18n.t.bind(i18n),language:'en',entity:'academy_groups',employees,teachers})).toBe('Actual assigned teacher');
 expect(auditValue('teacher_user_id',27,{t:i18n.t.bind(i18n),language:'en',entity:'academy_groups',employees,teachers})).toBe('Actual assigned teacher');
});
it('uses the saved arbitrary stage label even when its code was a legacy business code',()=>{
 i18n.setLanguage('en');
 expect(auditValue('status_code','paid',{t:i18n.t.bind(i18n),language:'en',entity:'academy_leads',employees:[],statuses:[{code:'paid',name:'Waiting for a reply'}]})).toBe('Waiting for a reply');
});
