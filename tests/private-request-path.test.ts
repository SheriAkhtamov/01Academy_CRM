import express from 'express';
import request from 'supertest';
import {describe,expect,it,vi} from 'vitest';
import {privateRequestPath} from '../server/lib/private-request-path';
import {errorHandler} from '../server/middleware/errorHandler';
import {createHttpApp} from '../server/app/http-app';
const logs=vi.hoisted(()=>({error:vi.fn(),info:vi.fn()}));
vi.mock('../server/lib/logger',()=>({logger:logs}));
describe('Normal and exception request paths exclude bearer secrets',()=>{
  it('masks public portfolio links and nested file routes',()=>{
    expect(privateRequestPath('/api/public/portfolio/private-link-value/files/12?preview=1')).toBe('/api/public/portfolio/[share]/files/12');
    expect(privateRequestPath('/portfolio/p/private-link-value')).toBe('/portfolio/p/[share]');
  });
  it('drops activation/recovery query values and keeps ordinary route information',()=>{
    expect(privateRequestPath('/learn/activate?token=private-one-use-value#next')).toBe('/learn/activate');
    expect(privateRequestPath('/api/portal/subjects/2/projects/3')).toBe('/api/portal/subjects/2/projects/3');
  });
  it('redacts the link when an actual public HTTP request reaches exception logging',async()=>{
    const app=express();app.get('/api/public/portfolio/:token/files/:id',()=>{throw new Error('Fixture failure');});app.use(errorHandler);
    await request(app).get('/api/public/portfolio/private-link-value/files/12?token=private-query-value').expect(500);
    expect(logs.error).toHaveBeenCalledWith('Server Error',expect.objectContaining({route:'/api/public/portfolio/[share]/files/12'}));
    expect(JSON.stringify(logs.error.mock.calls)).not.toContain('private-link-value');expect(JSON.stringify(logs.error.mock.calls)).not.toContain('private-query-value');
  });
  it('records mounted HTTP route durations using the original path while hiding bearer links and queries',async()=>{
    logs.info.mockClear();
    const app=createHttpApp(),router=express.Router();
    router.get('/:token/files/:id',(_req,res)=>res.json({success:true}));
    app.use('/api/public/portfolio',router);
    await request(app).get('/api/public/portfolio/private-link-value/files/12?token=private-query-value').expect(200);
    expect(logs.info).toHaveBeenCalledWith(expect.stringMatching(/^GET \/api\/public\/portfolio\/\[share\]\/files\/12 200 [\d.]+ ms$/));
    expect(JSON.stringify(logs.info.mock.calls)).not.toContain('private-link-value');expect(JSON.stringify(logs.info.mock.calls)).not.toContain('private-query-value');
  });
});
