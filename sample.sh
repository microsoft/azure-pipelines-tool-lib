#!/bin/bash 

# build
npm run build
pushd _build

# agent (or user will override) the tools cache dir
export SYSTEM_TOOLCACHE=./CACHE
mkdir -p $SYSTEM_TOOLCACHE

# run the sample
node sample.js
popd