/* SPDX-License-Identifier: GPL-3.0-or-later
 * Experimental Metal data-path check. Readback uses system RAM too.
 * Private storage is not a physical-VRAM-address mapping facility.
 */
#import <Foundation/Foundation.h>
#import <Metal/Metal.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>
static int testDevice(id<MTLDevice> dev) {
    @autoreleasepool {
        NSLog(@"GPU=%@ lowPower=%d scope=Metal-private-fill/shared-readback",dev.name,dev.isLowPower);
        NSUInteger size=64u*1024u*1024u;
        if(dev.maxBufferLength<size || dev.recommendedMaxWorkingSetSize<size*4) return 3;
        NSError *error=nil;
        NSString *source=@"#include <metal_stdlib>\nusing namespace metal;\n"
            "kernel void fill(device uint *out [[buffer(0)]], constant uint &seed [[buffer(1)]], uint i [[thread_position_in_grid]]) { out[i] = i ^ seed ^ 0xA5A5A5A5u; }\n";
        id<MTLLibrary> lib=[dev newLibraryWithSource:source options:nil error:&error];
        if(!lib) { NSLog(@"SHADER_COMPILE_ERROR=%@",error); return 3; }
        id<MTLFunction> fn=[lib newFunctionWithName:@"fill"];
        if(!fn) return 3;
        id<MTLComputePipelineState> pipe=[dev newComputePipelineStateWithFunction:fn error:&error];
        id<MTLCommandQueue> queue=[dev newCommandQueue];
        if(!pipe || !queue || pipe.maxTotalThreadsPerThreadgroup==0) return 3;
        id<MTLBuffer> readback=[dev newBufferWithLength:size options:MTLResourceStorageModeShared];
        if(!readback || !readback.contents) return 3;
        NSMutableArray<id<MTLBuffer>> *buffers=[NSMutableArray array];
        for(NSUInteger i=0;i<2;i++) {
            id<MTLBuffer> b=[dev newBufferWithLength:size options:MTLResourceStorageModePrivate];
            if(!b) return 3;
            [buffers addObject:b];
        }
        NSUInteger words=size/4, group=MIN((NSUInteger)256,pipe.maxTotalThreadsPerThreadgroup);
        for(uint32_t pass=0;pass<4;pass++) {
            for(NSUInteger i=0;i<buffers.count;i++) {
                uint32_t seed=0x13579BDFu ^ pass*0x01020304u ^ (uint32_t)i*0x9e3779b9u;
                id<MTLCommandBuffer> cb=[queue commandBuffer];
                if(!cb) return 3;
                id<MTLComputeCommandEncoder> ce=[cb computeCommandEncoder];
                if(!ce) return 3;
                [ce setComputePipelineState:pipe];
                [ce setBuffer:buffers[i] offset:0 atIndex:0];
                [ce setBytes:&seed length:sizeof(seed) atIndex:1];
                [ce dispatchThreads:MTLSizeMake(words,1,1) threadsPerThreadgroup:MTLSizeMake(group,1,1)];
                [ce endEncoding]; [cb commit]; [cb waitUntilCompleted];
                if(cb.status!=MTLCommandBufferStatusCompleted) {NSLog(@"GPU_COMMAND_ERROR=%@",cb.error);return 2;}
            }
            sleep(1);
            for(NSUInteger i=0;i<buffers.count;i++) {
                memset(readback.contents,0,size);
                id<MTLCommandBuffer> cb=[queue commandBuffer];
                if(!cb) return 3;
                id<MTLBlitCommandEncoder> be=[cb blitCommandEncoder];
                if(!be) return 3;
                [be copyFromBuffer:buffers[i] sourceOffset:0 toBuffer:readback destinationOffset:0 size:size];
                [be endEncoding]; [cb commit]; [cb waitUntilCompleted];
                if(cb.status!=MTLCommandBufferStatusCompleted) {NSLog(@"GPU_READBACK_ERROR=%@",cb.error);return 2;}
                uint32_t seed=0x13579BDFu ^ pass*0x01020304u ^ (uint32_t)i*0x9e3779b9u;
                const uint32_t *p=readback.contents;
                for(NSUInteger k=0;k<words;k++) {
                    uint32_t e=(uint32_t)k ^ seed ^ 0xA5A5A5A5u;
                    if(p[k]!=e) {
                        NSLog(@"GPU_MISMATCH chunk=%lu word=%lu expected=%08X actual=%08X attribution=UNCONFIRMED",(unsigned long)i,(unsigned long)k,e,p[k]);
                        return 2;
                    }
                }
            }
        }
        NSLog(@"GPU_DATA_PATH_PASS=%@ tested_private_mib=128",dev.name);
        return 0;
    }
}
int main(void) {
    @autoreleasepool {
        alarm(1800); // Process time bound; this cannot guarantee recovery from a driver/kernel hang.
        NSArray<id<MTLDevice>> *devices=MTLCopyAllDevices();
        if(!devices.count) return 3;
        int incomplete=0;
        for(id<MTLDevice> dev in devices) {
            int rc=testDevice(dev);
            if(rc==2) return 2;
            if(rc) incomplete=1;
        }
        alarm(0);
        if(incomplete) return 3;
        puts("ENGINE_COMPLETE=GPU_PASS");
        return 0;
    }
}
