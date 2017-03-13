import * as toolLib from './tool';
import * as restm from 'typed-rest-client/RestClient';
import * as os from 'os';
import * as path from 'path';

// setting cache dir to this folder. 
// tasks don't need to do this - agent will set this.
// let cacheDir = path.join(__dirname, 'CACHE');
// process.env['AGENT_TOOLCACHE'] = cacheDir;
// tl.mkdirP(cacheDir);

async function run() {
    try {
        // explicit version
        await getNode('4.7.0', false);

        // query, filter and only LTS
        await getNode('4.x', true);

        // complex versionSpecs supported
        // await getNode('9.x || >=4.7.0', true);
    }
    catch (error) {
        console.error('ERR:' + error.message);
    }
}

//
// Node versions interface
// see https://nodejs.org/dist/index.json
//
interface INodeVersion {
    version: string,
    lts: any,
    files: string[]
}

let osPlat: string = os.platform();
let osArch: string = os.arch();

async function getNode(versionSpec: string, onlyLTS: boolean) {
    console.log();
    console.log('--------------------------');
    console.log(versionSpec);
    console.log('--------------------------');

    let version: string = versionSpec;
    if (toolLib.isExplicitVersion(versionSpec)) {
        // given exact version to get
        toolLib.debug('explicit match', versionSpec);
    }
    else {
        // let's query for version
        // If your tool doesn't offer a mechanism to query, 
        // then it can only support exact version inputs
        let versions: string[] = [];

        // hopefully your tool supports an easy way to get a version list.
        // node offers a json list of versions
        let dataFileName: string;
        switch (osPlat) {
            case "linux": dataFileName = "linux-" + osArch; break;
            case "darwin": dataFileName = "osx-" + osArch + '-tar'; break;
            case "win32": dataFileName = "win-" + osArch; break;
        }

        let dataUrl = "https://nodejs.org/dist/index.json";
        let ltsMap : {[version: string]: string} = {};
        let rest: restm.RestClient = new restm.RestClient('tool-sample');
        let nodeVersions: INodeVersion[] = (await rest.get<INodeVersion[]>(dataUrl)).result;
        nodeVersions.forEach((nodeVersion:INodeVersion) => {
            // ensure this version supports your os and platform
            let compatible: boolean = nodeVersion.files.indexOf(dataFileName) >= 0;

            if (compatible) {
                if (!onlyLTS || (nodeVersion.lts && onlyLTS)) {
                    versions.push(nodeVersion.version);
                }
                
                if (nodeVersion.lts) {
                    ltsMap[nodeVersion.version] = nodeVersion.lts;
                }
            }
        });

        version = toolLib.evaluateVersions(versions, versionSpec);
        toolLib.debug('version from index.json', version);
        toolLib.debug('isLTS:' + ltsMap[version]);

        //
        // If there is no data driven way to get versions supported,
        // a last option is to tool.scrape() with a regex
        //
        let scrapeUrl = 'https://nodejs.org/dist/';
        let re: RegExp = /v(\d+\.)(\d+\.)(\d+)/g;
        versions = await toolLib.scrape(scrapeUrl, re);

        version = toolLib.evaluateVersions(versions, versionSpec);
        if (!version) {
            throw new Error('Could not satisfy version range ' + versionSpec);
        }
    }
    

    let toolPath: string = toolLib.findLocalTool('node', version);
    if (!toolPath) {
        // not installed
        toolLib.debug('download ' + version);

        // a tool installer intimately knows how to get that tools (and construct urls)
        let urlFileName: string = osPlat == 'win32'? 'node-v' + version + '-win-' + os.arch() + '.7z':
                                            'node-v' + version + '-' + osPlat + '-' + os.arch() + '.tar.gz';  
        let downloadUrl = 'https://nodejs.org/dist/v' + version + '/' + urlFileName; 

        // a real task would not pass file name as it would generate in temp (better)
        let downloadPath: string = await toolLib.downloadTool(downloadUrl, urlFileName);
        console.log((new Date()).toISOString());
        await toolLib.installTar(downloadPath, 'node', version);

        // a tool installer initimately knows details about the layout of that tool
        // for example, node binary is in the bin folder after the extract.
        // layouts could change by version, by platform etc... but that's the tool installers job
        toolPath = toolLib.findLocalTool('node', version);
        toolPath = path.join(toolPath, 'bin');
    }

    console.log((new Date()).toISOString());
    toolLib.prependPath(toolPath);
    console.log();
}

run();
