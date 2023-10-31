import * as httpm from 'typed-rest-client/HttpClient';
import * as ifm from 'typed-rest-client/Interfaces';
import * as path from 'path';
import * as os from 'os';
import * as process from 'process';
import * as fs from 'fs';
import * as semver from 'semver';
import * as tl from 'azure-pipelines-task-lib/task';
import * as trm from 'azure-pipelines-task-lib/toolrunner';
const cmp = require('semver-compare');
const uuidV4 = require('uuid/v4');

declare let rest;

let pkg = require(path.join(__dirname, 'package.json'));
let userAgent = 'vsts-task-installer/' + pkg.version;
let requestOptions = {
    // ignoreSslError: true,
    proxy: tl.getHttpProxyConfiguration(),
    cert: tl.getHttpCertConfiguration(),
    allowRedirects: true,
    allowRetries: true,
    maxRetries: 2
} as ifm.IRequestOptions;
tl.setResourcePath(path.join(__dirname, 'lib.json'));

export function debug(message: string): void {
    tl.debug(message);
}

export function prependPath(toolPath: string) {
    tl.assertAgent('2.115.0');
    if (!toolPath) {
        throw new Error('Parameter toolPath must not be null or empty');
    }
    else if (!tl.exist(toolPath) || !tl.stats(toolPath).isDirectory()) {
        throw new Error('Directory does not exist: ' + toolPath);
    }

    // todo: add a test for path
    console.log(tl.loc('TOOL_LIB_PrependPath', toolPath));
    let newPath: string = toolPath + path.delimiter + process.env['PATH'];
    tl.debug('new Path: ' + newPath);
    process.env['PATH'] = newPath;

    // instruct the agent to set this path on future tasks
    console.log('##vso[task.prependpath]' + toolPath);
}

function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

//-----------------------------
// Version Functions
//-----------------------------

/**
 * Checks if a version spec is an explicit version (e.g. 1.0.1 or v1.0.1)
 * As opposed to a version spec like 1.x
 *
 * @param versionSpec
 */
export function isExplicitVersion(versionSpec: string) {
    let c = semver.clean(versionSpec);
    tl.debug('isExplicit: ' + c);

    let valid = semver.valid(c) != null;
    tl.debug('explicit? ' + valid);

    return valid;
}

/**
 * Returns cleaned (removed leading/trailing whitespace, remove '=v' prefix)
 * and parsed version, or null if version is invalid.
 */
export function cleanVersion(version: string) {
    tl.debug('cleaning: ' + version);
    return semver.clean(version);
}

/**
 * evaluates a list of versions and returns the latest version matching the version spec
 *
 * @param versions      an array of versions to evaluate
 * @param versionSpec   a version spec (e.g. 1.x)
 */
export function evaluateVersions(versions: string[], versionSpec: string): string {
    let version: string;
    tl.debug('evaluating ' + versions.length + ' versions');
    versions = versions.sort(cmp);
    for (let i = versions.length - 1; i >= 0; i--) {
        let potential: string = versions[i];
        let satisfied: boolean = semver.satisfies(potential, versionSpec);
        if (satisfied) {
            version = potential;
            break;
        }
    }

    if (version) {
        tl.debug('matched: ' + version);
    }
    else {
        tl.debug('match not found');
    }

    return version;
}

//-----------------------------
// Local Tool Cache Functions
//-----------------------------
/**
 * finds the path to a tool in the local installed tool cache
 *
 * @param toolName      name of the tool
 * @param versionSpec   version of the tool
 * @param arch          optional arch.  defaults to arch of computer
 */
export function findLocalTool(toolName: string, versionSpec: string, arch?: string): string {
    if (!toolName) {
        throw new Error('toolName parameter is required');
    }

    if (!versionSpec) {
        throw new Error('versionSpec parameter is required');
    }

    arch = arch || os.arch();

    // attempt to resolve an explicit version
    if (!isExplicitVersion(versionSpec)) {
        let localVersions: string[] = findLocalToolVersions(toolName, arch);
        let match = evaluateVersions(localVersions, versionSpec);
        versionSpec = match;
    }

    // check for the explicit version in the cache
    let toolPath: string;
    if (versionSpec) {
        versionSpec = semver.clean(versionSpec);
        let cacheRoot = _getCacheRoot();
        let cachePath = path.join(cacheRoot, toolName, versionSpec, arch);
        tl.debug('checking cache: ' + cachePath);
        if (tl.exist(cachePath) && tl.exist(`${cachePath}.complete`)) {
            console.log(tl.loc('TOOL_LIB_FoundInCache', toolName, versionSpec, arch));
            toolPath = cachePath;
        }
        else {
            tl.debug('not found');
        }
    }

    return toolPath;
}

