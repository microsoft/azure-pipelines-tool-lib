const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

// Registry configuration
const registryUrl = 'https://pkgs.dev.azure.com/dassayantan/dassayantan/_packaging/TestPackages/npm/registry/';

console.log('Publishing npm package to private registry');

try {
    // Navigate to build directory (following your repo's pattern)
    const buildPath = path.join(__dirname, '_build');
    
    if (!fs.existsSync(buildPath)) {
        throw new Error(`Build directory not found: ${buildPath}. Please run 'npm run build' first.`);
    }
    
    console.log(`Changing to build directory: ${buildPath}`);
    process.chdir(buildPath);
    
    // Verify package.json exists in build directory
    if (!fs.existsSync('package.json')) {
        throw new Error('package.json not found in build directory');
    }
    
    // Create .npmrc with auth token for private registry
    const npmToken = process.env.NPM_TOKEN;
    if (!npmToken) {
        throw new Error('NPM_TOKEN environment variable is required');
    }
    
    const npmrc = `registry=${registryUrl}
always-auth=true
//pkgs.dev.azure.com/dassayantan/dassayantan/_packaging/TestPackages/npm/registry/:_authToken=${npmToken}`;
    console.log('Creating .npmrc for authentication...');
    fs.writeFileSync('.npmrc', npmrc);
    
    // Publish to npm registry
    console.log(`Publishing to npm registry: ${registryUrl}`);
    execSync(`npm publish --registry ${registryUrl}`, { stdio: 'inherit' });
    console.log('Successfully published to npm!');
    
} catch (error) {
    console.error('Publish failed:', error.message);
    if (error.message.includes('already exists')) {
        console.log('Tip: Bump the version in package.json');
    }
    if (error.message.includes('401')) {
        console.log('Tip: Check NPM_TOKEN permissions (read/write required)');
    }
    if (error.message.includes('upstream')) {
        console.log('Tip: Use scoped package name like @dassayantan/azure-pipelines-tool-lib');
    }
    process.exit(1);
}
