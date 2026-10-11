import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import type { RequestHandler } from 'express';
import { PORTAL_MAX_FILE_BYTES } from '@shared/contracts/portal-resources';
import { PortalResourceError } from '../domain/policy';
import { reserveUploadSpace } from './storage-reservation';
export const createResourceUploadParser=(directory=path.resolve('uploads/lms/quarantine'),uploadsDirectory=path.resolve('uploads')):RequestHandler=>{
  const upload=multer({storage:multer.diskStorage({
    destination:(request,_file,callback)=>{
      void reserveUploadSpace(directory,PORTAL_MAX_FILE_BYTES,{uploadsDirectory}).then(async release=>{
        if(request.aborted || (request.destroyed && !request.complete)){release('cancelled');return callback(new PortalResourceError('portalUploadFailed'),directory);}
        const finished=()=>release(request.file?{writtenBytes:request.file.size}:undefined);
        request.res?.once('finish',finished);
        request.res?.once('close',finished);
        request.once('aborted',()=>release());
        try{await fs.mkdir(directory,{recursive:true,mode:0o750});callback(null,directory);}
        catch(error){release('cancelled');callback(error as Error,directory);}
      }).catch(error=>callback(error as Error,directory));
    },
    filename:(request,_file,callback)=>{
      const name=crypto.randomBytes(24).toString('base64url');
      request.once('aborted',()=>{void fs.unlink(path.join(directory,name)).catch(()=>undefined);});
      callback(null,name);
    },
  }),limits:{fileSize:PORTAL_MAX_FILE_BYTES,files:1,fields:3,parts:4}});
  return(request,response,next)=>upload.single('file')(request,response,(error:unknown)=>{
    if(!error)return next();
    if(error instanceof PortalResourceError)return response.status(error.statusCode).json({code:error.code});
    const tooLarge=error instanceof multer.MulterError && error.code==='LIMIT_FILE_SIZE';
    response.status(tooLarge?413:400).json({code:tooLarge?'portalFileTooLarge':'portalUploadFailed'});
  });
};