/**
 * Retrieves the versions of a tool that is intalled in the local tool cache
 *
 * @param toolName  name of the tool
 * @param arch      optional arch.  defaults to arch of computer
 */
export function findLocalToolVersions(toolName: string, arch?: string) {
    let versions: string[] = [];

    arch = arch || os.arch();
    let toolPath = path.join(_getCacheRoot(), toolName);

    if (tl.exist(toolPath)) {
        let children: string[] = tl.ls('', [toolPath]);
        children.forEach((child: string) => {

            if (isExplicitVersion(child)) {
                let fullPath = path.join(toolPath, child, arch);
                if (tl.exist(fullPath) && tl.exist(`${fullPath}.complete`)) {
                    versions.push(child);
                }
            }
        });
    }

    return versions;
}

//---------------------
// Download Functions
//---------------------

//
// TODO: keep extension intact
//
/**
 * Download a tool from an url and stream it into a file
 *
 * @param url                url of tool to download
 * @param fileName           optional fileName.  Should typically not use (will be a guid for reliability). Can pass fileName with an absolute path.
 * @param handlers           optional handlers array.  Auth handlers to pass to the HttpClient for the tool download.
 * @param additionalHeaders  optional custom HTTP headers.  This is passed to the REST client that downloads the tool.
 */
export async function downloadTool(
    url: string,
    fileName?: string,
    handlers?: ifm.IRequestHandler[],
    additionalHeaders?: ifm.IHeaders
): Promise<string> {
    return new Promise<string>(async (resolve, reject) => {
        try {
            handlers = handlers || null;
            let http: httpm.HttpClient = new httpm.HttpClient(userAgent, handlers, requestOptions);
            tl.debug(fileName);
            fileName = fileName || uuidV4();

            // check if it's an absolute path already
            var destPath: string;
            if (path.isAbsolute(fileName)) {
                destPath = fileName;
            }
            else {
                destPath = path.join(_getAgentTemp(), fileName);
            }

            // make sure that the folder exists
            tl.mkdirP(path.dirname(destPath));

            console.log(tl.loc('TOOL_LIB_Downloading', url.replace(/sig=[^&]*/, "sig=-REDACTED-")));
            tl.debug('destination ' + destPath);

            if (fs.existsSync(destPath)) {
                throw new Error("Destination file path already exists");
            }

            tl.debug('downloading');
            let response: httpm.HttpClientResponse = await http.get(url, additionalHeaders);

            if (response.message.statusCode != 200) {
                let err: Error = new Error('Unexpected HTTP response: ' + response.message.statusCode);
                err['httpStatusCode'] = response.message.statusCode;
                tl.debug(`Failed to download "${fileName}" from "${url}". Code(${response.message.statusCode}) Message(${response.message.statusMessage})`);
                throw err;
            }

            let downloadedContentLength = _getContentLengthOfDownloadedFile(response);
            if (!isNaN(downloadedContentLength)) {
                tl.debug(`Content-Length of downloaded file: ${downloadedContentLength}`);
            } else {
                tl.debug(`Content-Length header missing`);
            }

            tl.debug('creating stream');
            const file: NodeJS.WritableStream = fs.createWriteStream(destPath);
            file
                .on('open', async (fd) => {
                    try {
                        response.message
                            .on('error', (err) => {
                                file.end();
                                reject(err);
                            })
                            .on('aborted', () => {
                                // this block is for Node10 compatibility since it doesn't emit 'error' event after 'aborted' one
                                file.end();
                                reject(new Error('Aborted'));
                            })
                            .pipe(file);
                    } catch (err) {
                        reject(err);
                    }
                })
                .on('close', () => {
                    tl.debug('download complete');
                    let fileSizeInBytes: number;
                    try {
                        fileSizeInBytes = _getFileSizeOnDisk(destPath);
                    } catch (err) {
                        fileSizeInBytes = NaN;
                        tl.warning(`Unable to check file size of ${destPath} due to error: ${err.Message}`);
                    }

                    if (!isNaN(fileSizeInBytes)) {
                        tl.debug(`Downloaded file size: ${fileSizeInBytes} bytes`);
                    } else {
                        tl.debug(`File size on disk was not found`);
                    }

                    if (!isNaN(downloadedContentLength) &&
                        !isNaN(fileSizeInBytes) &&
                        fileSizeInBytes !== downloadedContentLength) {
                        tl.warning(`Content-Length (${downloadedContentLength} bytes) did not match downloaded file size (${fileSizeInBytes} bytes).`);
                    }

                    resolve(destPath);
                })
                .on('error', (err) => {
                    file.end();
                    reject(err);
                });
        } catch (error) {
            reject(error);
        }
    });
}

