# VSTS Tasks Tool Installer SDK

Tool installer tasks SDK for [Visual Studio Team Services](https://www.visualstudio.com/en-us/products/visual-studio-team-services-vs.aspx) build and deployment.

[Tool Installer Task Overview: Read Here](docs/overview.md).

[Demo Video: Here](https://youtu.be/Ie8EuvqJ0Hg)

Sample of tool api usage is [here](sample.ts)

In development.  Preview installer tasks soon.

## Status
|   | Build & Test |
|---|:-----:|
|![Win](docs/res/win_med.png) **Windows**|![Build & Test](https://mseng.visualstudio.com/_apis/public/build/definitions/b924d696-3eae-4116-8443-9a18392d8544/5199/badge?branch=master)| 
|![Apple](docs/res/apple_med.png) **OSX**|![Build & Test](https://mseng.visualstudio.com/_apis/public/build/definitions/b924d696-3eae-4116-8443-9a18392d8544/5200/badge?branch=master)|
|![Ubuntu14](docs/res/ubuntu_med.png) **Ubuntu 14.04**|![Build & Test](https://mseng.visualstudio.com/_apis/public/build/definitions/b924d696-3eae-4116-8443-9a18392d8544/5201/badge?branch=master)|

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
