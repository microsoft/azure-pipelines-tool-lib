require('shelljs/make');
var fs = require('fs');
var path = require('path');
var tl = require('vsts-task-lib/task');
var os = require('os');
var xml2js = require('xml2js');

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
var cultures = [ 'en-US', 'de-DE', 'es-ES', 'fr-FR', 'it-IT', 'ja-JP', 'ko-KR', 'ru-RU', 'zh-CN', 'zh-TW' ];

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
    cp(rp('Invoke-7zdec.ps1'), buildPath);
    cp(rp('lib.json'), buildPath);
    cp('-R', rp('externals'), buildPath);
    cp('-Rf', rp('Strings'), buildPath);
    // just a bootstrap file to avoid /// in final js and .d.ts file
    rm(path.join(buildPath, 'index.*'));
}

target.loc = function() {
    // create a key->value map of the default strings
    var defaultStrings = { };
    var lib = JSON.parse(fs.readFileSync(path.join(__dirname, 'lib.json')));
    if (lib.messages) {
        for (var key of Object.keys(lib.messages)) {
            defaultStrings[`loc.messages.${key}`] = lib.messages[key];
        }
    }

    // create the culture-specific resjson files
    for (var culture of cultures) {
        // initialize the culture-specific strings from the default strings
        var cultureStrings = { };
        for (var key of Object.keys(defaultStrings)) {
            // skip resjson-style comments for localizers
            if (!key || key.match(/^_.+\.comment$/)) {
                continue;
            }

            cultureStrings[key] = defaultStrings[key];
        }

        // load the culture-specific xliff file
        var xliffPath = path.join(__dirname, 'xliff', `${culture}.xlf`);
        var stats;
        try {
            stats = fs.statSync(xliffPath);
        }
        catch (err) {
            if (err.code != 'ENOENT') {
                throw err;
            }
        }

        if (stats) {
            // parse the culture-specific xliff contents
            var parser = new xml2js.Parser();
            var xliff;
            parser.parseString(
                fs.readFileSync(xliffPath),
                function (err, result) {
                    if (err) {
                        throw err;
                    }

                    xliff = result;
                });

            // overlay the translated strings
            for (var unit of xliff.xliff.file[0].body[0]['trans-unit']) {
                if (unit.target[0].$.state == 'translated' &&
                    defaultStrings.hasOwnProperty(unit.$.id) &&
                    defaultStrings[unit.$.id] == unit.source[0]) {

                    cultureStrings[unit.$.id] = unit.target[0]._;
                }
            }
        }

        // write the culture-specific resjson file
        var resjsonPath = path.join(__dirname, 'Strings', 'resources.resjson', culture, 'resources.resjson');
        var resjsonContents = JSON.stringify(cultureStrings, null, 2);
        tl.mkdirP(path.dirname(resjsonPath));
        fs.writeFileSync(resjsonPath, resjsonContents);
    }
}

target.test = function() {
    target.build();

    run('tsc -p ./test --outDir ' + testPath, true);
    cp('-R', path.join(__dirname, 'test', 'data'), testPath);
    //cp('-Rf', rp('test/scripts'), testPath);
    run('mocha ' + testPath + ' --recursive', true);
}

// run the sample
// building again is the way to clear the tool cache (creates it in the build dir)
target.sample = function() {
    tl.pushd(buildPath);
    
    // creating a cache dir in the build dir.  agent would do this
    let cacheDir = path.join(process.cwd(), 'CACHE');
    process.env['AGENT_TOOLSDIRECTORY'] = cacheDir;
    tl.mkdirP(cacheDir);

    // redirecting TEMP (agent would do this per build)
    let tempDir = path.join(process.cwd(), 'TEMP');
    let tempName = os.platform == 'win32' ? "TEMP" : "TMPDIR";
    process.env[tempName] = tempDir;
    tl.mkdirP(tempDir);   

    run('node sample.js', true);
    tl.popd();
}

