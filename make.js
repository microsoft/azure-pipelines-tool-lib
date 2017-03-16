require('shelljs/make');
var fs = require('fs');
var path = require('path');
var tl = require('vsts-task-lib/task');
var os = require('os');

// util functions
var util = require('./make-util');
var cd = util.cd;
var cp = util.cp;
var mkdir = util.mkdir;
var rm = util.rm;
var test = util.test;
var run = util.run;
var banner = util.banner;
var rp = util.rp;
var fail = util.fail;
var ensureExists = util.ensureExists;
var pathExists = util.pathExists;
var addPath = util.addPath;
var ensureTool = util.ensureTool;

// add node modules .bin to the path so we can dictate version of tsc etc...
var binPath = path.join(__dirname, 'node_modules', '.bin');
if (!test('-d', binPath)) {
    fail('node modules bin not found.  ensure npm install has been run.');
}
addPath(binPath);

var buildPath = path.join(__dirname, '_build');
var testPath = path.join(__dirname, '_test');

target.clean = function() {
    rm('-Rf', buildPath);
    rm('-Rf', testPath);
};

target.build = function() {
    target.clean();
    target.loc();

    run('tsc --version', true);
    run('tsc --outDir ' + buildPath, true);
    //cp(rp('typings.json'), buildPath);
    cp(rp('package.json'), buildPath);
    cp(rp('README.md'), buildPath);
    cp(rp('LICENSE'), buildPath);
    cp(rp('lib.json'), buildPath);
    cp('-Rf', rp('Strings'), buildPath);
    // just a bootstrap file to avoid /// in final js and .d.ts file
    rm(path.join(buildPath, 'index.*'));
}

target.loc = function() {
    var lib = require('./lib.json');
    var strPath = path.join('Strings', 'resources.resjson', 'en-US')
    mkdir('-p', strPath);
    var strings = {};
    if (lib.messages) {
        for (var key in lib.messages) {
            strings['loc.messages.' + key] = lib.messages[key];
        }
    }

    // create the en-US resjson file.
    var enContents = JSON.stringify(strings, null, 2);
    fs.writeFileSync(path.join(strPath, 'resources.resjson'), enContents)
}

target.test = function() {
    target.build();

    run('tsc -p ./test --outDir ' + testPath, true);
    //cp('-Rf', rp('test/scripts'), testPath);
    process.env['TASKLIB_INPROC_UNITS'] = '1'; // export task-lib internals for internal unit testing
    run('mocha ' + testPath + ' --recursive', true);
}

// run the sample
// building again is the way to clear the tool cache (creates it in the build dir)
target.sample = function() {
    tl.pushd(buildPath);
    
    // creating a cache dir in the build dir.  agent would do this
    let cacheDir = path.join(process.cwd(), 'CACHE');
    process.env['AGENT_TOOLCACHE'] = cacheDir;
    tl.mkdirP(cacheDir);

    // redirecting TEMP (agent would do this per build)
    let tempDir = path.join(process.cwd(), 'TEMP');
    let tempName = os.platform == 'win32' ? "TEMP" : "TMPDIR";
    process.env[tempName] = tempDir;
    tl.mkdirP(tempDir);   

    run('node sample.js', true);
    tl.popd();
}