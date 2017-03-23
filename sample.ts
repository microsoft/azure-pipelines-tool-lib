import * as toolLib from './tool';
import * as restm from 'typed-rest-client/RestClient';
import * as os from 'os';
import * as path from 'path';

async function run() {
    try {
        // explicit version
        await getNode('6.10.0', false);

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

    //
    // Basic pattern:
    //     version = find and evaluate local versions
    //          use latest match 
    //     if version not found locally
    //          // let's query
    //          if versionSpec is explicit version
    //               versionToGet = versionSpec
    //          else
    //               versionToGet = query and evaluate internet tool provider
    //          
    //          download versionToGet
    //          Extract or move to cache download
    //
    //      find tool path by version
    //      prepend $PATH with toolpath
    //

    //
    // Let's try and resolve the versions spec locally first
    //
    let localVersions: string[] = toolLib.findLocalToolVersions('node');
    let version: string = toolLib.evaluateVersions(localVersions, versionSpec);

    if (version) {
        console.log('Tool version resolved locally: ' + version);
    }
    else {
        //
        // Let's query and resolve the latest version for the versionSpec
        // If the version is an explicit version (1.1.1 or v1.1.1) then no need to query
        // If your tool doesn't offer a mechanism to query, 
        // then it can only support exact version inputs        
        //
        if (toolLib.isExplicitVersion(versionSpec)) {
            // given exact version to get
            toolLib.debug('explicit match ' + versionSpec);
            version = versionSpec;
        }
        else {
            // let's query for version
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

            //
            // get the latest version that matches the version spec
            //
            version = toolLib.evaluateVersions(versions, versionSpec);
            toolLib.debug('version from index.json ' + version);
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

        //
        // Download and Install
        //
        toolLib.debug('download ' + version);

        // a tool installer intimately knows how to get that tools (and construct urls)
        let fileName: string = osPlat == 'win32'? 'node-v' + version + '-win-' + os.arch() :
                                            'node-v' + version + '-' + osPlat + '-' + os.arch();  
        let urlFileName: string = osPlat == 'win32'? fileName + '.7z':
                                                     fileName + '.tar.gz';  

        let downloadUrl = 'https://nodejs.org/dist/v' + version + '/' + urlFileName; 

        let downloadPath: string = await toolLib.downloadTool(downloadUrl);

        //
        // Extract the tar and install it into the local tool cache
        //
        let extPath = await toolLib.extractTar(downloadPath);

        // node extracts with a root folder that matches the fileName downloaded
        let toolRoot = path.join(extPath, fileName);
        
        toolLib.cacheDir(toolRoot, 'node', version);
    }

    console.log('using version: ' + version);

    //
    // a tool installer initimately knows details about the layout of that tool
    // for example, node binary is in the bin folder after the extract.
    // layouts could change by version, by platform etc... but that's the tool installers job
    //    
    let toolPath: string = toolLib.findLocalTool('node', version);    
    toolPath = path.join(toolPath, 'bin');
    console.log('using tool path: ' + toolPath);

    //
    // prepend the tools path. instructs the agent to prepend for future tasks
    //
    toolLib.prependPath(toolPath);
    console.log();
}

run();
