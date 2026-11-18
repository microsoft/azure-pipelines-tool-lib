import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Writable } from 'stream';
import * as tl from 'azure-pipelines-task-lib/task';
import { commandFromString } from 'azure-pipelines-task-lib/taskcommand';
import * as toolModule from '../../_build/tool';

interface CacheEvent {
    schemaVersion: number;
    libraryVersion: string;
    platform: string;
    operation: string;
    validationEnabled: boolean;
    diagnostic: boolean;
    decision: string;
    parameter: string;
    reason: string;
    outcome: string;
    taskInstanceId?: string;
    jobId?: string;
    planId?: string;
}

const feature = 'DISTRIBUTEDTASK_TASKS_TOOLLIBCACHEPATHVALIDATIONENABLED';
const diagnostic = 'TOOLLIB_CACHEPATHVALIDATIONDIAGNOSTIC';

describe('Cache path telemetry', function () {
    let tool: typeof toolModule;
    let previousModule: NodeModule | undefined;
    let fixture: string;
    let root: string;
    let output: string;
    let environment: { [name: string]: string | undefined };
    const correlationNames = ['SYSTEM_TASKINSTANCEID', 'SYSTEM_JOBID', 'SYSTEM_PLANID'];
    const names = [feature, diagnostic, 'AGENT_TOOLSDIRECTORY', 'AGENT_VERSION', ...correlationNames];
    const hooks: { name: string; descriptor: PropertyDescriptor }[] = [];
    const modulePath = path.join(__dirname, '..', '..', '_build', 'tool.js');

    beforeEach(async function () {
        environment = {};
        names.forEach(name => environment[name] = process.env[name]);
        fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-lib-telemetry-'));
        root = path.join(fixture, 'cache');
        fs.mkdirSync(root);
        process.env.AGENT_TOOLSDIRECTORY = root;
        process.env.AGENT_VERSION = '3.232.1';
        process.env[feature] = 'true';
        delete process.env[diagnostic];
        correlationNames.forEach(name => delete process.env[name]);
        output = '';
        tl.setStdStream(new Writable({
            write(chunk, encoding, callback) {
                output += chunk.toString();
                callback();
            }
        }));
        previousModule = require.cache[modulePath];
        delete require.cache[modulePath];
        tool = await import('../../_build/tool');
        output = '';
    });

    afterEach(function () {
        if (previousModule) {
            require.cache[modulePath] = previousModule;
        } else {
            delete require.cache[modulePath];
        }
        while (hooks.length) {
            const hook = hooks.pop();
            Object.defineProperty(tl, hook.name, hook.descriptor);
        }
        tl.setStdStream(process.stdout);
        names.forEach(name => {
            if (environment[name] === undefined) {
                delete process.env[name];
            } else {
                process.env[name] = environment[name];
            }
        });
        fs.rmSync(fixture, { recursive: true, force: true });
    });

    function hook(name: string, value: unknown): void {
        hooks.push({ name, descriptor: Object.getOwnPropertyDescriptor(tl, name) });
        Object.defineProperty(tl, name, { configurable: true, value });
    }

    function events(): CacheEvent[] {
        return output.split(/\r?\n/).filter(line => line.startsWith('##vso[telemetry.publish ')).map(line => {
            const command = commandFromString(line);
            assert.strictEqual(command.command, 'telemetry.publish');
            assert.deepStrictEqual(command.properties, { area: 'TaskHub', feature: 'ToolLibCachePathValidation' });
            const event: CacheEvent = JSON.parse(command.message);
            const correlationKeys = Object.keys(event).filter(key => ['taskInstanceId', 'jobId', 'planId'].includes(key));
            assert.deepStrictEqual(Object.keys(event).sort(), [
                'schemaVersion', 'libraryVersion', 'platform', 'operation', 'validationEnabled',
                'diagnostic', 'decision', 'parameter', 'reason', 'outcome'
            ].concat(correlationKeys).sort());
            for (const value of [event.taskInstanceId, event.jobId, event.planId]) {
                if (value !== undefined) {
                    assert.strictEqual(value.length, 36);
                    assert.ok(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value));
                }
            }
            assert.strictEqual(event.schemaVersion, 1);
            assert.strictEqual(event.validationEnabled, true);
            assert.strictEqual(typeof event.diagnostic, 'boolean');
            assert.ok(/^\d+\.\d+\.\d+/.test(event.libraryVersion));
            assert.ok(['win32', 'linux', 'darwin', 'other'].includes(event.platform));
            assert.ok(['findLocalTool', 'findLocalToolVersions', 'cacheDir', 'cacheFile'].includes(event.operation));
            assert.ok(['accepted', 'rejected'].includes(event.decision));
            assert.ok(['none', 'toolName', 'arch', 'version', 'targetFile'].includes(event.parameter));
            assert.ok(['none', 'missing', 'rooted', 'traversal', 'separator', 'invalidCharacter', 'windowsName', 'invalidVersion'].includes(event.reason));
            assert.ok(['hit', 'miss', 'cached', 'rejected', 'error'].includes(event.outcome));
            return event;
        });
    }

    function seed(toolName = 'safe'): string {
        const folder = path.join(root, toolName, '1.2.3', os.arch());
        fs.mkdirSync(folder, { recursive: true });
        fs.writeFileSync(folder + '.complete', '');
        return folder;
    }

    [undefined, '', 'false', 'FaLsE', 'private-marker'].forEach(setting => {
        it('keeps successful reads and writes silent without diagnostic opt-in: ' + String(setting), async function () {
            if (setting === undefined) {
                delete process.env[diagnostic];
            } else {
                process.env[diagnostic] = setting;
            }
            const folder = seed();
            const source = path.join(fixture, 'source');
            fs.mkdirSync(source);
            const sourceFile = path.join(source, 'inert.txt');
            fs.writeFileSync(sourceFile, 'inert');
            assert.strictEqual(tool.findLocalTool('safe', '1.2.3'), folder);
            assert.strictEqual(tool.findLocalTool('safe', '1.x'), folder);
            assert.strictEqual(tool.findLocalTool('safe', '2.x'), undefined);
            assert.deepStrictEqual(tool.findLocalToolVersions('safe'), ['1.2.3']);
            assert.deepStrictEqual(tool.findLocalToolVersions('missing'), []);
            await tool.cacheDir(source, 'directory', '1.2.3');
            const written = await tool.cacheFile(sourceFile, 'inert.txt', 'file', '1.2.3');
            assert.ok(fs.existsSync(written + '.complete'));
            assert.deepStrictEqual(events(), []);
        });
    });

    it('bounds production rejection and error events without disabling validation', async function () {
        const failure = new Error('private-runtime-error');
        hook('exist', () => { throw failure; });
        hook('stats', () => { throw failure; });
        const operations = [
            {
                name: 'findLocalTool',
                rejected: () => tool.findLocalTool('../outside', '1.2.3'),
                error: () => tool.findLocalTool('safe', '1.2.3')
            },
            {
                name: 'findLocalToolVersions',
                rejected: () => tool.findLocalToolVersions('../outside'),
                error: () => tool.findLocalToolVersions('safe')
            },
            {
                name: 'cacheDir',
                rejected: () => tool.cacheDir('unused', '../outside', '1.2.3'),
                error: () => tool.cacheDir('unused', 'safe', '1.2.3')
            },
            {
                name: 'cacheFile',
                rejected: () => tool.cacheFile('unused', 'inert.txt', '../outside', '1.2.3'),
                error: () => tool.cacheFile('unused', 'inert.txt', 'safe', '1.2.3')
            }
        ];
        for (let attempt = 0; attempt < 3; attempt++) {
            for (const operation of operations) {
                await assert.rejects(async () => operation.rejected(), /Invalid cache path/);
                await assert.rejects(async () => operation.error(), error => error === failure);
            }
        }
        const captured = events();
        assert.strictEqual(captured.length, 8);
        for (const operation of operations) {
            assert.deepStrictEqual(captured.filter(event => event.operation === operation.name).map(event => event.outcome),
                ['rejected', 'error']);
        }
        assert.ok(captured.every(event => event.diagnostic === false));
        process.env[diagnostic] = 'TrUe';
        for (let attempt = 0; attempt < 2; attempt++) {
            await assert.rejects(async () => operations[0].rejected(), /Invalid cache path/);
        }
        assert.strictEqual(events().length, 10);
        assert.ok(events().slice(8).every(event => event.diagnostic === true));
        process.env[diagnostic] = 'false';
        await assert.rejects(async () => operations[0].rejected(), /Invalid cache path/);
        await assert.rejects(async () => operations[0].error(), error => error === failure);
        assert.strictEqual(events().length, 10);
    });

    it('caps failed production publish attempts while preserving every rejection', function () {
        let attempts = 0;
        const debugMessages: string[] = [];
        hook('debug', (message: string) => { debugMessages.push(message); });
        hook('command', () => {
            attempts++;
            throw new Error('private-publisher-error');
        });
        for (let attempt = 0; attempt < 3; attempt++) {
            assert.throws(() => tool.findLocalTool('../outside', '1.2.3'), /Invalid cache path/);
        }
        assert.strictEqual(attempts, 1);
        assert.deepStrictEqual(debugMessages, ['Tool cache path telemetry could not be published.']);
        assert.ok(!output.includes('private-publisher-error'));
    });

    [undefined, '', 'FALSE', 'false', 'tRuE', 'true', 'unrecognized', ' false '].forEach(setting => {
        it('reports only library feature context: ' + String(setting), function () {
            if (setting === undefined) {
                delete process.env[feature];
            } else {
                process.env[feature] = setting;
            }
            assert.strictEqual(tool.findLocalTool('safe', '1.2.3'), undefined);
            if ((setting || '').toLowerCase() !== 'false') {
                assert.throws(() => tool.findLocalTool('../owned-fixture', '1.2.3'), /Invalid cache path/);
                const [rejected] = events();
                assert.strictEqual(events().length, 1);
                assert.strictEqual(rejected.decision, 'rejected');
                assert.strictEqual(rejected.outcome, 'rejected');
            } else {
                assert.strictEqual(tool.findLocalTool('../owned-fixture', '1.2.3'), undefined);
                assert.deepStrictEqual(events(), []);
            }
        });
    });

    it('does not read task-specific feature flags', function () {
        hook('getPipelineFeature', () => { throw new Error('Unexpected task-specific feature read'); });
        tool.findLocalTool('safe', '1.2.3');
        assert.throws(() => tool.findLocalTool('../outside', '1.2.3'), /Invalid cache path/);
        assert.strictEqual(events().length, 1);
        assert.ok(!output.includes('telemetry could not be published'));
    });

    it('emits one diagnostic event per public read, including range enumeration', function () {
        process.env[diagnostic] = 'true';
        const folder = seed();
        assert.strictEqual(tool.findLocalTool('safe', '1.2.3'), folder);
        assert.strictEqual(tool.findLocalTool('safe', '1.x'), folder);
        assert.deepStrictEqual(tool.findLocalToolVersions('safe'), ['1.2.3']);
        assert.strictEqual(tool.findLocalTool('safe', '2.x'), undefined);
        assert.deepStrictEqual(events().map(event => [event.operation, event.outcome]), [
            ['findLocalTool', 'hit'], ['findLocalTool', 'hit'],
            ['findLocalToolVersions', 'hit'], ['findLocalTool', 'miss']
        ]);
    });

    it('emits one diagnostic write event, not events for private create/complete helpers', async function () {
        process.env[diagnostic] = 'true';
        const source = path.join(fixture, 'source');
        fs.mkdirSync(source);
        fs.writeFileSync(path.join(source, 'inert.txt'), 'inert');
        await tool.cacheDir(source, 'directory', 'v1.2.3');
        const folder = await tool.cacheFile(path.join(source, 'inert.txt'), 'bin/inert.txt', 'file', '1.2.3');
        assert.ok(fs.existsSync(folder + '.complete'));
        assert.deepStrictEqual(events().map(event => [event.operation, event.decision, event.outcome]), [
            ['cacheDir', 'accepted', 'cached'], ['cacheFile', 'accepted', 'cached']
        ]);
    });

    it('uses fixed reasons and never transmits rejected strings or source paths', async function () {
        process.env[diagnostic] = 'true';
        const cases = [
            { value: '', reason: 'missing' },
            { value: '../private-tool', reason: 'traversal' },
            { value: 'private/tool', reason: 'separator' },
            { value: 'C:\\private-tool', reason: 'rooted' },
            { value: 'private%\n##vso[task.issue]secret', reason: 'invalidCharacter' },
            { value: 'private-tool.', reason: 'windowsName' }
        ];
        for (const test of cases) {
            assert.throws(() => tool.findLocalToolVersions(test.value), /Invalid cache path/);
        }
        await assert.rejects(tool.cacheDir('private-source', 'safe', 'private-version'), /Invalid cache version/);
        await assert.rejects(tool.cacheFile('private-source', '../private-target', 'safe', '1.2.3'), /Invalid cache path/);
        assert.throws(() => tool.findLocalTool('safe', '1.2.3', '../private-arch'), /Invalid cache path/);
        const captured = events();
        assert.deepStrictEqual(captured.slice(0, cases.length).map(event => event.reason), cases.map(test => test.reason));
        assert.deepStrictEqual(captured.slice(cases.length).map(event => event.parameter), ['version', 'targetFile', 'arch']);
        assert.ok(captured.every(event => event.outcome === 'rejected' && event.decision === 'rejected'));
        assert.ok(!JSON.stringify(captured).includes('private'));
        assert.ok(!JSON.stringify(captured).includes(fixture));
        assert.ok(!JSON.stringify(captured).includes('##vso'));
        assert.strictEqual(tool.findLocalTool('safe', 'private-version-spec%\nnot-a-version'), undefined);
        assert.strictEqual(events()[cases.length + 3].outcome, 'miss');
        assert.ok(!JSON.stringify(events()).includes('private'));
    });

    ['false', 'fAlSe'].forEach(setting => {
        it('takes the legacy path without audit or telemetry preparation for ' + setting, async function () {
            process.env[feature] = setting;
            const unsafeTool = '../owned-kill-switch';
            const unsafeTarget = '../owned-target.txt';
            const folder = seed(unsafeTool);
            const sourceDir = path.join(fixture, 'source');
            fs.mkdirSync(sourceDir);
            const sourceFile = path.join(sourceDir, 'inert.txt');
            fs.writeFileSync(sourceFile, 'inert');
            hook('command', () => { throw new Error('Unexpected telemetry command'); });
            hook('getPipelineFeature', () => { throw new Error('Unexpected telemetry-only feature read'); });
            const split = String.prototype.split;
            const environment = process.env;
            const telemetryOnly = [...correlationNames, diagnostic];
            try {
                process.env = new Proxy(environment, {
                    get(target, property) {
                        assert.ok(!telemetryOnly.includes(String(property)), 'Unexpected telemetry context lookup');
                        return Reflect.get(target, property);
                    }
                });
                Object.defineProperty(String.prototype, 'split', {
                    configurable: true, writable: true,
                    value: function(this: string, separator: string | RegExp, limit?: number) {
                        assert.ok(String(this) !== unsafeTool && String(this) !== unsafeTarget,
                            'Unexpected pure shadow classification');
                        return split.call(this, separator, limit);
                    }
                });
                assert.strictEqual(tool.findLocalTool('safe', '1.2.3'), undefined);
                assert.deepStrictEqual(tool.findLocalToolVersions('safe'), []);
                assert.strictEqual(tool.findLocalTool(unsafeTool, '1.2.3'), folder);
                assert.strictEqual(tool.findLocalTool(unsafeTool, '1.x'), folder);
                assert.deepStrictEqual(tool.findLocalToolVersions(unsafeTool), ['1.2.3']);
                await tool.cacheDir(sourceDir, 'safe-dir', '1.2.3');
                await tool.cacheDir(sourceDir, unsafeTool, '1.2.3');
                await tool.cacheFile(sourceFile, 'inert.txt', 'safe-file', '1.2.3');
                await tool.cacheFile(sourceFile, unsafeTarget, unsafeTool, '1.2.3');
                assert.ok(fs.existsSync(path.join(folder, '..', 'owned-target.txt')));
                assert.throws(() => tool.findLocalTool('', ''), /^Error: toolName parameter is required$/);
                assert.throws(() => tool.findLocalTool(unsafeTool, ''), /^Error: versionSpec parameter is required$/);
                await assert.rejects(tool.cacheDir('unused', unsafeTool, null), TypeError);
                await assert.rejects(tool.cacheFile('unused', unsafeTarget, unsafeTool, null), TypeError);
                const failure = new Error('original legacy filesystem error');
                hook('stats', () => { throw failure; });
                await assert.rejects(tool.cacheDir('unused', unsafeTool, '1.2.3'), error => error === failure);
                await assert.rejects(tool.cacheFile('unused', unsafeTarget, unsafeTool, '1.2.3'), error => error === failure);
                assert.deepStrictEqual(events(), []);
                assert.ok(!output.includes('telemetry could not be published'));
            } finally {
                process.env = environment;
                Object.defineProperty(String.prototype, 'split', { configurable: true, writable: true, value: split });
            }
        });
    });

    it('preserves genuine error identity and reports operation errors, not task failure', async function () {
        const failure = new Error('private-runtime-error');
        hook('stats', () => { throw failure; });
        await assert.rejects(tool.cacheDir('private-source', 'safe', '1.2.3'), error => error === failure);
        const [event] = events();
        assert.deepStrictEqual([event.decision, event.parameter, event.reason, event.outcome],
            ['accepted', 'none', 'none', 'error']);
        assert.ok(!JSON.stringify(event).includes('private'));
    });

    it('keeps pre-validation required-argument ordering and disabled invalid-version errors', async function () {
        assert.throws(() => tool.findLocalTool('../owned', ''), /versionSpec parameter is required/);
        process.env[feature] = 'false';
        await assert.rejects(tool.cacheDir('unused', 'safe', null), TypeError);
        assert.deepStrictEqual(events().map(event => [event.decision, event.outcome]), [
            ['accepted', 'error']
        ]);
    });

    it('keeps the flag decision fixed through synchronous helpers and async completion', async function () {
        process.env[diagnostic] = 'true';
        const folder = seed();
        const outside = seed('../outside');
        const exist = tl.exist;
        hook('exist', (file: string) => {
            process.env[feature] = 'false';
            return exist(file);
        });
        assert.strictEqual(tool.findLocalTool('safe', '1.x'), folder);
        assert.strictEqual(events().length, 1);
        assert.strictEqual(events()[0].validationEnabled, true);
        assert.strictEqual(tool.findLocalTool('../outside', '1.x'), outside);
        assert.strictEqual(events().length, 1);
        const source = path.join(fixture, 'inert.txt');
        fs.writeFileSync(source, 'inert');
        const stats = tl.stats;
        hook('stats', (file: string) => {
            process.env[feature] = 'true';
            return stats(file);
        });
        const written = await tool.cacheFile(source, 'inert.txt', '../legacy-write', '1.2.3');
        assert.ok(fs.existsSync(written + '.complete'));
        assert.strictEqual(events().length, 1);
    });

    it('isolates publishing and fallback-debug failures from successful and rejected operations', async function () {
        process.env[diagnostic] = 'true';
        const folder = seed();
        const debug = tl.debug;
        hook('command', () => { throw new Error('private-publisher-error'); });
        hook('debug', (message: string) => {
            if (message === 'Tool cache path telemetry could not be published.') {
                throw new Error('private-debug-error');
            }
            debug(message);
        });
        assert.strictEqual(tool.findLocalTool('safe', '1.x'), folder);
        const source = path.join(fixture, 'source.txt');
        fs.writeFileSync(source, 'inert');
        const written = await tool.cacheFile(source, 'inert.txt', 'successful-write', '1.2.3');
        assert.ok(fs.existsSync(written + '.complete'));
        assert.throws(() => tool.findLocalTool('../private', '1.2.3'), /Invalid cache path/);
        const failure = new Error('private-filesystem-error');
        hook('stats', () => { throw failure; });
        await assert.rejects(tool.cacheDir('unused', 'safe', '1.2.3'), error => error === failure);
    });

    it('logs only a fixed message when telemetry publishing fails', function () {
        process.env[diagnostic] = 'true';
        const debugMessages: string[] = [];
        hook('debug', (message: string) => { debugMessages.push(message); });
        hook('command', () => { throw new Error('private-publisher-error'); });
        assert.strictEqual(tool.findLocalTool('safe', '1.2.3'), undefined);
        assert.ok(debugMessages.includes('Tool cache path telemetry could not be published.'));
        assert.ok(!debugMessages.some(message => message.includes('private-publisher-error')));
        assert.ok(!output.includes('private-publisher-error'));
    });

    it('skips unsupported agents and starts publishing at agent 2.120.0', function () {
        process.env[diagnostic] = 'true';
        process.env.AGENT_VERSION = '2.115.0';
        assert.strictEqual(tool.findLocalTool('safe', '1.2.3'), undefined);
        process.env.AGENT_VERSION = '2.119.9';
        assert.strictEqual(tool.findLocalTool('safe', '1.2.3'), undefined);
        assert.strictEqual(events().length, 0);
        assert.ok(!output.includes('telemetry could not be published'));
        process.env.AGENT_VERSION = '2.120.0';
        assert.strictEqual(tool.findLocalTool('safe', '1.2.3'), undefined);
        assert.strictEqual(events().length, 1);
    });

    it('opts into diagnostics without consuming production signals or including variable text', function () {
        process.env[diagnostic] = 'TrUe';
        assert.throws(() => tool.findLocalTool('../owned', '1.2.3'), /Invalid cache path/);
        assert.strictEqual(events()[0].diagnostic, true);
        assert.strictEqual(events()[0].outcome, 'rejected');
        process.env[diagnostic] = 'private-marker';
        tool.findLocalTool('safe', '1.2.3');
        assert.throws(() => tool.findLocalTool('../owned', '1.2.3'), /Invalid cache path/);
        assert.strictEqual(events().length, 2);
        assert.strictEqual(events()[1].diagnostic, false);
        assert.strictEqual(events()[1].outcome, 'rejected');
        assert.ok(!JSON.stringify(events()).includes('private-marker'));
    });

    it('uses the real task-lib data escaping rather than emitting extra commands', function () {
        const value = 'inert%\r\n##vso[task.issue type=error;]not-a-command';
        tl.command('telemetry.publish', { area: 'TaskHub', feature: 'ToolLibCachePathValidation' }, value);
        const lines = output.trim().split(/\r?\n/);
        assert.strictEqual(lines.length, 1);
        assert.ok(lines[0].includes('%AZP25%0D%0A'));
        assert.strictEqual(commandFromString(lines[0]).message, value);
    });

    it('includes only validated canonical correlation GUIDs, without inventing task identity', function () {
        process.env[diagnostic] = 'true';
        const taskInstance = 'ABCDEF01-2345-6789-ABCD-EF0123456789';
        const job = '12345678-ABCD-1234-5678-ABCDEF012345';
        const plan = '87654321-4321-ABCD-EF01-23456789ABCD';
        process.env.SYSTEM_TASKINSTANCEID = taskInstance;
        process.env.SYSTEM_JOBID = job;
        process.env.SYSTEM_PLANID = plan;
        tool.findLocalTool('safe', '1.2.3');
        const [event] = events();
        assert.strictEqual(event.taskInstanceId, taskInstance.toLowerCase());
        assert.strictEqual(event.jobId, job.toLowerCase());
        assert.strictEqual(event.planId, plan.toLowerCase());
        assert.strictEqual(events().length, 1);
    });

    it('omits missing, malformed and injected correlation values without raw logging', function () {
        process.env[diagnostic] = 'true';
        const guid = 'abcdef01-2345-6789-abcd-ef0123456789';
        for (const value of [undefined, 'private-id', '{' + guid + '}', guid + '\n', guid + ';secret', guid + '\n##vso[task.issue]private']) {
            correlationNames.forEach(name => {
                if (value === undefined) {
                    delete process.env[name];
                } else {
                    process.env[name] = value;
                }
            });
            tool.findLocalTool('safe', '1.2.3');
        }
        assert.strictEqual(events().length, 6);
        assert.ok(events().every(event =>
            event.taskInstanceId === undefined && event.jobId === undefined && event.planId === undefined));
        assert.ok(!output.includes(guid));
        assert.ok(!output.includes('private-id'));
        assert.ok(!output.includes('##vso[task.issue]'));
    });
});
