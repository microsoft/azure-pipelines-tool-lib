import * as installer from './installer';
import * as os from 'os';

async function testNode(rangeInput: string) {
    console.log();
    console.log('--------------------------');
    console.log(rangeInput);
    console.log('--------------------------');

    let version: string = rangeInput;
    if (installer.isExplicitVersion(rangeInput)) {
        // given exact version to get
        installer.debug('explicit match', rangeInput);
    }
    else {
        // let's query for version
        // If your tool doesn't offer a mechanism to query, then it can only support exact version inputs

        let re: RegExp = /v(\d+\.)(\d+\.)(\d+)/g;
        let versions: string[] = await installer.scrape('https://nodejs.org/dist/', re);
        version = installer.evaluateVersions(versions, rangeInput);
        if (!version) {
            throw new Error('Could not satisfy version range ' + rangeInput);
        }
    }
    

    let toolPath: string = installer.installedPath('node', version);
    if (!toolPath) {
        // not installed
        console.log('download ' + version);
        let plat: string = os.platform();
        let ext: string = plat == 'win32'? 'node-v' + version + '-win-' + os.arch() + '.7z':
                                            'node-v' + version + '-' + plat + '-' + os.arch() + '.tar.gz';  
        let downloadUrl = 'https://nodejs.org/dist/v' + version + '/' + ext; 

        // a real task would not pass file name as it would generate in temp (better)
        await installer.downloadTool(downloadUrl, ext);

        
    }

    installer.prependPath(toolPath);
    console.log();
}

async function run() {
    try {
        await testNode('4.7.0');
        await testNode('4.x');
        await testNode('9.x || >=4.7.0');
    }
    catch (error) {
        console.error('ERR:' + error.message);
    }

}

run();
