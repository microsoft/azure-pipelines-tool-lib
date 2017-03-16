///<reference path="typings/index.d.ts"/>

import * as restm from 'typed-rest-client/RestClient';
import * as httpm from 'typed-rest-client/HttpClient';
import * as path from 'path';
import * as os from 'os';
import * as process from 'process';
import * as fs from 'fs';
import * as semver from 'semver';
import * as tl from 'vsts-task-lib/task';
import * as trm from 'vsts-task-lib/toolrunner';
const cmp = require('semver-compare');
const uuidV4 = require('uuid/v4');

declare let rest;

let pkg = require(path.join(__dirname, 'package.json'));
let userAgent = 'vsts-task-installer/' + pkg.version;
let http: httpm.HttpClient = new httpm.HttpClient(userAgent);

export function debug(...params: string[]) {
    console.log('[debug]' + params.join(' '));
}


export function prependPath(toolPath: string) {
    debug('prepend path:', toolPath);
    // TODO: should we enforce?
    if (!tl.exist(toolPath)) {
        throw new Error('Path does not exist: ' + toolPath);
    }

    // TODO: colon works on windows right?
    let newPath: string = toolPath + ':' + process.env['PATH'];
    debug('new Path:', newPath);
    process.env['PATH'] = newPath;

    // instruct the agent to set this path on future tasks
    console.log('##vso[task.prependpath]' + toolPath);
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
    debug('isExplicit: ', c);

    let valid = semver.valid(c) != null;
    debug('explicit?', valid + '');

    return valid;
}

/**
 * evaluates a list of versions and returns the latest version matching the version spec
 * 
 * @param versions      an array of versions to evaluate
 * @param versionSpec   a version spec (e.g. 1.x)
 */
export function evaluateVersions(versions: string[], versionSpec: string): string {
    let version: string;
    debug('evaluating', versions.length + '', 'versions');
    versions = versions.sort(cmp);
    for (let i=0; i<versions.length; i++) {
        let potential: string = versions[i];
        let satisfied: boolean = semver.satisfies(potential, versionSpec);
        //debug(potential, 'satisfies', versionRange, '?', satisfied + '');
        if (satisfied) {
            version = potential;
        }
    }
    
    return version;
}

//-----------------------------
// Local Tool Cache Functions
//-----------------------------
/**
 * finds the path to a tool in the local installed tool cache
 * 
 * @param toolName  name of the tool
 * @param version   version to get the path of
 * @param arch      optional arch.  defaults to arch of computer
 */
