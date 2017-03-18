/// <reference path="../typings/index.d.ts" />
/// <reference path="../_build/tool.d.ts" />

import assert = require('assert');
import path = require('path');
import fs = require('fs');
import shell = require('shelljs');
import os = require('os');
import * as tl from 'vsts-task-lib/task';
import * as toolLib from '../_build/tool';

let cachePath = path.join(__dirname, 'CACHE');

describe('Tool Tests', function () {
    before(function (done) {
        try {
            process.env['AGENT_TOOLCACHE'] = cachePath;
            toolLib.debug('initializing tests');
        }
        catch (err) {
            assert.fail('cannnot init', 'init', 'Failed to initialize: ' + err.message, 'init');
        }
        done();
    });

    after(function () {

    });

    beforeEach(function () {
        if (tl.exist(cachePath)) {
            tl.rmRF(cachePath);
        }

        tl.mkdirP(cachePath);        
    })

    it('downloads a 100 byte file', function () {
        this.timeout(5000);

        return new Promise<void>(async(resolve, reject)=> {
            try {
                let downPath: string = await toolLib.downloadTool("http://httpbin.org/bytes/100");
                toolLib.debug('downloaded path:', downPath);
                
                assert(tl.exist(downPath), 'downloaded file exists');

                resolve();
            }
            catch(err) {
                reject(err);
            }
        });
    });

    it('installs a binary tool and finds it', function () {
        this.timeout(2000);

        return new Promise<void>(async(resolve, reject)=> {
            try {
                let downPath: string = await toolLib.downloadTool("http://httpbin.org/bytes/100");
                toolLib.debug('downloaded path:', downPath);
                
                assert(tl.exist(downPath), 'downloaded file exists');

                toolLib.cacheFile(downPath, 'foo', 'foo', '1.1.0');

                let toolPath: string = toolLib.findLocalTool('foo', '1.1.0');
                assert(tl.exist(toolPath), 'found tool exists');

                let binaryPath: string = path.join(toolPath, 'foo');
                assert(tl.exist(binaryPath), 'binary should exist');
                resolve();
            }
            catch(err) {
                reject(err);
            }
        });
    });

if (process.platform == 'win32') {
    it('installs a 7z and finds it', function () {
        this.timeout(2000);

        return new Promise<void>(async(resolve, reject)=> {
            try {
                let tempDir = path.join(__dirname, 'test-install-7z');
                tl.mkdirP(tempDir);

                // copy the 7z file to the test dir
                let _7zFile: string = path.join(tempDir, 'test.7z');
                tl.cp(path.join(__dirname, 'data', 'test.7z'), _7zFile);

                // extract/cache
                let extPath: string = await toolLib.extract7z(_7zFile);
                toolLib.cacheDir(extPath, 'my-7z-contents', '1.1.0');
                let toolPath: string = toolLib.findLocalTool('my-7z-contents', '1.1.0');

                assert(tl.exist(toolPath), 'found tool exists');
                assert(tl.exist(path.join(toolPath, 'file.txt')), 'file.txt exists');
                assert(tl.exist(path.join(toolPath, 'file-with-ç-character.txt')), 'file-with-ç-character.txt exists');
                assert(tl.exist(path.join(toolPath, 'folder', 'nested-file.txt')), 'nested-file.txt exists');

                resolve();
            }
            catch(err) {
                reject(err);
            }
        });
    });
}

    it('installs a zip and finds it', function () {
        this.timeout(2000);

        return new Promise<void>(async(resolve, reject)=> {
            try {
                let tempDir = path.join(__dirname, 'test-install-zip');

                // stage the layout for a zip file:
                //   file.txt
                //   folder/nested-file.txt
                let stagingDir = path.join(tempDir, 'zip-staging');
                tl.mkdirP(path.join(stagingDir, 'folder'));
                fs.writeFileSync(path.join(stagingDir, 'file.txt'), '');
                fs.writeFileSync(path.join(stagingDir, 'folder', 'nested-file.txt'), '');

                // create the zip
                let zipFile = path.join(tempDir, 'test.zip');
                if (process.platform == 'win32') {
                    let escapedStagingPath = stagingDir.replace(/'/g, "''") // double-up single quotes
                    let escapedZipFile = zipFile.replace(/'/g, "''");
                    let powershell = tl.tool(tl.which('powershell'))
                        .line('-NoLogo -Sta -NoProfile -NonInteractive -ExecutionPolicy Unrestricted -Command')
                        .arg(`$ErrorActionPreference = 'Stop' ; Add-Type -AssemblyName System.IO.Compression.FileSystem ; [System.IO.Compression.ZipFile]::CreateFromDirectory('${escapedStagingPath}', '${escapedZipFile}')`);
                    powershell.execSync();
                }
                else {
                }

                /* remove if-condition when Mac/Linux support is added */ if (process.platform == 'win32') {
                let extPath: string = await toolLib.extractZip(zipFile);
                toolLib.cacheDir(extPath, 'foo', '1.1.0');
                let toolPath: string = toolLib.findLocalTool('foo', '1.1.0');
                assert(tl.exist(toolPath), 'found tool exists');
                assert(tl.exist(path.join(toolPath, 'file.txt')), 'file.txt exists');
                assert(tl.exist(path.join(toolPath, 'folder', 'nested-file.txt')), 'nested-file.txt exists');
                /* remove if-condition when Mac/Linux support is added */ }

                resolve();
            }
            catch(err) {
                reject(err);
            }
        });
    });

    it('finds and evaluates local tool version', function () {
        this.timeout(2000);

        return new Promise<void>(async(resolve, reject)=> {
            try {
                let downPath1_1: string = await toolLib.downloadTool("http://httpbin.org/bytes/100");
                let downPath1_2: string = await toolLib.downloadTool("http://httpbin.org/bytes/100");
                
                toolLib.cacheFile(downPath1_1, 'foo', 'foo', '1.1.0');
                toolLib.cacheFile(downPath1_2, 'foo', 'foo', '1.2.0');

                let versions: string[] = toolLib.findLocalToolVersions('foo');
                assert(versions.length == 2, 'should have found two versions');
                assert(versions.indexOf('1.1.0') >= 0, 'should have 1.1.0');
                assert(versions.indexOf('1.2.0') >= 0, 'should have 1.2.0');
                
                let latest = toolLib.evaluateVersions(versions, '1.x');
                assert(latest === '1.2.0');

                resolve();
            }
            catch(err) {
                reject(err);
            }
        });
    });

    it('evaluates major match (1.x)', function () {
        this.timeout(2000);

        return new Promise<void>(async(resolve, reject)=> {
            try {
                let versions: string[] = ['1.0.0', '1.1.0', '2.0.0'];
                let latest = toolLib.evaluateVersions(versions, '1.x');
                assert(latest === '1.1.0');

                resolve();
            }
            catch(err) {
                reject(err);
            }
        });
    });

    it('evaluates greater than or equal (>=4.1)', function () {
        this.timeout(2000);

        return new Promise<void>(async(resolve, reject)=> {
            try {
                let versions: string[] = ['4.0.0', '4.1.0', '4.1.1', '5.0.0'];
                let latest = toolLib.evaluateVersions(versions, '>=4.1');
                assert(latest === '5.0.0');

                resolve();
            }
            catch(err) {
                reject(err);
            }
        });
    });

    it('prepends path', function () {
        this.timeout(2000);

        return new Promise<void>(async(resolve, reject)=> {
            try {
                let testDir: string = path.join(__dirname);
                toolLib.prependPath(testDir);
                let currPath: string = process.env['PATH'];
                toolLib.debug(currPath);
                assert(currPath.indexOf(testDir) == 0, 'new path should be first');

                resolve();
            }
            catch(err) {
                reject(err);
            }
        });
    });            
});