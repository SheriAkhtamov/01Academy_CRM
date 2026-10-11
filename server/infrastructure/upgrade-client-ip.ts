import express,{type Express} from 'express';
import type {IncomingMessage} from 'node:http';

/** Share Express's compiled trust-proxy policy instead of trusting forwarded headers directly. */
export function upgradeClientIp(request:IncomingMessage,app:Express):string {
  const getter=Object.getOwnPropertyDescriptor(express.request,'ip')?.get;
  if(!getter)return request.socket.remoteAddress ?? 'unknown';
  const scoped=Object.create(request) as IncomingMessage & {app:Express};
  scoped.app=app;
  return getter.call(scoped) as string;
}