export function findLocalTool(toolName: string, version: string, arch?: string) {
    let cacheRoot = _getCacheRoot();
    debug('cacheRoot:', cacheRoot);

    arch = arch || os.arch();

    let installedPath: string;
    let cachePath = path.join(cacheRoot, toolName, version, arch);
    debug('cachePath:', cachePath);

    if (fs.existsSync(cachePath)) {
        installedPath = cachePath;
    }
    debug('installedPath:', installedPath);

    return installedPath;
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
                if (tl.exist(fullPath)) {
                    versions.push(semver.clean(child));
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
// TODO: download to TEMP (agent will set TEMP)
// TODO: keep extension intact
// TODO: support 302 redirect
//
/**
 * Download a tool from an url and stream it into a file
 * 
 * @param url       url of tool to download
 * @param fileName  optional fileName.  Should typically not use (will be a guid for reliability)
 */
export async function downloadTool(url: string, fileName?:string): Promise<string> {
    return new Promise<string>(async (resolve, reject) => {
        try {
            debug(fileName);
            fileName = fileName || uuidV4();
            var destPath = path.join(os.tmpdir(), fileName);

            debug('downloading', url);
            debug('destination', destPath);

            if (fs.existsSync(destPath)) {
                throw new Error("Destination file path already exists");
            }

            // TODO: retries
            debug('creating stream');
            let file: NodeJS.WritableStream = fs.createWriteStream(destPath);
            file.on('open', async(fd) => {
                debug('downloading');
                let stream = (await http.get(url)).message.pipe(file);

                stream.on('finish', () => {
                    debug('download complete');
                    resolve(destPath);
                });
            });
            file.on('error', (err) => {
                reject(err);
            })
        }
        catch (error) {
            console.log('ERR!');
            reject(error);
        }
    });
}

//---------------------
// Install Functions
//---------------------
function _ensureToolPath(tool:string, version: string, arch?: string): string {
    let destFolder = path.join(_getCacheRoot(), tool, version, arch);
    tl.mkdirP(destFolder);

    return destFolder;
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
                               arch?: string) {
    debug('caching directory');
    arch = arch || os.arch();

    debug('source:', sourceDir);
    if (!tl.stats(sourceDir).isDirectory()) {
        throw new Error('sourceDir is not a directory');
    }

    let destPath: string = _ensureToolPath(tool, version, arch);
    debug('destination', destPath);

    // copy each child item. do not move. move can fail on Windows
    // due to anti-virus software having an open handle on a file.
    for (let itemName of fs.readdirSync(sourceDir)) {
        let s = path.join(sourceDir, itemName);
        tl.cp(s, destPath + '/', '-r');
    }

    debug('copied');
}

/**
 * Caches a downloaded file (GUID) and installs it
 * into the tool cache with a given targetName
 * 
 * @param sourceFile    the file to cache into tools.  Typically a result of downloadTool which is a guid. 
 * @param targetFile    the name of the file name in the toolCache
 * @param tool          tool name  
 * @param version       version of the tool.  semver format
 * @param arch          architecture of the tool.  Optional.  Defaults to machine architecture 
 */
export async function cacheFile(sourceFile: string,
                                targetFile: string,
                                tool: string,
                                version: string,
                                arch?: string) {
    debug('caching file');
    arch = arch || os.arch();

    debug('source:', sourceFile);
    if (!tl.stats(sourceFile).isFile()) {
        throw new Error('sourceFile is not a file');
    }

    let destFolder: string = _ensureToolPath(tool, version, arch);

    let destPath: string = path.join(destFolder, targetFile);
    debug('destination', destPath);

    // copy instead of move. move can fail on Windows due to
    // anti-virus software having an open handle on a file.
    tl.cp(sourceFile, destPath);
    debug('copied');
}

//---------------------
// Extract Functions
//---------------------

/**
 * installs a tool from a tar by extracting the tar and installing it into the tool cache
 * 
 * @param file      file path of the tar 
 * @param tool      name of tool in the tool cache
 * @param version   version of the tool
 * @param arch      arch of the tool.  optional.  defaults to the arch of the machine
 * @param options   IExtractOptions
 */
export async function extractTar(file: string): Promise<string> {

    // mkdir -p node/4.7.0/x64
    // tar xzC ./node/4.7.0/x64 -f node-v4.7.0-darwin-x64.tar.gz --strip-components 1
    
    debug('extracting tar');
    let dest = _createExtractFolder(path.dirname(file));

    let tr:trm.ToolRunner = tl.tool('tar');
    tr.arg(['xzC', dest, '-f', file]);
    
    await tr.exec();
    return dest;
}

export async function extractZip(file: string): Promise<string> {
    if (!file) {
        throw new Error("parameter 'file' is required");
    }

    debug('extracting zip');
    let dest = _createExtractFolder(path.dirname(file));

    if (process.platform == 'win32') {
        // build the powershell command
        let escapedFile = file.replace(/'/g, "''") // double-up single quotes
        let escapedDest = dest.replace(/'/g, "''");
        let command: string = `$ErrorActionPreference = 'Stop' ; try { Add-Type -AssemblyName System.IO.Compression.FileSystem } catch { } ; [System.IO.Compression.ZipFile]::ExtractToDirectory('${escapedFile}', '${escapedDest}')`;

        // change the console output code page to UTF-8.
        // TODO: FIX WHICH: let chcpPath = tl.which('chcp.com', true);
        let chcpPath = path.join(process.env.windir, "system32", "chcp.com");
        await tl.exec(chcpPath, '65001');

        // run powershell
        let powershellPath = tl.which('powershell', true);
        let powershell: trm.ToolRunner = tl.tool(powershellPath)
            .line('-NoLogo -Sta -NoProfile -NonInteractive -ExecutionPolicy Unrestricted -Command')
            .arg(command);
        await powershell.exec();
    }
    else {
    }

    return dest;    
}

function _createExtractFolder(folder: string): string {
    // extract in same folder as the tar to a guid folder to avoid conflicts
    let dest = path.join(folder, uuidV4());
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
 */
export async function scrape(url: string, regex: RegExp): Promise<string[]> {
    let output: string = await (await http.get(url)).readBody();

    let matches = output.match(regex);
    
    let seen: any = {};
    let versions: string[] = [];
    for (let i=0; i < matches.length; i++) {
        let ver: string = semver.clean(matches[i]);
        if (!seen.hasOwnProperty(ver)) {
            seen[ver]=true;
            versions.push(ver);
        }
    }

    return versions;
}

function _getCacheRoot(): string {
    let cacheRoot = process.env['AGENT_TOOLCACHE'];
    if (!cacheRoot) {
        throw new Error('Agent.ToolCache not set.  Should have been set by the agent.  Try updating your agent.');
    }
    return cacheRoot;
}

