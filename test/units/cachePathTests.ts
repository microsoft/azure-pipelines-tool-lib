import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as tl from 'azure-pipelines-task-lib/task';
import * as tool from '../../_build/tool';

const featureVariable = 'DISTRIBUTEDTASK_TASKS_TOOLLIBCACHEPATHVALIDATIONENABLED';

describe('Cache path validation', function () {
    let fixture: string;
    let root: string;
    let previousEnvironment: { [name: string]: string | undefined };
    let previousTools: string;
    const hooks: { target: any; name: string; descriptor: PropertyDescriptor }[] = [];
    const environmentNames = [featureVariable, 'AGENT_TOOLSDIRECTORY', 'AGENT_VERSION'];

    beforeEach(function () {
        previousTools = tl.getVariable('Agent.ToolsDirectory');
        previousEnvironment = {};
        environmentNames.forEach(name => previousEnvironment[name] = process.env[name]);
        fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-lib-cache-test-'));
        root = path.join(fixture, 'cache');
        fs.mkdirSync(root);
        tl.setVariable('Agent.ToolsDirectory', root);
        process.env['AGENT_VERSION'] = '2.115.0';
        process.env[featureVariable] = 'true';
    });

    afterEach(function () {
        while (hooks.length) {
            const hook = hooks.pop();
            Object.defineProperty(hook.target, hook.name, hook.descriptor);
        }
        tl.setVariable('Agent.ToolsDirectory', previousTools || '');
        environmentNames.forEach(name => {
            if (previousEnvironment[name] === undefined) {
                delete process.env[name];
            } else {
                process.env[name] = previousEnvironment[name];
            }
        });
        fs.rmSync(fixture, { recursive: true, force: true });
    });

    function replace(target: any, name: string, value: any): void {
        hooks.push({ target, name, descriptor: Object.getOwnPropertyDescriptor(target, name) });
        Object.defineProperty(target, name, { configurable: true, value });
    }

    function forbidFilesystem(names = ['stats', 'exist', 'ls', 'rmRF', 'mkdirP', 'cp', 'writeFile']): void {
        names.forEach(name => {
            replace(tl, name, () => { throw new Error('Unexpected filesystem access: ' + name); });
        });
    }

    function redirectJoin(parent: string, component: string, destination: string): void {
        const join = path.join;
        // Simulate a future path-construction regression independently of input validation.
        replace(path, 'join', (...parts: string[]) =>
            parts.length === 2 && parts[0] === parent && parts[1] === component ? destination : join(...parts));
    }

    function cached(name: string, version = '1.2.3', arch = os.arch(), complete = true): string {
        const folder = path.join(root, name, version, arch);
        fs.mkdirSync(folder, { recursive: true });
        fs.writeFileSync(path.join(folder, 'inert.txt'), 'inert fixture');
        if (complete) {
            fs.writeFileSync(folder + '.complete', '');
        }
        return folder;
    }

    [undefined, '', 'true', 'TRUE', 'tRuE', 'false', 'FaLsE', 'unexpected', ' false '].forEach(setting => {
        it('uses default-on explicit-false semantics with ' + JSON.stringify(setting), function () {
            const outside = cached('../outside');
            if (setting === undefined) {
                delete process.env[featureVariable];
            } else {
                process.env[featureVariable] = setting;
            }
            const enabled = (setting || '').toLowerCase() !== 'false';
            if (enabled) {
                assert.throws(() => tool.findLocalTool('../outside', '1.2.3'), /Invalid cache path/);
                assert.throws(() => tool.findLocalToolVersions('../outside'), /Invalid cache path/);
            } else {
                assert.strictEqual(tool.findLocalTool('../outside', '1.2.3'), outside);
                assert.deepStrictEqual(tool.findLocalToolVersions('../outside'), ['1.2.3']);
            }
        });
    });

    it('rejects a Docker-derived traversal name before consulting a repository-shaped cache', async function () {
        const name = 'docker-x/../../checkout/payload/toolcache';
        const folder = cached(name, '28.5.2');
        assert.ok(folder.startsWith(path.join(fixture, 'checkout') + path.sep));
        forbidFilesystem();
        assert.throws(() => tool.findLocalTool(name, '28.5.2'), /Invalid cache path parameter: toolName/);
        assert.throws(() => tool.findLocalTool(name, '28.x'), /Invalid cache path parameter: toolName/);
        assert.throws(() => tool.findLocalToolVersions(name), /Invalid cache path parameter: toolName/);
        await assert.rejects(tool.cacheDir('not-statted', name, '28.5.2'), /Invalid cache path parameter: toolName/);
        await assert.rejects(tool.cacheFile('not-statted', 'inert.txt', name, '28.5.2'), /Invalid cache path parameter: toolName/);
        assert.strictEqual(fs.readFileSync(path.join(folder, 'inert.txt'), 'utf8'), 'inert fixture');
        assert.ok(fs.existsSync(folder + '.complete'));
    });

    ['same-directory', 'parent', 'sibling-prefix', ...(os.platform() === 'win32' ? ['other-drive'] : [])].forEach(kind => {
        it('rejects a constructed tool path outside the strict cache boundary: ' + kind, async function () {
            const sourceDir = path.join(fixture, 'source');
            fs.mkdirSync(sourceDir);
            const sourceFile = path.join(sourceDir, 'inert.txt');
            fs.writeFileSync(sourceFile, 'inert fixture');
            const destination = kind === 'same-directory' ? root :
                kind === 'parent' ? fixture :
                kind === 'sibling-prefix' ? root + '-other' :
                os.platform() === 'win32' ? (path.parse(root).root[0].toUpperCase() === 'Z' ? 'Y:\\other' : 'Z:\\other') :
                path.join(fixture, 'other');
            redirectJoin(root, 'safe', destination);
            forbidFilesystem(['exist', 'ls', 'rmRF', 'mkdirP', 'cp', 'writeFile']);
            assert.throws(() => tool.findLocalTool('safe', '1.2.3'), /Invalid cache path parameter: toolName/);
            assert.throws(() => tool.findLocalToolVersions('safe'), /Invalid cache path parameter: toolName/);
            await assert.rejects(tool.cacheDir(sourceDir, 'safe', '1.2.3'), /Invalid cache path parameter: toolName/);
            await assert.rejects(tool.cacheFile(sourceFile, 'inert.txt', 'safe', '1.2.3'), /Invalid cache path parameter: toolName/);
        });
    });

    ['version', 'arch'].forEach(parameter => {
        it('checks constructed ' + parameter + ' paths for both explicit lookup and enumeration', function () {
            const toolPath = path.join(root, 'safe');
            const versionPath = path.join(toolPath, '1.2.3');
            const parent = parameter === 'version' ? toolPath : versionPath;
            const component = parameter === 'version' ? '1.2.3' : os.arch();
            redirectJoin(parent, component, parent + '-other');
            replace(tl, 'exist', (candidate: string) => {
                assert.strictEqual(candidate, toolPath, 'Must reject before consulting the escaped entry');
                return true;
            });
            replace(tl, 'ls', () => ['1.2.3']);
            const message = new RegExp('Invalid cache path parameter: ' + parameter);
            assert.throws(() => tool.findLocalTool('safe', '1.2.3'), message);
            assert.throws(() => tool.findLocalToolVersions('safe'), message);
            assert.throws(() => tool.findLocalTool('safe', '1.x'), message);
        });
    });

    ['same-directory', 'sibling-prefix'].forEach(kind => {
        it('checks the final file destination before removing the existing cache: ' + kind, async function () {
            const folder = cached('safe');
            const sentinel = path.join(folder, 'inert.txt');
            const source = path.join(fixture, 'source.txt');
            fs.writeFileSync(source, 'source fixture');
            redirectJoin(folder, 'inert.txt', kind === 'same-directory' ? folder : folder + '-other');
            forbidFilesystem(['rmRF', 'mkdirP', 'cp', 'writeFile']);
            await assert.rejects(tool.cacheFile(source, 'inert.txt', 'safe', '1.2.3'),
                /Invalid cache path parameter: targetFile/);
            assert.strictEqual(fs.readFileSync(sentinel, 'utf8'), 'inert fixture');
            assert.ok(fs.existsSync(folder + '.complete'));
        });
    });

    const unsafeComponents = [
        '..', '.', '../outside', '..\\outside', 'nested/name', 'nested\\name',
        '/absolute', '\\absolute', 'C:\\absolute', 'C:relative', '\\\\server\\share',
        '//server/share', 'name:stream', 'name\ninjected', 'trailing.', 'trailing ', 'NUL'
    ];
    unsafeComponents.forEach(value => {
        it('rejects unsafe tool and architecture before filesystem access: ' + JSON.stringify(value), async function () {
            forbidFilesystem();
            assert.throws(() => tool.findLocalTool(value, '1.2.3'), /Invalid cache path/);
            assert.throws(() => tool.findLocalTool(value, '1.x'), /Invalid cache path/);
            assert.throws(() => tool.findLocalTool('safe', '1.2.3', value), /Invalid cache path/);
            assert.throws(() => tool.findLocalTool('safe', '1.x', value), /Invalid cache path/);
            assert.throws(() => tool.findLocalToolVersions(value), /Invalid cache path/);
            assert.throws(() => tool.findLocalToolVersions('safe', value), /Invalid cache path/);
            await assert.rejects(tool.cacheDir('not-statted', value, '1.2.3'), /Invalid cache path/);
            await assert.rejects(tool.cacheDir('not-statted', 'safe', '1.2.3', value), /Invalid cache path/);
            await assert.rejects(tool.cacheFile('not-statted', 'file.txt', value, '1.2.3'), /Invalid cache path/);
            await assert.rejects(tool.cacheFile('not-statted', 'file.txt', 'safe', '1.2.3', value), /Invalid cache path/);
        });
    });

    ['', '../outside.txt', '..\\outside.txt', '/absolute.txt', '\\absolute.txt',
        'C:\\absolute.txt', 'C:relative.txt', '\\\\server\\share\\file',
        'bin/../../outside.txt', 'bin\\..\\outside.txt', 'bin//file', 'bin/./file',
        'bin/file:stream', 'bin/file\ninjected', 'bin/NUL'].forEach(target => {
        it('rejects target without touching a cached sentinel or marker: ' + JSON.stringify(target), async function () {
            const folder = cached('safe');
            const sentinel = path.join(folder, 'inert.txt');
            fs.writeFileSync(folder + '.complete', 'original marker');
            forbidFilesystem();
            await assert.rejects(tool.cacheFile('not-statted', target, 'safe', '1.2.3'), /Invalid cache path/);
            assert.strictEqual(fs.readFileSync(sentinel, 'utf8'), 'inert fixture');
            assert.strictEqual(fs.readFileSync(folder + '.complete', 'utf8'), 'original marker');
            assert.deepStrictEqual(fs.readdirSync(fixture), ['cache']);
        });
    });

    ['', null, undefined, 'not-semver', '1.x', '../1.2.3'].forEach(version => {
        it('rejects invalid write version before source stat: ' + JSON.stringify(version), async function () {
            forbidFilesystem();
            await assert.rejects(tool.cacheDir('not-statted', 'safe', version), /Invalid cache version/);
            await assert.rejects(tool.cacheFile('not-statted', 'file', 'safe', version), /Invalid cache version/);
        });
    });

    it('finds explicit and range versions only with completion markers', function () {
        const first = cached('Tool Name-with-dashes');
        const second = cached('Tool Name-with-dashes', '1.3.0');
        cached('Tool Name-with-dashes', '1.9.0', os.arch(), false);
        assert.strictEqual(tool.findLocalTool('Tool Name-with-dashes', ' =v1.2.3 '), first);
        assert.strictEqual(tool.findLocalTool('Tool Name-with-dashes', '1.2.3', ''), first);
        assert.strictEqual(tool.findLocalTool('Tool Name-with-dashes', '1.x'), second);
        assert.strictEqual(tool.findLocalTool('Tool Name-with-dashes', '1.9.0'), undefined);
        assert.deepStrictEqual(tool.findLocalToolVersions('Tool Name-with-dashes').sort(), ['1.2.3', '1.3.0']);
        const dotted = cached('..safe');
        assert.strictEqual(tool.findLocalTool('..safe', '1.2.3'), dotted);
    });

    it('caches directories and safe nested files with cleaned versions and default architecture', async function () {
        const source = path.join(fixture, 'source');
        fs.mkdirSync(source);
        fs.writeFileSync(path.join(source, 'inert.txt'), 'inert fixture');
        const directory = await tool.cacheDir(source, 'Tool Name-with-dashes', ' =v1.2.3 ');
        assert.strictEqual(directory, path.join(root, 'Tool Name-with-dashes', '1.2.3', os.arch()));
        assert.strictEqual(tool.findLocalTool('Tool Name-with-dashes', '1.x'), directory);
        const file = await tool.cacheFile(path.join(source, 'inert.txt'), 'bin/nested/inert.txt', 'file-tool', 'v2.0.0', 'custom-arch');
        assert.strictEqual(fs.readFileSync(path.join(file, 'bin/nested/inert.txt'), 'utf8'), 'inert fixture');
        assert.ok(fs.existsSync(file + '.complete'));
        assert.strictEqual(tool.findLocalTool('file-tool', '2.x', 'custom-arch'), file);
        const dotted = await tool.cacheFile(path.join(source, 'inert.txt'), '..bin/inert.txt', '..safe', '1.2.3');
        assert.strictEqual(fs.readFileSync(path.join(dotted, '..bin', 'inert.txt'), 'utf8'), 'inert fixture');
        if (os.platform() === 'win32') {
            const windows = await tool.cacheFile(path.join(source, 'inert.txt'), 'bin\\inert.txt', 'windows-tool', '1.0.0');
            assert.ok(fs.existsSync(path.join(windows, 'bin', 'inert.txt')));
        }
    });

    it('preserves disabled write behavior inside the owned fixture', async function () {
        process.env[featureVariable] = 'false';
        replace(path, 'relative', () => { throw new Error('Unexpected disabled containment check'); });
        const source = path.join(fixture, 'source.txt');
        fs.writeFileSync(source, 'inert fixture');
        const folder = await tool.cacheFile(source, 'file.txt', '../legacy', '1.2.3');
        assert.strictEqual(folder, path.join(fixture, 'legacy', '1.2.3', os.arch()));
        assert.ok(fs.existsSync(folder + '.complete'));
        assert.strictEqual(tool.findLocalTool('../legacy', '1.2.3'), folder);
    });
});
