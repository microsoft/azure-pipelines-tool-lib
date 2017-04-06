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
    var lib = require('./lib.json');

    // build the en-US xliff object
    var defaultXliff = {
        "$": {
            "version": "1.2"
        },
        "file": {
            "$": {
                "original": "lib.json",
                "source-language": "en-US",
                "target-language": "en-US",
                "datatype": "plaintext"
            },
            "body": []
        }
    };
    if (lib.messages) {
        for (var key in lib.messages) {
            defaultXliff.file.body.push({
                "trans-unit": {
                    "$": {
                        "id": `loc.messages.${key}`
                    },
                    "source": lib.messages[key],
                    "target": {
                        "$": {
                            "state": "final"
                        },
                        "_": lib.messages[key]
                    }
                }
            })
        }
    }
    var options = {
        "rootName": "xliff",
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
    var xml = builder.buildObject(defaultXliff);

    // write the en-US xliff file
    var xlfPath = path.join(__dirname, 'xliff', 'lib.en-US.xlf');
    mkdir('-p', path.dirname(xlfPath));
    fs.writeFileSync(xlfPath, xml);

    // create a key->value map of the default strings
    var defaultStrings = { };
    for (var unit of defaultXliff.file.body) {
        defaultStrings[unit.$.id] = unit.source;
    }

    // create the resjson files
    var cultures = [ 'en-US', 'de-DE', 'es-ES', 'fr-FR', 'it-IT', 'ja-JP', 'ko-KR', 'ru-RU', 'zh-CN', 'zh-TW' ];
    for (var culture of cultures) {
        // load the culture-specific xliff file
        var xliffPath = path.join(__dirname, 'xliff', `lib.${culture}.xlf`);
        var stats;
        try {
            stats = fs.statSync(xliffPath);
        }
        catch (err) {
            if (err.code == 'ENOENT') {
                continue;
            }

            throw err;
        }

        // parse the culture-specific xliff contents
        var parser = new xml2js.Parser();
        parser.parseString(
            fs.readFileSync(xliffPath),
            function (err, cultureXliff) {
                // initialize the culture-specific strings from the default strings
                var cultureStrings = { };
                for (var key of Object.keys(defaultStrings)) {
                    cultureStrings[key] = defaultStrings[key];
                }

                // overlay the translated strings
                for (var unit of cultureXliff.file.body) {
                    if (unit.target.$.state == 'final' &&
                        defaultStrings.hasOwnProperty(unit.$.id) &&
                        defaultStrings[unit.$.id] == unit.source) {

                        cultureStrings[unit.$.id] = unit.target._;
                    }
                }

                // write the culture-specific resjson file
                var resjsonPath = path.join(__dirname, 'Strings', 'resources.resjson', culture, 'resources.resjson');
                var resjsonContents = JSON.stringify(cultureStrings, null, 2);
                fs.writeFileSync(resjsonPath, resjsonContents);
            });
    }

    // fs.writeFileSync()
    /**
     * build:
     * write en-US xlf file
     * foreach (lang)
     *  foreach (key in en-US file)
     *   if (lang[key].source == en-US[key].source && lang[key].state == final)
     *    lang_resjson[key] = lang[key].target
     *   else
     *    lang_resjson[key] = en-US[key].source
     * 
     * handoff:
     * foreach (lang)
     *  // update
     *  foreach (key in en-US file)
     *   if (lang[key].source != en-US[key].source)
     *    lang[key].source = en-US[key].source
     *    lang[key].state = needs translation
     *  // delete
     *  foreach (key in lang file)
     *   if (!en-US.containsKey(key))
     *     delete lang[key]
     * 
     * handback:
     * merge PR
     * 
     */
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