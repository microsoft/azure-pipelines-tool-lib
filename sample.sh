#!/bin/bash 

# build
npm run build
pushd _build

# agent (or user will override) the tools cache dir
export AGENT_TOOLCACHE=./CACHE
mkdir -p $AGENT_TOOLCACHE

# run the sample
node sample.js
popd