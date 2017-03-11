import * as toolLib from './tool';
import * as os from 'os';

async function testNode(rangeInput: string) {
    console.log();
    console.log('--------------------------');
    console.log(rangeInput);
    console.log('--------------------------');

    let version: string = rangeInput;
    if (toolLib.isExplicitVersion(rangeInput)) {
        // given exact version to get
        toolLib.debug('explicit match', rangeInput);
    }
    else {
        // let's query for version
        // If your tool doesn't offer a mechanism to query, 
        // then it can only support exact version inputs

        // hopefully your tool supports an easy way to get a version list.
        let dataUrl = "https://nodejs.org/dist/index.json";
        
        // but if there's a download page, a last option is to scrape with a regex
        let scrapeUrl = 'https://nodejs.org/dist/';
        let re: RegExp = /v(\d+\.)(\d+\.)(\d+)/g;
        let versions: string[] = await toolLib.scrape(scrapeUrl, re);

        version = toolLib.evaluateVersions(versions, rangeInput);
        if (!version) {
            throw new Error('Could not satisfy version range ' + rangeInput);
        }
    }
    

    let toolPath: string = toolLib.installedPath('node', version);
    if (!toolPath) {
        // not installed
        console.log('download ' + version);

        // a tool installer intimately knows how to get that tools (and construct urls)
        let plat: string = os.platform();
        let ext: string = plat == 'win32'? 'node-v' + version + '-win-' + os.arch() + '.7z':
                                            'node-v' + version + '-' + plat + '-' + os.arch() + '.tar.gz';  
        let downloadUrl = 'https://nodejs.org/dist/v' + version + '/' + ext; 

        // a real task would not pass file name as it would generate in temp (better)
        let downloadPath: string = await toolLib.downloadTool(downloadUrl, ext);
        toolLib.extractTar(downloadPath, 'node', version);
        toolPath = downloadPath;
    }

    toolLib.prependPath(toolPath);
    console.log();
}

async function run() {
    try {
        await testNode('4.7.0');
        await testNode('4.x');
        // await testNode('9.x || >=4.7.0');
    }
    catch (error) {
        console.error('ERR:' + error.message);
    }

}

run();
