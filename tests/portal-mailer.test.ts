import {afterEach,describe,expect,it,vi} from 'vitest';
import type {AppConfig} from '../server/config';
import {PortalMailer} from '../server/infrastructure/portal-mailer';
const mocks=vi.hoisted(()=>({resendSend:vi.fn(),smtpSend:vi.fn(),smtpClose:vi.fn(),smtpCreate:vi.fn()}));
vi.mock('resend',()=>({Resend:class {emails={send:mocks.resendSend};}}));
vi.mock('nodemailer',()=>({default:{createTransport:mocks.smtpCreate}}));
const config=(smtp=false)=>({server:{environment:'production',appUrl:'https://academy.example'},email:{resendApiKey:'fixture-only-key',smtp:{from:'school@example.invalid',...(smtp?{host:'smtp.example.invalid',port:587,user:'fixture',pass:'fixture-only-password'}:{})}}} as AppConfig);
const delivery={recipient:'person@example.invalid',locale:'en' as const,text:'A teacher replied <script>&',href:'/learn/help?thread=12&linkId=34',deliveryKey:'notification:one'};
afterEach(()=>{vi.clearAllMocks();vi.useRealTimers();});
describe('Portal mail delivery has bounded requests and stable provider identities',()=>{
  it('escapes user text, supplies plain text and deduplicates only the same delivery key',async()=>{
    mocks.resendSend.mockResolvedValue({data:{id:'mail-one'},error:null});
    const mailer=new PortalMailer(config());
    expect(await mailer.notification(delivery)).toBe(true);expect(await mailer.notification(delivery)).toBe(true);
    expect(await mailer.notification({...delivery,deliveryKey:'notification:two'})).toBe(true);
    const [payload,first]=mocks.resendSend.mock.calls[0];
    expect(payload.html).toContain('&lt;script&gt;&amp;');expect(payload.html).not.toContain('<script>');expect(payload.text).toContain(delivery.text);
    expect(payload.html).toContain('thread=12&amp;linkId=34');
    expect(first.idempotencyKey).toBe(mocks.resendSend.mock.calls[1][1].idempotencyKey);
    expect(first.idempotencyKey).not.toBe(mocks.resendSend.mock.calls[2][1].idempotencyKey);expect(first.idempotencyKey).not.toContain('notification:one');
    mailer.close();
  });
  it('rejects external action links without contacting a provider',async()=>{
    const mailer=new PortalMailer(config());expect(await mailer.notification({...delivery,href:'https://other.example/learn'})).toBe(false);
    expect(mocks.resendSend).not.toHaveBeenCalled();mailer.close();
  });
  it('aborts a stalled provider request after 25 seconds instead of holding shutdown indefinitely',async()=>{
    vi.useFakeTimers();mocks.resendSend.mockImplementation((_payload,options)=>new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('Fixture aborted')),{once:true})));
    const mailer=new PortalMailer(config()),pending=mailer.notification(delivery);
    await vi.advanceTimersByTimeAsync(25000);expect(await pending).toBe(false);expect(vi.getTimerCount()).toBe(0);mailer.close();
  });
  it('cancels active requests when stopped and refuses later sends',async()=>{
    mocks.resendSend.mockImplementation((_payload,options)=>new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('Fixture aborted')),{once:true})));
    const mailer=new PortalMailer(config()),pending=mailer.notification(delivery);mailer.close();
    expect(await pending).toBe(false);expect(await mailer.notification(delivery)).toBe(false);expect(mocks.resendSend).toHaveBeenCalledTimes(1);
  });
  it('uses TLS and a stable SMTP Message-ID for a retry',async()=>{
    mocks.smtpSend.mockResolvedValue({messageId:'one'});mocks.smtpCreate.mockReturnValue({sendMail:mocks.smtpSend,close:mocks.smtpClose});
    const mailer=new PortalMailer(config(true));expect(await mailer.notification(delivery)).toBe(true);expect(await mailer.notification(delivery)).toBe(true);
    expect(mocks.smtpCreate).toHaveBeenCalledWith(expect.objectContaining({requireTLS:true,socketTimeout:20000,tls:{minVersion:'TLSv1.2',rejectUnauthorized:true}}));
    expect(mocks.smtpSend.mock.calls[0][0].messageId).toBe(mocks.smtpSend.mock.calls[1][0].messageId);expect(mocks.resendSend).not.toHaveBeenCalled();mailer.close();expect(mocks.smtpClose).toHaveBeenCalledTimes(1);
  });
});
