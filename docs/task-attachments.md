# Task acceptance and attachments

- Only `creatorId` can accept a completed task or reopen an accepted one. Leadership does not bypass approval. A self-assigned task may be accepted by its creator. Acceptance records the actor and archives the task; repeating it does not rewrite history. Administrative deletion permissions are unchanged.
- Creation supports up to 10 selected files, uploaded sequentially, with a 50 MiB (52,428,800 bytes) inclusive limit per file. The picker and server share one allowlist. PDF, DOC/DOCX, XLS/XLSX/CSV and the previously supported document/media/archive formats remain available.
- Photo extensions: JPG/JPEG/JPE/JFIF, PNG/APNG, GIF, WebP, AVIF, BMP/DIB, TIFF, HEIC/HEIF, ICO, JPEG XL, JPEG 2000, DNG, CR2/CR3, NEF/NRW, ARW/SR2/SRF, ORF, RW2, RAF, PEF, 3FR. A malformed or unsupported codec variant can still fail preview; the original remains downloadable. SVG and executable/active-content attachments remain blocked.
- Thumbnails open a Dialog, both before creation and in the task attachment tab. Formats unsupported by the browser are converted to PNG in a same-origin, on-demand WebAssembly worker. Conversion is serialized, time/resource limited, first-frame only, with raster-only decoder policy. Worker and blob URLs are disposed on completion/close. Nothing is sent to an external conversion service and originals are never rewritten.
- A failed create request reuses its UUID; a failed upload reuses the file UUID. PostgreSQL advisory transaction locks plus existing activity metadata deduplicate retries, including lost responses. Successful files are not re-uploaded when retrying a partially completed form. Metadata and attachment activity commit together; long filenames are retained in metadata without overflowing the activity display field.
- Upload and download routes require task read access; access is checked again after upload. Downloads are private/non-cacheable and never served as executable inline content. No schema migration is needed for this feature.

## Deployment and verification

The production assets include the worker and its WASM file. CSP permits `wasm-unsafe-eval` (not JavaScript `unsafe-eval`) and same-origin workers. Serve `.wasm` assets along with the other Vite output. The reverse proxy must allow a multipart request slightly larger than 50 MiB; e.g. use 52 MiB if a request-body limit is configured. Files are sent individually, not as a 500 MiB request.

Automated coverage: `board-attachments.test.ts`, `board.routes.test.ts`, `board-upload-storage.test.ts`, `task-attachments.dom.test.tsx`, `security.middleware.test.ts`. Tests exercise real raster decoding, exact upload boundaries, private access, creator-only acceptance, safe retry, modal previews and discard confirmation. They do not require a browser or a running dev server.

Decoder reference: [magick-wasm](https://github.com/dlemstra/magick-wasm); security controls: [ImageMagick policy](https://imagemagick.org/security-policy/).
