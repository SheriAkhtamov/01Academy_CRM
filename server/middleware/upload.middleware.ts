import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { isProductionEnvironment } from '../config';

export const diskStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (!fs.existsSync('uploads/')) {
            fs.mkdirSync('uploads/', { recursive: true });
        }
        const requestId = req.headers['x-request-id'];
        if (requestId && !isProductionEnvironment) {
            console.debug(`Upload request ${requestId} for ${file.originalname}`);
        }
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        const baseName = path.basename(file.originalname, ext);
        cb(null, `${baseName}-${uniqueSuffix}${ext}`);
    },
});

export const upload = multer({
    storage: diskStorage,
    limits: {
        fileSize: 10 * 1024 * 1024,
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = [
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'image/jpeg',
            'image/jpg',
            'image/png',
            'text/plain'
        ];

        const isAllowed = allowedTypes.includes(file.mimetype);
        if (!isAllowed && !isProductionEnvironment) {
            console.debug(`Rejected upload from ${req.ip} with type ${file.mimetype}`);
        }

        if (!isAllowed) {
            return cb(new Error('Unsupported file type'));
        }
        cb(null, true);
    },
});

export const photoStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (!fs.existsSync('uploads/photos/')) {
            fs.mkdirSync('uploads/photos/', { recursive: true });
        }
        const requestId = req.headers['x-request-id'];
        if (requestId && !isProductionEnvironment) {
            console.debug(`Photo upload request ${requestId} for ${file.originalname}`);
        }
        cb(null, 'uploads/photos/');
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, `photo-${uniqueSuffix}${ext}`);
    },
});

export const uploadPhoto = multer({
    storage: photoStorage,
    limits: {
        fileSize: 5 * 1024 * 1024,
    },
    fileFilter: (req, file, cb) => {
        const allowedPhotoTypes = [
            'image/jpeg',
            'image/jpg',
            'image/png'
        ];

        const isAllowed = allowedPhotoTypes.includes(file.mimetype);
        if (!isAllowed && !isProductionEnvironment) {
            console.debug(`Rejected photo upload from ${req.ip} with type ${file.mimetype}`);
        }

        if (!isAllowed) {
            return cb(new Error('Unsupported file type'));
        }
        cb(null, true);
    },
});
