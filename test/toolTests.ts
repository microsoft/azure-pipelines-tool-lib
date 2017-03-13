/// <reference path="../typings/index.d.ts" />
/// <reference path="../_build/tool.d.ts" />

import assert = require('assert');
import path = require('path');
import fs = require('fs');
import shell = require('shelljs');
import os = require('os');
import * as tl from 'vsts-task-lib/task';
import * as toolLib from '../_build/tool';

//import * as testutil from './testutil';

let cachePath = path.join(__dirname, 'CACHE');

describe('Download Tests', function () {
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
        this.timeout(2000);

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

                toolLib.installBinary(downPath, 'foo', '1.1.0');

                let toolPath: string = toolLib.findLocalTool('foo', '1.1.0');

                assert(tl.exist(toolPath), 'found tool exists');
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
                let downPath: string = await toolLib.downloadTool("http://httpbin.org/bytes/100");
                toolLib.debug('downloaded path:', downPath);
                
                assert(tl.exist(downPath), 'downloaded file exists');

                toolLib.installBinary(downPath, 'foo', '1.1.0');
                toolLib.installBinary(downPath, 'foo', '1.2.0');
                toolLib.installBinary(downPath, 'foo', '2.0.0');

                let versions: string[] = toolLib.findLocalToolVersions('foo');
                assert(versions.length == 3, 'should have found two versions');
                assert(versions.indexOf('1.1.0') >= 0, 'should have 1.1.0');
                assert(versions.indexOf('1.2.0') >= 0, 'should have 1.2.0');
                assert(versions.indexOf('2.0.0') >= 0, 'should have 2.0.0');
                
                let latest = toolLib.evaluateVersions(versions, '1.x');
                assert(latest === '1.2.0');

                resolve();
            }
            catch(err) {
                reject(err);
            }
        });
    });
});