export async function downloadToolWithRetries(
        url: string,
        fileName?: string,
        handlers?: ifm.IRequestHandler[],
        additionalHeaders?: ifm.IHeaders,
        maxAttempts: number = 3,
        retryInterval: number = 500
    ): Promise<string>  {
    let attempt: number = 1;
    let destinationPath: string = ''
    
    while (attempt <= maxAttempts && destinationPath == '') {
        try {
            destinationPath = await downloadTool(url, fileName, handlers, additionalHeaders);
        } catch (err) {
            if (attempt === maxAttempts) throw err;
            const attemptInterval = attempt * retryInterval;

            // Error will be shown in downloadTool.
            tl.debug(`Attempt ${attempt} failed. Retrying after ${attemptInterval} ms`);
            
            await delay(attemptInterval);
            attempt++;
        }
    }

    return destinationPath;
}

//---------------------
// Size functions
//---------------------

/**
 * Gets size of downloaded file from "Content-Length" header
 *
 * @param response    response for request to get the file
 * @returns number if the 'content-length' is not empty, otherwise NaN 
 */
function _getContentLengthOfDownloadedFile(response: httpm.HttpClientResponse): number {
    let contentLengthHeader = response.message.headers['content-length']
    let parsedContentLength = parseInt(contentLengthHeader);
    return parsedContentLength;
}

/**
 * Gets size of file saved to disk
 *
 * @param filePath    the path to the file, saved to the disk
 * @returns size of file saved to disk
 */
function _getFileSizeOnDisk(filePath: string): number {
    let fileStats = fs.statSync(filePath);
    let fileSizeInBytes = fileStats.size;
    return fileSizeInBytes;
}

//---------------------
// Install Functions
//---------------------
function _createToolPath(tool: string, version: string, arch?: string): string {
    // todo: add test for clean
    let folderPath = path.join(_getCacheRoot(), tool, semver.clean(version), arch);
    tl.debug('destination ' + folderPath);
    let markerPath: string = `${folderPath}.complete`;
    tl.rmRF(folderPath);
    tl.rmRF(markerPath);
    tl.mkdirP(folderPath);
    return folderPath;
}

function _completeToolPath(tool: string, version: string, arch?: string): void {
    let folderPath = path.join(_getCacheRoot(), tool, semver.clean(version), arch);
    let markerPath: string = `${folderPath}.complete`;
    tl.writeFile(markerPath, '');
    tl.debug('finished caching tool');
}

/**
 * Caches a directory and installs it into the tool cacheDir
 *
 * @param sourceDir    the directory to cache into tools
 * @param tool          tool name
 * @param version       version of the tool.  semver format
 * @param arch          architecture of the tool.  Optional.  Defaults to machine architecture
 */
export async function cacheDir(sourceDir: string,
    tool: string,
    version: string,
    arch?: string): Promise<string> {
    version = semver.clean(version);
    arch = arch || os.arch();
    console.log(tl.loc('TOOL_LIB_CachingTool', tool, version, arch));

    tl.debug('source dir: ' + sourceDir);
    if (!tl.stats(sourceDir).isDirectory()) {
        throw new Error('sourceDir is not a directory');
    }

    // create the tool dir
    let destPath: string = _createToolPath(tool, version, arch);

    // copy each child item. do not move. move can fail on Windows
    // due to anti-virus software having an open handle on a file.
    for (let itemName of fs.readdirSync(sourceDir)) {
        let s = path.join(sourceDir, itemName);
        tl.cp(s, destPath + '/', '-r');
    }

    // write .complete
    _completeToolPath(tool, version, arch);

    return destPath;
}

