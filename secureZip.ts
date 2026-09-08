import * as fs from 'fs';
import * as path from 'path';
import * as stream from 'stream';
import * as util from 'util';

const yauzl: any = require('yauzl');
const pipeline = util.promisify(stream.pipeline);

function isWithinDirectory(root: string, candidate: string): boolean {
    const relativePath = path.relative(root, candidate);
    return relativePath === '' ||
        (!path.isAbsolute(relativePath) && relativePath.split(path.sep).indexOf('..') < 0);
}

function getEntryPath(root: string, entryName: string): string {
    const entryPath = path.resolve(root, ...entryName.split('/'));
    if (!isWithinDirectory(root, entryPath)) {
        throw new Error(`Archive entry is outside the destination directory: ${entryName}`);
    }
    return entryPath;
}

async function ensureSafeParent(root: string, entryPath: string): Promise<void> {
    const parentPath = path.dirname(entryPath);
    await fs.promises.mkdir(parentPath, { recursive: true });
    const realParentPath = await fs.promises.realpath(parentPath);
    if (!isWithinDirectory(root, realParentPath)) {
        throw new Error(`Archive entry parent is outside the destination directory: ${entryPath}`);
    }
}

async function ensureDestinationIsNotSymlink(entryPath: string): Promise<void> {
    try {
        const stats = await fs.promises.lstat(entryPath);
        if (stats.isSymbolicLink()) {
            throw new Error(`Archive entry would overwrite a symbolic link: ${entryPath}`);
        }
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error;
        }
    }
}

function isDirectory(entry: any): boolean {
    const mode = (entry.externalFileAttributes >> 16) & 0xFFFF;
    const fileType = mode & 0xF000;
    return fileType === 0x4000 || entry.fileName.endsWith('/') ||
        ((entry.versionMadeBy >> 8) === 0 && entry.externalFileAttributes === 16);
}

function isSymbolicLink(entry: any): boolean {
    const mode = (entry.externalFileAttributes >> 16) & 0xFFFF;
    return (mode & 0xF000) === 0xA000;
}

function getMode(entry: any, directory: boolean): number {
    const mode = ((entry.externalFileAttributes >> 16) & 0xFFFF) & 0o777;
    return mode || (directory ? 0o755 : 0o644);
}

async function readEntry(zipFile: any, entry: any): Promise<Buffer> {
    const readStream = await zipFile.openReadStreamPromise(entry);
    const chunks: Buffer[] = [];
    for await (const chunk of readStream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks as any[]);
}

async function extractEntry(zipFile: any, root: string, entry: any): Promise<void> {
    const destinationPath = getEntryPath(root, entry.fileName);
    const directory = isDirectory(entry);

    if (directory) {
        await fs.promises.mkdir(destinationPath, { recursive: true, mode: getMode(entry, true) });
        const realDirectoryPath = await fs.promises.realpath(destinationPath);
        if (!isWithinDirectory(root, realDirectoryPath)) {
            throw new Error(`Archive directory is outside the destination directory: ${entry.fileName}`);
        }
        return;
    }

    await ensureSafeParent(root, destinationPath);

    if (isSymbolicLink(entry)) {
        const linkTarget = (await readEntry(zipFile, entry)).toString();
        if (path.isAbsolute(linkTarget)) {
            throw new Error(`Archive symlink has an absolute target: ${entry.fileName}`);
        }

        const resolvedTarget = path.resolve(path.dirname(destinationPath), ...linkTarget.split('/'));
        if (!isWithinDirectory(root, resolvedTarget)) {
            throw new Error(`Archive symlink target is outside the destination directory: ${entry.fileName}`);
        }

        try {
            const realTarget = await fs.promises.realpath(resolvedTarget);
            if (!isWithinDirectory(root, realTarget)) {
                throw new Error(`Archive symlink target resolves outside the destination directory: ${entry.fileName}`);
            }
        }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                throw error;
            }
        }

        await ensureDestinationIsNotSymlink(destinationPath);
        await fs.promises.symlink(linkTarget, destinationPath);
        return;
    }

    await ensureDestinationIsNotSymlink(destinationPath);
    const readStream = await zipFile.openReadStreamPromise(entry);
    await pipeline(readStream, fs.createWriteStream(destinationPath, { mode: getMode(entry, false) }));
}

export async function extractZipSecure(file: string, destination: string): Promise<string> {
    if (!file) {
        throw new Error("parameter 'file' is required");
    }
    if (!destination || !path.isAbsolute(destination)) {
        throw new Error('Target directory is expected to be absolute');
    }

    await fs.promises.mkdir(destination, { recursive: true });
    const root = await fs.promises.realpath(destination);
    const zipFile = await yauzl.openPromise(file, { lazyEntries: true });

    try {
        for await (const entry of zipFile.eachEntry()) {
            await extractEntry(zipFile, root, entry);
        }
    }
    finally {
        zipFile.close();
    }

    return root;
}