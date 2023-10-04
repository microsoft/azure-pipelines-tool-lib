import assert = require('assert');
import path = require('path');
import fs = require('fs');
import shell = require('shelljs');
import os = require('os');
import hm = require('typed-rest-client/Handlers');

import * as mocha from 'mocha';
process.env['AGENT_VERSION'] = '2.115.0';
import * as tl from 'azure-pipelines-task-lib/task';
import * as trm from 'azure-pipelines-task-lib/toolrunner';
import * as toolLib from '../../_build/tool';

let cachePath = path.join(process.cwd(), 'CACHE');
let tempPath = path.join(process.cwd(), 'TEMP');

describe('Tool Tests', function () {
    before(function () {

    });

    after(function () {

    });

    beforeEach(function () {
        tl.rmRF(cachePath);
        tl.rmRF(tempPath);
        tl.mkdirP(cachePath);
        tl.mkdirP(tempPath);
    })

    it('downloads a 100 byte file', function () {

        return new Promise<void>(async (resolve, reject) => {
            try {
                let downPath: string = await toolLib.downloadTool("https://httpbingo.org/bytes/100");
                toolLib.debug('downloaded path: ' + downPath);

                assert(tl.exist(downPath), 'downloaded file exists');
                assert.equal(fs.statSync(downPath).size, 100, 'downloaded file is the correct size');

                resolve();
            }
            catch (err) {
                reject(err);
            }
        });
    });

    it('downloads a 100 byte file after a redirect', function () {

        return new Promise<void>(async (resolve, reject) => {
            try {
                let downPath: string = await toolLib.downloadTool("https://httpbingo.org/redirect-to?url=" + encodeURI('https://httpbingo.org/bytes/100') + "&status_code=302");
                toolLib.debug('downloaded path: ' + downPath);

                assert(tl.exist(downPath), 'downloaded file exists');
                assert.equal(fs.statSync(downPath).size, 100, 'downloaded file is the correct size');

                resolve();
            }
            catch (err) {
                reject(err);
            }
        });
    });

    it('downloads to an absolute path', function () {
        this.timeout(5000);

        return new Promise<void>(async(resolve, reject)=> {
            try {
                let tempDownloadFolder: string = 'temp_' + Math.floor(Math.random() * 2000000000);
                let absolutePath: string = path.join(tempPath, tempDownloadFolder);
                let downPath: string = await toolLib.downloadTool("https://httpbingo.org/bytes/100", absolutePath);
                toolLib.debug('downloaded path: ' + downPath);
                
                assert(tl.exist(downPath), 'downloaded file exists');
                assert(absolutePath == downPath);

                resolve();
            }
            catch(err) {
                reject(err);
            }
        });
    });

    it('has status code in exception dictionary for HTTP error code responses', async function() {
        return new Promise<void>(async(resolve, reject)=> {
            try {
                let errorCodeUrl: string = "https://httpbingo.org/status/400";
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
        return new Promise<void>(async(resolve, reject)=> {
            try {
                let statusCodeUrl: string = "https://httpbingo.org/redirect-to?url=https%3A%2F%2Fexample.com%2F&status_code=302";
                let downPath: string = await toolLib.downloadTool(statusCodeUrl);

                resolve();
            } 
            catch (err){        
                reject(err);
            }
        });
    });

    it('installs a binary tool and finds it', function () {
        this.timeout(2000);

        return new Promise<void>(async (resolve, reject) => {
            try {
                let downPath: string = await toolLib.downloadTool("https://httpbingo.org/bytes/100");
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

    it('finds and evaluates local tool version', function () {
        this.timeout(2000);

        return new Promise<void>(async (resolve, reject) => {
            try {
                let downPath1_1: string = await toolLib.downloadTool("https://httpbingo.org/bytes/100");
                let downPath1_2: string = await toolLib.downloadTool("https://httpbingo.org/bytes/100");

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

    it('download with basic authentication', function () {
        this.timeout(2000);

        return new Promise<void>(async (resolve, reject) => {
            // General parameters:
            let username: string = "usr";
            let correctPassword: string = "pass";
            let url: string = "https://httpbin.org/basic-auth/" + username + "/" + correctPassword;

            // First try downloading with WRONG credentials and verify receiving status code 401:
            try {
                let basicAuthHandler: hm.BasicCredentialHandler[] = [new hm.BasicCredentialHandler(username, "WrongPassword")];
                let downPath: string = await toolLib.downloadTool(url, null, basicAuthHandler);

                reject(new Error('Should have received status code 401 when downloading with bad credentials'));
            }
            catch (err){
                try {
                    assert.equal(err['httpStatusCode'], 401, 'Should have received status code 401 when downloading with bad credentials');

                    // Then try downloading with the CORRECT credentials and verify file downloaded:
                    let basicAuthHandler: hm.BasicCredentialHandler[] = [new hm.BasicCredentialHandler(username, correctPassword)];
                    let downPath: string = await toolLib.downloadTool(url, null, basicAuthHandler);

                    assert(tl.exist(downPath), 'File should have been downloaded');
                    resolve()
                }
                catch (err){
                    reject(err);
                }
            }
        });
    });

    it('Download with retries', async function () {
        this.timeout(2000);

        return new Promise<void>(async (resolve, reject) => {
            try {
                let downPath: string = await toolLib.downloadToolWithRetries("https://httpbingo.org/bytes/100");
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

    it('Should throw error when download fails with retries', async function () {
        return new Promise<void>(async(resolve, reject)=> {
            try {
                let errorCodeUrl: string = "https://httpbingo.org/status/400";
                let downPath: string = await toolLib.downloadToolWithRetries(errorCodeUrl);

                reject('a file was downloaded but it shouldnt have been');
            } 
            catch (err){
                assert.equal(err['httpStatusCode'], 400, 'status code exists');

                resolve();
            }
        });
    });
});
