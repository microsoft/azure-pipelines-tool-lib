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
            var destPath = path.join(_getTempPath(), fileName);

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
// Extract Functions
//---------------------

export interface IExtractOptions {
    keepRootFolder: boolean;
}

// TODO: extract function that does right thing by extension.
//       make download keep the extension intact.

/**
 * Installs a downloaded binary (GUID) and installs it
 * into the tool cache with a given binaryName
 * 
 * @param sourceFile 
 * @param tool 
 * @param version 
 * @param binaryName 
 * @param arch 
 */
export async function installBinary(sourceFile: string,
                                    tool: string,
                                    version: string,
                                    binaryName: string,
                                    arch?: string) {
    debug('installing binary');
    arch = arch || os.arch();
    let destFolder = path.join(_getCacheRoot(), tool, version, arch);
    tl.mkdirP(destFolder);

    let destPath = path.join(destFolder, binaryName);
    debug('destination', destPath);

    tl.mv(sourceFile, destPath);
}

/**
 * installs a tool from a tar by extracting the tar and installing it into the tool cache
 * 
 * @param file      file path of the tar 
 * @param tool      name of tool in the tool cache
 * @param version   version of the tool
 * @param arch      arch of the tool.  optional.  defaults to the arch of the machine
 * @param options   IExtractOptions
 */
export async function installTar(file: string, 
                                 tool: string, 
                                 version: string, 
                                 arch?: string,
                                 options?: IExtractOptions) {

    options = options || <IExtractOptions>{};
    options = <IExtractOptions>{};
    options.keepRootFolder = options.keepRootFolder || false;

    // mkdir -p node/4.7.0/x64
    // tar xzC ./node/4.7.0/x64 -f node-v4.7.0-darwin-x64.tar.gz --strip-components 1
    
    debug('extracting tar');
    arch = arch || os.arch();
    let dest = path.join(_getCacheRoot(), tool, version, arch);
    debug('destination', dest);
    tl.mkdirP(dest);

    let tr:trm.ToolRunner = tl.tool('tar');
    tr.arg(['xzC', dest, '-f', file]);
    if (!options.keepRootFolder) {
        tr.arg(['--strip-components', '1']);
    }
    
    await tr.exec();
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

// privates
function _getTempPath(): string {
    // TODO: does agent now set TEMP?  Is there a common var.
    return _getCacheRoot();
}

function _getCacheRoot(): string {
    let cacheRoot = process.env['AGENT_TOOLCACHE'];
    if (!cacheRoot) {
        throw new Error('Agent.ToolCache not set.  Should have been set by the agent.  Try updating your agent.');
    }
    return cacheRoot;
}

