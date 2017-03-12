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

describe('Download Tests', function () {
    before(function (done) {
        try {
            let cachePath = path.join(__dirname, 'CACHE');
            tl.mkdirP(cachePath);
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

    // it('fails if mkdirP with illegal chars', function (done) {
    //     this.timeout(1000);

    //     var testPath = path.join(testutil.getTestTemp(), 'mkdir\0');
    //     var worked: boolean = false;
    //     var threwException: boolean = false;
    //     try {
    //         tl.mkdirP(testPath);
    //         worked = true;
    //     }
    //     catch (err) {
    //         threwException = true;
    //     }

    //     assert(!worked, 'should not have worked');
    //     assert(threwException, 'threw an exception');

    //     done();
    // });
});