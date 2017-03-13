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

    beforeEach(() => {
        if (tl.exist(cachePath)) {
            tl.rmRF(cachePath);
        }

        tl.mkdirP(cachePath);        
    })

    it('downloads a 100 byte file', () => {
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

    it('installs a binary tool and finds it', () => {
        this.timeout(2000);

        return new Promise<void>(async(resolve, reject)=> {
            try {
                let downPath: string = await toolLib.downloadTool("http://httpbin.org/bytes/100");
                toolLib.debug('downloaded path:', downPath);
                
                assert(tl.exist(downPath), 'downloaded file exists');

                toolLib.installBinary(downPath, 'foo', '1.1.0', 'foo');

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

    it('finds and evaluates local tool version', () => {
        this.timeout(2000);

        return new Promise<void>(async(resolve, reject)=> {
            try {
                let downPath1_1: string = await toolLib.downloadTool("http://httpbin.org/bytes/100");
                let downPath1_2: string = await toolLib.downloadTool("http://httpbin.org/bytes/100");
                
                toolLib.installBinary(downPath1_1, 'foo', '1.1.0', 'foo');
                toolLib.installBinary(downPath1_2, 'foo', '1.2.0', 'foo');

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

    it('evaluates major match (1.x)', () => {
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

    it('evaluates greater than or equal (>=4.1)', () => {
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

    it('prepends path', () => {
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