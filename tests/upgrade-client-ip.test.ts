import express from 'express';
import type {IncomingMessage} from 'node:http';
import {describe,expect,it} from 'vitest';
import {upgradeClientIp} from '../server/infrastructure/upgrade-client-ip';
const request=(peer:string,forwarded:string)=>({socket:{remoteAddress:peer},headers:{'x-forwarded-for':forwarded}} as unknown as IncomingMessage);
describe('Portal upgrade uses the same trusted proxy address policy as HTTP',()=>{
  it('ignores a forged forwarded address from an untrusted direct client',()=>{
    const app=express();app.set('trust proxy',['loopback']);
    expect(upgradeClientIp(request('203.0.113.7','198.51.100.4'),app)).toBe('203.0.113.7');
  });
  it('resolves different clients behind the trusted proxy without changing their raw upgrade requests',()=>{
    const app=express();app.set('trust proxy',['loopback']);
    const first=request('127.0.0.1','198.51.100.4'),second=request('127.0.0.1','198.51.100.5');
    expect(upgradeClientIp(first,app)).toBe('198.51.100.4');expect(upgradeClientIp(second,app)).toBe('198.51.100.5');
    expect(first).not.toHaveProperty('app');
  });
  it('stops at the first untrusted hop instead of using a client-supplied earlier address',()=>{
    const app=express();app.set('trust proxy',['loopback']);
    expect(upgradeClientIp(request('127.0.0.1','192.0.2.90, 198.51.100.7'),app)).toBe('198.51.100.7');
  });
});
