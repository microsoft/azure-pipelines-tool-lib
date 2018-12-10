import assert = require('assert');
import path = require('path');
import fs = require('fs');
import nock = require ('nock');
import shell = require('shelljs');
import os = require('os');

import * as mocha from 'mocha';
process.env['AGENT_VERSION'] = '2.115.0';
import * as tl from 'azure-pipelines-task-lib/task';
import * as trm from 'azure-pipelines-task-lib/toolrunner';
import * as toolLib from '../../_build/tool';

let cachePath = path.join(process.cwd(), 'CACHE');
let tempPath = path.join(process.cwd(), 'TEMP');

describe('Tool Tests', function () {
    before(function () {
        nock('http://microsoft.com')
            .persist()
            .get('/bytes/35')
            .reply(200, {
                username: 'abc',
                password: 'def'
                });
    });

    after(function () {

    });

    beforeEach(function () {
        tl.rmRF(cachePath);
        tl.rmRF(tempPath);
        tl.mkdirP(cachePath);
        tl.mkdirP(tempPath);
    })

    if (process.env['TF_BUILD']) {
        // this test verifies the expected version of node is being used to run the tests.
        // 5.10.1 is what ships in the 1.x and 2.x agent.
        it('is expected version', (done: MochaDone) => {
            this.timeout(1000);

            console.log('node version: ' + process.version);
            assert(process.version == 'v5.10.1' || process.version == 'v6.10.3' || process.version == 'v8.9.1', 'expected node v5.10.1, v6.10.3, or v8.9.1. actual: ' + process.version);

            done();
        });
    }

    it('downloads a 35 byte file', function () {
        return new Promise<void>(async (resolve, reject) => {
            try {
                let downPath: string = await toolLib.downloadTool("http://microsoft.com/bytes/35");
                toolLib.debug('downloaded path: ' + downPath);

                assert(tl.exist(downPath), 'downloaded file exists');
                assert.equal(fs.statSync(downPath).size, 35, 'downloaded file is the correct size');

                resolve();
            }
            catch (err) {
                reject(err);
            }
        });
    });

    it('downloads a 35 byte file after a redirect', function () {
        nock('http://microsoft.com') 
            .get('/redirect-to')
            .reply(303, undefined, {
                location:'http://microsoft.com/bytes/35'
            });

        return new Promise<void>(async (resolve, reject) => {
            try {
                
                let downPath: string = await toolLib.downloadTool("http://microsoft.com/redirect-to");
                toolLib.debug('downloaded path: ' + downPath);

                assert(tl.exist(downPath), 'downloaded file exists');
                assert.equal(fs.statSync(downPath).size, 35, 'downloaded file is the correct size');

                resolve();
            }
            catch (err) {
                reject(err);
            }
        });
    });

    it('downloads to an aboslute path', function () {
        return new Promise<void>(async(resolve, reject)=> {
            try {
                let tempDownloadFolder: string = 'temp_' + Math.floor(Math.random() * 2000000000);
                let aboslutePath: string = path.join(tempPath, tempDownloadFolder);
                let downPath: string = await toolLib.downloadTool("http://microsoft.com/bytes/35", aboslutePath);
                toolLib.debug('downloaded path: ' + downPath);
                
                assert(tl.exist(downPath), 'downloaded file exists');
                assert(aboslutePath == downPath);

                resolve();
            }
            catch(err) {
                reject(err);
            }
        });
    });

    it('has status code in exception dictionary for HTTP error code responses', async function() {
        nock('http://microsoft.com')
            .get('/bytes/bad')
            .reply(400, {
                username: 'bad',
                password: 'file'
            });

        return new Promise<void>(async(resolve, reject)=> {
            try {
                let errorCodeUrl: string = "http://microsoft.com/bytes/bad";
                let downPath: string = await toolLib.downloadTool(errorCodeUrl);

                reject('a file was downloaded but it shouldnt have been');
            } 
            catch (err){
                assert.equal(err['httpStatusCode'], 400, 'status code exists');

                resolve();
            }
        });
    });

    it('works with redirect code 302', async function () {
        nock('http://microsoft.com') 
            .get('/redirect-to')
            .reply(302, undefined, {
                location:'http://microsoft.com/bytes/35'
            });
        return new Promise<void>(async(resolve, reject)=> {
            try {
                let statusCodeUrl: string = "http://microsoft.com/redirect-to";
                let downPath: string = await toolLib.downloadTool(statusCodeUrl);

                resolve();
            } 
            catch (err){        
                reject(err);
            }
        });
    });

    it('installs a binary tool and finds it', function () {
        return new Promise<void>(async (resolve, reject) => {
            try {
                let downPath: string = await toolLib.downloadTool("http://microsoft.com/bytes/35");
                toolLib.debug('downloaded path: ' + downPath);

                assert(tl.exist(downPath), 'downloaded file exists');

                await toolLib.cacheFile(downPath, 'foo', 'foo', '1.1.0');

                let toolPath: string = toolLib.findLocalTool('foo', '1.1.0');
                assert(tl.exist(toolPath), 'found tool exists');
                assert(tl.exist(`${toolPath}.complete`), 'tool.complete exists');

                let binaryPath: string = path.join(toolPath, 'foo');
                assert(tl.exist(binaryPath), 'binary should exist');
                resolve();
            }
            catch (err) {
                reject(err);
            }
        });
    });

    if (process.platform == 'win32') {
        it('installs a 7z and finds it', function () {
            this.timeout(20000);

            return new Promise<void>(async (resolve, reject) => {
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
                    assert(tl.exist(`${toolPath}.complete`), 'tool.complete exists');
                    assert(tl.exist(path.join(toolPath, 'file.txt')), 'file.txt exists');
                    assert(tl.exist(path.join(toolPath, 'file-with-ç-character.txt')), 'file-with-ç-character.txt exists');
                    assert(tl.exist(path.join(toolPath, 'folder', 'nested-file.txt')), 'nested-file.txt exists');

                    resolve();
                }
                catch (err) {
                    reject(err);
                }
            });
        });

        it('extract 7z using custom 7z tool', function () {
            this.timeout(20000);

            return new Promise<void>(async (resolve, reject) => {
                try {
                    let tempDir = path.join(__dirname, 'test-extract-7z-using-custom-7z-tool');
                    tl.mkdirP(tempDir);

                    // create mock7zr.cmd
                    let mock7zrPath: string = path.join(tempDir, 'mock7zr.cmd');
                    fs.writeFileSync(
                        mock7zrPath,
                        [
                            'echo %* > "%~dp0mock7zr-args.txt"',
                            `"${path.join(__dirname, '../..', 'externals', '7zdec.exe')}" x %5`
                        ].join('\r\n'));

                    // copy the 7z file to the test dir
                    let _7zFile: string = path.join(tempDir, 'test.7z');
                    tl.cp(path.join(__dirname, 'data', 'test.7z'), _7zFile);

                    // extract
                    let extPath: string = await toolLib.extract7z(_7zFile, null, mock7zrPath);

                    // assert
                    assert(tl.exist(extPath), 'found tool does not exist');
                    assert(tl.exist(path.join(tempDir, 'mock7zr-args.txt')), 'mock7zr-args.txt does not exist');
                    assert.equal(fs.readFileSync(path.join(tempDir, 'mock7zr-args.txt')).toString().trim(), `x -bb1 -bd -sccUTF-8 ${_7zFile}`);
                    assert(tl.exist(path.join(extPath, 'file.txt')), 'file.txt does not exist');
                    assert(tl.exist(path.join(extPath, 'file-with-ç-character.txt')), 'file-with-ç-character.txt does not exist');
                    assert(tl.exist(path.join(extPath, 'folder', 'nested-file.txt')), 'nested-file.txt does not exist');

                    resolve();
                }
                catch (err) {
                    reject(err);
                }
            });
        });
    }

    it('installs a zip and finds it', function () {
        this.timeout(2000);

        return new Promise<void>(async (resolve, reject) => {
            try {
                let tempDir = path.join(__dirname, 'test-install-zip');
                tl.mkdirP(tempDir);

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
                    let powershell = tl.tool(tl.which('powershell', true))
                        .line('-NoLogo -Sta -NoProfile -NonInteractive -ExecutionPolicy Unrestricted -Command')
                        .arg(`$ErrorActionPreference = 'Stop' ; Add-Type -AssemblyName System.IO.Compression.FileSystem ; [System.IO.Compression.ZipFile]::CreateFromDirectory('${escapedStagingPath}', '${escapedZipFile}')`);
                    powershell.execSync();
                }
                else {
                    let zip = tl.tool('zip')
                        .arg(zipFile)
                        .arg('-r')
                        .arg('.');
                    zip.execSync(<trm.IExecOptions>{ cwd: stagingDir });
                }

                let extPath: string = await toolLib.extractZip(zipFile);
                toolLib.cacheDir(extPath, 'foo', '1.1.0');
                let toolPath: string = toolLib.findLocalTool('foo', '1.1.0');
                assert(tl.exist(toolPath), 'found tool exists');
                assert(tl.exist(`${toolPath}.complete`), 'tool.complete exists');
                assert(tl.exist(path.join(toolPath, 'file.txt')), 'file.txt exists');
                assert(tl.exist(path.join(toolPath, 'folder', 'nested-file.txt')), 'nested-file.txt exists');

                resolve();
            }
            catch (err) {
                reject(err);
            }
        });
    });

    it('installs a zip and extracts it to specified directory', function () {
        this.timeout(2000);

        return new Promise<void>(async (resolve, reject) => {
            try {
                let tempDir = path.join(__dirname, 'test-install-zip');
                tl.mkdirP(tempDir);

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
                    let powershell = tl.tool(tl.which('powershell', true))
                        .line('-NoLogo -Sta -NoProfile -NonInteractive -ExecutionPolicy Unrestricted -Command')
                        .arg(`$ErrorActionPreference = 'Stop' ; Add-Type -AssemblyName System.IO.Compression.FileSystem ; [System.IO.Compression.ZipFile]::CreateFromDirectory('${escapedStagingPath}', '${escapedZipFile}')`);
                    powershell.execSync();
                }
                else {
                    let zip = tl.tool('zip')
                        .arg(zipFile)
                        .arg('-r')
                        .arg('.');
                    zip.execSync(<trm.IExecOptions>{ cwd: stagingDir });
                }

                let destDir = path.join(__dirname, 'unzip-dest');
                tl.mkdirP(destDir);

                let extPath: string = await toolLib.extractZip(zipFile, destDir);
                toolLib.cacheDir(extPath, 'foo', '1.1.0');
                let toolPath: string = toolLib.findLocalTool('foo', '1.1.0');
                assert(tl.exist(toolPath), 'found tool exists');
                assert(tl.exist(`${toolPath}.complete`), 'tool.complete exists');
                assert(tl.exist(path.join(toolPath, 'file.txt')), 'file.txt exists');
                assert(tl.exist(path.join(toolPath, 'folder', 'nested-file.txt')), 'nested-file.txt exists');

                resolve();
            }
            catch (err) {
                reject(err);
            }
        });
    });

    it('finds and evaluates local tool version', function () {
        return new Promise<void>(async (resolve, reject) => {
            try {
                let downPath1_1: string = await toolLib.downloadTool("http://microsoft.com/bytes/35");
                let downPath1_2: string = await toolLib.downloadTool("http://microsoft.com/bytes/35");

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
            catch (err) {
                reject(err);
            }
        });
    });

    it('evaluates major match (1.x)', function () {
        this.timeout(2000);

        return new Promise<void>(async (resolve, reject) => {
            try {
                let versions: string[] = ['1.0.0', '1.1.0', '2.0.0'];
                let latest = toolLib.evaluateVersions(versions, '1.x');
                assert(latest === '1.1.0');

                resolve();
            }
            catch (err) {
                reject(err);
            }
        });
    });

    it('evaluates greater than or equal (>=4.1)', function () {
        this.timeout(2000);

        return new Promise<void>(async (resolve, reject) => {
            try {
                let versions: string[] = ['4.0.0', '4.1.0', '4.1.1', '5.0.0'];
                let latest = toolLib.evaluateVersions(versions, '>=4.1');
                assert(latest === '5.0.0');

                resolve();
            }
            catch (err) {
                reject(err);
            }
        });
    });

    it('prepends path', function () {
        this.timeout(2000);

        return new Promise<void>(async (resolve, reject) => {
            try {
                let testDir: string = path.join(__dirname);
                toolLib.prependPath(testDir);
                let currPath: string = process.env['PATH'];
                toolLib.debug(currPath);
                assert(currPath.indexOf(testDir) == 0, 'new path should be first');

                resolve();
            }
            catch (err) {
                reject(err);
            }
        });
    });

    it("works with a 502 temporary failure", async function() {
        this.timeout(5000);
        nock('http://microsoft.com')
            .get('/temp502')
            .twice()
            .reply(502, undefined);
        nock('http://microsoft.com')
            .get('/temp502')
            .reply(200, undefined);

        return new Promise<void>(async (resolve, reject) => {
            try {
                let statusCodeUrl: string = "http://microsoft.com/temp502";
                let downPath: string = await toolLib.downloadTool(statusCodeUrl);

                resolve();
            } catch (err) {
                reject(err);
            }
        });
    });

    it("doesn't retry 502s more than 3 times", async function() {
        this.timeout(5000);
        nock('http://microsoft.com')
            .get('/perm502')
            .times(3)
            .reply(502, undefined);

        return new Promise<void>(async (resolve, reject) => {
            try {
                let statusCodeUrl: string = "http://microsoft.com/perm502";
                let downPath: string = await toolLib.downloadTool(statusCodeUrl);

                reject('Shouldnt have succeeded');
            } catch (err) {
                if (err['httpStatusCode'] && err['httpStatusCode'] == 502) {
                    resolve();
                }
                reject(err);
            }
        });
    });
});