/**
 * Caches a downloaded file (GUID) and installs it
 * into the tool cache with a given targetName
 *
 * @param sourceFile    the file to cache into tools.  Typically a result of downloadTool which is a guid.
 * @param targetFile    the name of the file name in the tools directory
 * @param tool          tool name
 * @param version       version of the tool.  semver format
 * @param arch          architecture of the tool.  Optional.  Defaults to machine architecture
 */
export async function cacheFile(sourceFile: string,
    targetFile: string,
    tool: string,
    version: string,
    arch?: string): Promise<string> {
    version = semver.clean(version);
    arch = arch || os.arch();
    console.log(tl.loc('TOOL_LIB_CachingTool', tool, version, arch));

    tl.debug('source file:' + sourceFile);
    if (!tl.stats(sourceFile).isFile()) {
        throw new Error('sourceFile is not a file');
    }

    // create the tool dir
    let destFolder: string = _createToolPath(tool, version, arch);

    // copy instead of move. move can fail on Windows due to
    // anti-virus software having an open handle on a file.
    let destPath: string = path.join(destFolder, targetFile);
    tl.debug('destination file' + destPath);
    tl.cp(sourceFile, destPath);

    // write .complete
    _completeToolPath(tool, version, arch);

    return destFolder;
}

//---------------------
// Extract Functions
//---------------------

/**
 * Extract a .7z file
 *
 * @param file     path to the .7z file
 * @param dest     destination directory. Optional.
 * @param _7zPath  path to 7zr.exe. Optional, for long path support. Most .7z archives do not have this
 * problem. If your .7z archive contains very long paths, you can pass the path to 7zr.exe which will
 * gracefully handle long paths. By default 7z.exe is used because it is a very small program and is
 * bundled with the tool lib. However it does not support long paths. 7z.exe is the reduced command line
 * interface, it is smaller than the full command line interface, and it does support long paths. At the
 * time of this writing, it is freely available from the LZMA SDK that is available on the 7zip website.
 * Be sure to check the current license agreement. If 7z.exe is bundled with your task, then the path
 * to 7z.exe can be pass to this function.
 * @param overwriteDest Overwrite files in destination catalog. Optional.
 * @returns        path to the destination directory
 */
