import path from "node:path";
import type { Request, Response } from "express";
import { USER_PHOTO_MIME_TYPES } from "@shared/user-photo";
import { portalAvatarUrlSchema } from "@shared/contracts/portal-identity";
import { readFileMimeType } from "../../../lib/file-media";
import {
  cleanupUploadedUserPhoto,
  createUserPhotoUpload,
  retainUploadedUserPhoto,
} from "../../../middleware/user-photo.middleware";
import type { PortalProfilePhotos } from "../http/portal-router";

export const PORTAL_PHOTO_DIR = path.resolve(process.cwd(), "uploads", "portal-photos");

export function createPortalProfilePhotos(directory = PORTAL_PHOTO_DIR): PortalProfilePhotos {
  const parse = createUserPhotoUpload({ directory, urlPrefix: "/api/portal/me/photos" });
  return {
    readUpload: (req, res) => new Promise<boolean>((resolve, reject) => {
      const disconnected = () => {
        res.off("finish", disconnected);
        res.off("close", disconnected);
        resolve(false);
      };
      res.once("finish", disconnected);
      res.once("close", disconnected);
      parse(req, res, (error) => {
        res.off("finish", disconnected);
        res.off("close", disconnected);
        if (error) reject(error);
        else resolve(!req.aborted && !res.destroyed);
      });
    }),
    uploadedUrl: (req: Request) => {
      const url = req.file ? `/api/portal/me/photos/${req.file.filename}` : undefined;
      return portalAvatarUrlSchema.optional().parse(url);
    },
    retain: retainUploadedUserPhoto,
    cleanup: cleanupUploadedUserPhoto,
    async send(res: Response, photoId: string) {
      const notFound = () => {
        if (!res.headersSent && !res.destroyed)
          res.status(404).json({ error: "portalNotFound", code: "portalNotFound" });
      };
      if (!/^[A-Za-z0-9_-]{21}$/.test(photoId)) return notFound();
      const filePath = path.join(directory, photoId);
      try {
        const mimeType = await readFileMimeType(filePath);
        if (!USER_PHOTO_MIME_TYPES.some((type) => type === mimeType)) return notFound();
        res.setHeader("Cache-Control", "private, no-store");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
        res.setHeader("Content-Type", mimeType);
        await new Promise<void>((resolve) => {
          res.sendFile(filePath, (error) => {
            if (error) notFound();
            resolve();
          });
        });
      } catch { notFound(); }
    },
  };
}
