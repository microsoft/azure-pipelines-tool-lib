[![Build Status](https://dev.azure.com/ms/azure-pipelines-tool-lib/_apis/build/status/Microsoft.azure-pipelines-tool-lib?branchName=master)](https://dev.azure.com/ms/azure-pipelines-tool-lib/_build/latest?definitionId=92&branchName=master)

# Azure Pipelines Tool Installer SDK

Tool installer tasks SDK for [Azure Pipelines](https://azure.microsoft.com/en-us/services/devops/pipelines/).

[Tool Installer Task Overview: Read Here](docs/overview.md).

[Demo Video: Here](https://youtu.be/Ie8EuvqJ0Hg)

Sample of tool api usage is [here](sample.ts)

In development.  Preview installer tasks soon.

## Status

|   | Build & Test |
|---|:-----:|
|![Win-x64](docs/res/win_med.png) **Windows**|[![Build & Test][win-build-badge]][build]| 
|![macOS](docs/res/apple_med.png) **macOS**|[![Build & Test][macOS-build-badge]][build]| 
|![Linux-x64](docs/res/ubuntu_med.png) **Linux**|[![Build & Test][linux-build-badge]][build]|

[win-build-badge]: https://dev.azure.com/mseng/PipelineTools/_apis/build/status/azure-pipelines-tool-lib?branchName=features/rebrand&jobname=VS2017_Win2016
[macOS-build-badge]: https://dev.azure.com/mseng/PipelineTools/_apis/build/status/azure-pipelines-tool-lib?branchName=features/rebrand&jobname=MacOS_1013
[linux-build-badge]: https://dev.azure.com/mseng/PipelineTools/_apis/build/status/azure-pipelines-tool-lib?branchName=features/rebrand&jobname=Ubuntu_1604
[build]: https://dev.azure.com/mseng/PipelineTools/_build/latest?definitionId=7750

# Build

Once:  
```bash
$ npm install
```

Build:  
```bash
$ npm run build
```

# Test

To run all tests:

```bash
$ npm test
```

To just run unit tests:

```bash
$ npm run units
```

# Sample

Build first.  Then run  

```bash
$ npm run sample
```

The tool cache will be in the _build folder.  To clear the cache, build again.

# Contributing

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/). For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

## Security issues

Do you think there might be a security issue? Have you been phished or identified a security vulnerability? Please don't report it here - let us know by sending an email to secure@microsoft.com.