export async function extract7z(file: string, dest?: string, _7zPath?: string, overwriteDest?: boolean): Promise<string> {
    if (process.platform != 'win32') {
        throw new Error('extract7z() not supported on current OS');
    }

    if (!file) {
        throw new Error("parameter 'file' is required");
    }

    console.log(tl.loc('TOOL_LIB_ExtractingArchive'));
    dest = _createExtractFolder(dest);

    let originalCwd = process.cwd();
    try {
        process.chdir(dest);

        if (_7zPath) {
            // extract
            const _7z: trm.ToolRunner = tl.tool(_7zPath);
            if (overwriteDest) {
                _7z.arg('-aoa');
            }

            _7z.arg('x')         // eXtract files with full paths
               .arg('-bb1')      // -bb[0-3] : set output log level
               .arg('-bd')       // disable progress indicator
               .arg('-sccUTF-8') // set charset for for console input/output
               .arg(file);
            await _7z.exec();
        }
        else {
            // extract
            let escapedScript = path.join(__dirname, 'Invoke-7zdec.ps1').replace(/'/g, "''").replace(/"|\n|\r/g, ''); // double-up single quotes, remove double quotes and newlines
            let escapedFile = file.replace(/'/g, "''").replace(/"|\n|\r/g, '');
            let escapedTarget = dest.replace(/'/g, "''").replace(/"|\n|\r/g, '');
            const overrideDestDirectory: number = overwriteDest ? 1 : 0;
            const command: string = `& '${escapedScript}' -Source '${escapedFile}' -Target '${escapedTarget}' -OverrideDestDirectory ${overrideDestDirectory}`;
            let powershellPath = tl.which('powershell', true);
            let powershell: trm.ToolRunner = tl.tool(powershellPath)
                .line('-NoLogo -Sta -NoProfile -NonInteractive -ExecutionPolicy Unrestricted -Command')
                .arg(command);
            powershell.on('stdout', (buffer: Buffer) => {
                process.stdout.write(buffer);
            });
            powershell.on('stderr', (buffer: Buffer) => {
                process.stderr.write(buffer);
            });
            await powershell.exec(<trm.IExecOptions>{ silent: true });
        }
    }
    finally {
        process.chdir(originalCwd);
    }

    return dest;
}

/**
 * installs a tool from a tar by extracting the tar and installing it into the tool cache
 *
 * @param file      file path of the tar
 * @param tool      name of tool in the tool cache
 * @param version   version of the tool
 * @param arch      arch of the tool.  optional.  defaults to the arch of the machine
 * @param options   IExtractOptions
 * @param destination   destination directory. optional.
 */
export async function extractTar(file: string, destination?: string): Promise<string> {

    // mkdir -p node/4.7.0/x64
    // tar xzC ./node/4.7.0/x64 -f node-v4.7.0-darwin-x64.tar.gz --strip-components 1

    console.log(tl.loc('TOOL_LIB_ExtractingArchive'));
    let dest = _createExtractFolder(destination);

    let tr: trm.ToolRunner = tl.tool('tar');
    tr.arg(['xC', dest, '-f', file]);

    await tr.exec();
    return dest;
}

export async function extractZip(file: string, destination?: string): Promise<string> {
    if (!file) {
        throw new Error("parameter 'file' is required");
    }

    console.log(tl.loc('TOOL_LIB_ExtractingArchive'));
    let dest = _createExtractFolder(destination);

    if (process.platform == 'win32') {
        // build the powershell command
        let escapedFile = file.replace(/'/g, "''").replace(/"|\n|\r/g, ''); // double-up single quotes, remove double quotes and newlines
        let escapedDest = dest.replace(/'/g, "''").replace(/"|\n|\r/g, '');
        let command: string = `$ErrorActionPreference = 'Stop' ; try { Add-Type -AssemblyName System.IO.Compression.FileSystem } catch { } ; [System.IO.Compression.ZipFile]::ExtractToDirectory('${escapedFile}', '${escapedDest}')`;

        // change the console output code page to UTF-8.
        // TODO: FIX WHICH: let chcpPath = tl.which('chcp.com', true);
        let chcpPath = path.join(process.env.windir, "system32", "chcp.com");
        await tl.exec(chcpPath, '65001');

        // run powershell
        let powershell: trm.ToolRunner = tl.tool('powershell')
            .line('-NoLogo -Sta -NoProfile -NonInteractive -ExecutionPolicy Unrestricted -Command')
            .arg(command);
        await powershell.exec();
    }
    else {
        let unzip: trm.ToolRunner = tl.tool('unzip')
            .arg(file);
        await unzip.exec(<trm.IExecOptions>{ cwd: dest });
    }

    return dest;
}

function _createExtractFolder(dest?: string): string {
    if (!dest) {
        // create a temp dir
        dest = path.join(_getAgentTemp(), uuidV4());
    }

    tl.mkdirP(dest);

    return dest;
}

//---------------------
// Query Functions
//---------------------

//       default input will be >= LTS version.  drop label different than value.
//       v4 (LTS) would have a value of 4.x
//       option to always download?  (not cache), TTL?

/**
 * Scrape a web page for versions by regex
 *
 * @param url       url to scrape
 * @param regex     regex to use for version matches
 * @param handlers  optional handlers array.  Auth handlers to pass to the HttpClient for the tool download.
 */
export async function scrape(url: string, regex: RegExp, handlers?: ifm.IRequestHandler[]): Promise<string[]> {
    handlers = handlers || null;
    let http: httpm.HttpClient = new httpm.HttpClient(userAgent, handlers, requestOptions);
    let output: string = await (await http.get(url)).readBody();

    let matches = output.match(regex);

    let seen: any = {};
    let versions: string[] = [];
    for (let i = 0; i < matches.length; i++) {
        let ver: string = semver.clean(matches[i]);
        if (!seen.hasOwnProperty(ver)) {
            seen[ver] = true;
            versions.push(ver);
        }
    }

    return versions;
}

function _getCacheRoot(): string {
    tl.assertAgent('2.115.0');
    let cacheRoot = tl.getVariable('Agent.ToolsDirectory');
    if (!cacheRoot) {
        throw new Error('Agent.ToolsDirectory is not set');
    }

    return cacheRoot;
}

function _getAgentTemp(): string {
    tl.assertAgent('2.115.0');
    let tempDirectory = tl.getVariable('Agent.TempDirectory');
    if (!tempDirectory) {
        throw new Error('Agent.TempDirectory is not set');
    }

    return tempDirectory;
}