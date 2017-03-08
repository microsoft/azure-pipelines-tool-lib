#!/bin/bash 

export SYSTEM_TOOLCACHE=./CACHE

echo $SYSTEM_TOOLCACHE

rm -rf $SYSTEM_TOOLCACHE
mkdir -p $SYSTEM_TOOLCACHE

tsc

node sample.js