target.handoff = function() {
    // create a key->value map of default strings
    var defaultStrings = { };
    var lib = JSON.parse(fs.readFileSync(path.join(__dirname, 'lib.json')));
    if (lib.messages) {
        for (var key of Object.keys(lib.messages)) {
            // skip resjson-style comments for localizers
            if (!key || key.match(/^_.+\.comment$/)) {
                continue;
            }

            defaultStrings[`loc.messages.${key}`] = lib.messages[key];
        }
    }

    // create a key->value map of comments for localizers
    //
    // resjson-style comments for localizers:
    //   "greeting": "Hello",
    //   "_greeting.comment": "A welcome greeting.",
    //
    // for more details about resjson: https://msdn.microsoft.com/en-us/library/windows/apps/hh465254.aspx
    var comments = { };
    if (lib.messages) {
        for (var commentKey of Object.keys(lib.messages)) {
            if (commentKey && commentKey.match(/^_.+\.comment$/)) {
                valueKey = commentKey.substr('_'.length, commentKey.length - '_.comment'.length);
                comments[`loc.messages.${valueKey}`] = lib.messages[commentKey];
            }
        }
    }

    // create or update the culture-specific xlf files
    for (var culture of cultures) {
        // test whether xliff file exists
        var xliffPath = path.join(__dirname, 'xliff', `${culture}.xlf`);
        var stats;
        try {
            stats = fs.statSync(xliffPath);
        }
        catch (err) {
            if (err.code != 'ENOENT') {
                throw err;
            }
        }

        var xliff;
        if (stats) {
            // parse the file
            var parser = new xml2js.Parser();
            parser.parseString(
                fs.readFileSync(xliffPath),
                function (err, result) {
                    if (err) {
                        throw err;
                    }

                    xliff = result;
                }
            )
        }
        else {
            // create the initial xliff object
            xliff = {
                "xliff": {
                    "$": {
                        "version": "1.2"
                    },
                    "file": [
                        {
                            "$": {
                                "original": "lib.json",
                                "source-language": "en-US",
                                "target-language": culture,
                                "datatype": "plaintext"
                            },
                            "body": [
                                {
                                    "trans-unit": [ ]
                                }
                            ]
                        }
                    ]
                }
            }
        }

        // create a map of trans-unit
        var unitMap = { };
        for (var unit of xliff.xliff.file[0].body[0]['trans-unit']) {
            unitMap[unit.source[0]] = unit;
        }

        for (var key of Object.keys(defaultStrings)) {
            // add the trans-unit
            if (!unitMap.hasOwnProperty(key)) {
                unitMap[key] = {
                    "$": {
                        "id": key
                    },
                    "source": [
                        defaultStrings[key]
                    ],
                    "target": [
                        {
                            "$": {
                                "state": "new"
                            },
                            "_": defaultStrings[key]
                        }
                    ],
                    "note": [
                        (comments[key] || "")
                    ]
                };
            }
            // update the trans-unit
            else if (unitMap[key].source[0] != defaultStrings[key]) {
                unitMap[key].target = [
                    {
                        "$": {
                            "state": "needs-translation"
                        },
                        "_": defaultStrings[key]
                    }
                ];
                unitMap[key].note = [
                    (comments[key] || "")
                ];
            }
        }

        for (var key of Object.keys(unitMap)) {
            // delete the trans-unit
            if (!defaultStrings.hasOwnProperty(key)) {
                delete unitMap[key];
            }
        }

        // update the body of the xliff object
        xliff.xliff.file[0].body[0]['trans-unit'] = [ ];
        for (var key of Object.keys(unitMap)) {
            xliff.xliff.file[0].body[0]['trans-unit'].push(unitMap[key]);
        }

        // write the xliff file
        var options = {
            "renderOpts": {
                "pretty": true,
                "indent": "  ",
                "newline": os.EOL
            },
            "xmldec": {
                "version": "1.0",
                "encoding": "UTF-8"
            }
        };
        var builder = new xml2js.Builder(options);
        var xml = builder.buildObject(xliff);
        mkdir('-p', path.dirname(xliffPath));
        fs.writeFileSync(xliffPath, xml);
    }
}