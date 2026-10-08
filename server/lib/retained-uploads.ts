import { constants, createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const isMissing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
const isInside = (root: string, candidate: string) => {
  const relative = path.relative(root, candidate);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

async function digest(filePath: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function assertSameFile(source: string, retained: string) {
  const copy = await fs.lstat(retained);
  if (!copy.isFile()) throw new Error('Retained upload must be a regular file');
  let original;
  try { original = await fs.lstat(source); }
  catch (error) { if (isMissing(error)) return; throw error; }
  if (!original.isFile()) throw new Error('Committed upload must be a regular file');
  if (original.dev === copy.dev && original.ino === copy.ino) return;
  if (original.size !== copy.size || await digest(source) !== await digest(retained)) {
    throw new Error('An immutable upload name was reused with different content');
  }
}

/**
 * Call only after the upload's database reference has been deleted successfully.
 * Published uploads have unique names and immutable bytes. Keeping their original
 * paths here allows a database snapshot taken before deletion to restore them.
 * Never unlink the live file if retention fails, and never garbage-collect this
 * directory while a database/files backup can still be in progress.
 */
export async function removeCommittedUpload(
  filePath: string,
  uploadsDirectory = path.resolve(process.cwd(), 'uploads'),
): Promise<void> {
  const root = path.resolve(uploadsDirectory);
  const source = path.resolve(filePath);
  const relative = path.relative(root, source);
  if (!isInside(root, source) || relative.split(path.sep)[0] === '.retained') {
    throw new Error('Upload path is outside the live uploads directory');
  }

  let original;
  try { original = await fs.lstat(source); }
  catch (error) { if (isMissing(error)) return; throw error; }
  if (!original.isFile()) throw new Error('Committed upload must be a regular file');

  const realRoot = await fs.realpath(root);
  const realSource = await fs.realpath(source);
  if (!isInside(realRoot, realSource)) throw new Error('Upload path escapes through a symbolic link');

  const retainedRoot = path.join(root, '.retained');
  const retained = path.join(retainedRoot, relative);
  await fs.mkdir(retainedRoot, { recursive: true, mode: 0o750 });
  if (await fs.realpath(retainedRoot) !== path.join(realRoot, '.retained')) {
    throw new Error('Retention directory must not be a symbolic link');
  }
  await fs.mkdir(path.dirname(retained), { recursive: true, mode: 0o750 });
  const realRetainedParent = await fs.realpath(path.dirname(retained));
  if (!isInside(realRoot, realRetainedParent)
    || !isInside(path.join(realRoot, '.retained'), path.join(realRetainedParent, path.basename(retained)))) {
    throw new Error('Retention directory escapes through a symbolic link');
  }

  try {
    await fs.link(source, retained);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') {
      await assertSameFile(source, retained);
    } else if (['EXDEV', 'EPERM', 'EOPNOTSUPP', 'ENOTSUP'].includes(code ?? '')) {
      // Publish a complete copied file atomically; a backup must never see a
      // partially copied retained file. The temporary directory is excluded.
      const temporaryDirectory = path.join(root, '.retention-work');
      await fs.mkdir(temporaryDirectory, { recursive: true, mode: 0o750 });
      if (await fs.realpath(temporaryDirectory) !== path.join(realRoot, '.retention-work')) {
        throw new Error('Retention work directory must not be a symbolic link');
      }
      const temporary = path.join(temporaryDirectory, randomUUID());
      try {
        await fs.copyFile(source, temporary, constants.COPYFILE_EXCL);
        await fs.chmod(temporary, original.mode & 0o777);
        try { await fs.link(temporary, retained); }
        catch (publishError) {
          if ((publishError as NodeJS.ErrnoException).code !== 'EEXIST') throw publishError;
          await assertSameFile(source, retained);
        }
      } finally {
        await fs.unlink(temporary).catch((cleanupError) => { if (!isMissing(cleanupError)) throw cleanupError; });
      }
    } else {
      throw error;
    }
  }

  await fs.unlink(source).catch((error) => { if (!isMissing(error)) throw error; });
}
