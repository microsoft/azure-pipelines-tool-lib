# Loc process

## XLIFF overview
XML Localization Interchange File Format ([XLIFF](http://docs.oasis-open.org/xliff/v1.2/os/xliff-core.html)) is an open standard for translation database files. The file extension is .xlf. XLIFF files are the intermediate files used for handoff/handback. They are not included in the product layout. Ultimately resjson or resx is the end goal file type that is included in the product layout.

XLIFF is an XML format. Each XLIFF file contains translation strings from one source language, to one target language. Multiple source files can be embedded in a single XLIFF file. The structure of an XLIFF file looks like:
```
xliff
├───file
│   ├───@original // original file name
│   ├───@source-language // en-US
│   ├───@target-language // de-DE
│   ├───@datatype // plaintext
│   └───body
│       ├───trans-unit
│       │   ├───@id // resource key
│       │   ├───source // English string
│       │   ├───target // resource key
│       │   │   ├───@state // new, needs-translation, or translated
│       │   │   └───inner-text // Translated string
│       │   └───note // comment to localizer
│       └───[trans-unit ...]
└───[file ...]
```

## Build process
The build process uses the checked-in xlf files to generate the satellite resjson files. Psuedo-code to generate the resjson files looks like:

```
// load English strings

// for each culture
{
    // initialize culture-specific strings from English strings

    // if culture-specific xliff file exists
    {
        // load culture-specific xliff file

        // overlay culture-specific strings where the ID matches,
        // the source text matches, and the state is "translated"
    }

    // write the culture-specific resjson file
}
```

Note, this approach prefers falling back to the English string rather than using an outdated translated string.

## Handoff/handback process

The handoff process is on-demand. A separate command, `node make.js handoff`, creates or updates the .xlf files based on the latest English strings. Then an email should be sent to the loc contact with the branch information. The loc team is working on automation, as an alternative to on-demand process.

For the handback process, the loc team will fork the repo and raise a PR.

Pseudo-code to update the .xlf files during handoff:
```
// load English strings

// for each culture
{
    // load culture-specific xliff file, or initialize new object

    // for each resource key from English strings
    {
        // if xliff does not contain the key
        {
            // add the unit: id, source, target state, note
        }
        // else if source has changed
        {
            // update the unit: source, target state, note
        }
        // else
        {
            // update the unit: note
        }
    }

    // for each unit from culture-specific xliff
    {
        // if English strings does not contain the resource key
        {
            // delete the unit
        }
    }

    // write the culture-specific xliff file
}
```

### Merge conflicts during handback
The handoff logic that updates the .xlf files, must be run as a separate command. It should not be integrated into the normal build command. The handback process is through PR. So to reduce the chance of merge conflicts during handback, the handoff command should only be run immediately prior to actual handoff.

If merge conflicts become an issue, we can add a handback command to deal with the problems. For instance, handback can be into a temporary "handback" branch. And we can add a handback command that loads the .xlf files from base branch and "handback" branch, and updates the base files where resource keys match, source text matches, and target-state is "translated".
