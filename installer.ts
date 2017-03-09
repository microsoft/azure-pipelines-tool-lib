///<reference path="typings/index.d.ts"/>

//import * as restm from 'typed-rest-client/RestClient';
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

let pkg = require(path.join(__dirname, 'package.json'));
let userAgent = 'vsts-task-installer/' + pkg.version;
let http: httpm.HttpClient = new httpm.HttpClient(userAgent);

export function debug(...params: string[]) {
    console.log('[debug]' + params.join(' '));
}

export function isExplicitVersion(range: string) {
    let c = semver.clean(range);
    debug('isExplicit: ', c);

    let valid = semver.valid(c) != null;
    debug('explit?', valid + '');

    return valid;
}

export function installedPath(toolName: string, version: string, arch?: string) {
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

export function prependPath(toolPath: string) {
    console.log('##vso[path.prepend]' + toolPath);
}

export function evaluateVersions(versions: string[], versionRange: string): string {
    let version: string;
    debug('evaluating', versions.length + '', 'versions');
    versions = versions.sort(cmp);
    for (let i=0; i<versions.length; i++) {
        let potential: string = versions[i];
        let satisfied: boolean = semver.satisfies(potential, versionRange);
        //debug(potential, 'satisfies', versionRange, '?', satisfied + '');
        if (satisfied) {
            version = potential;
        }
    }
    
    return version;
}

export async function downloadTool(url: string, fileName?:string): Promise<string> {
    return new Promise<string>(async (resolve, reject) => {
        try {
            debug(fileName);
            fileName = fileName || uuidV4();
            var destPath = path.join(_getTempPath(), fileName);

            debug('downloading', url);
            debug('destination', destPath);

            // TODO: retries
            if (!fs.existsSync(destPath)) {
                debug('creating stream');
                let file: NodeJS.WritableStream = fs.createWriteStream(destPath);
                debug('downloading');
                let stream = (await http.get(url)).message.pipe(file);

                stream.on('finish', () => {
                    //stream.pipe(file);
                    debug('download complete');
                    resolve(destPath);
                });
            }
        }
        catch (error) {
            console.log('ERR!');
            reject(error);
        }
    });
}

//
// Extract Functions
//
export interface IExtractOptions {
    keepRootFolder: boolean;
}

export async function extractTar(file: string, 
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
//
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

    //versions = versions.sort(cmp);
    return versions;
}

// privates
function _getTempPath(): string {
    // TODO: does agent now set TEMP?  Is there a common var.
    return path.join(__dirname, _getCacheRoot());
}

function _getCacheRoot(): string {
    let cacheRoot = process.env['SYSTEM_TOOLCACHE'];
    if (!cacheRoot) {
        throw new Error('System.ToolCache');
    }
    return cacheRoot;
}

