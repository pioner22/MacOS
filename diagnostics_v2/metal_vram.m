/* SPDX-License-Identifier: GPL-3.0-or-later
 * Experimental Metal path test, NOT physical VRAM isolation. Requires macOS 10.15+.
 */
#import <Foundation/Foundation.h>
#import <Metal/Metal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
static uint32_t reference(uint32_t index,uint32_t seed,uint32_t mode){
    if(mode==0)return 0xffffffffu;
    if(mode==1)return 0;
    if(mode==2)return 0xaa55aa55u;
    if(mode==3)return 0x55aa55aau;
    return index^seed^0xa5a5a5a5u;
}
static int testDevice(id<MTLDevice> dev,NSUInteger requested){
    @autoreleasepool{
        const NSUInteger size=64u*1024u*1024u;
        NSUInteger count=requested/64u;
        if(!count||dev.maxBufferLength<size||dev.recommendedMaxWorkingSetSize<size*(count+1)*2)return 3;
        NSLog(@"GPU=%@ requested_private_mib=%lu lowPower=%d",dev.name,(unsigned long)requested,dev.isLowPower);
        NSError *err=nil;
        NSString *src=@"#include <metal_stdlib>\nusing namespace metal;\n"
          "kernel void fill(device uint *out [[buffer(0)]], constant uint2 &s [[buffer(1)]], uint i [[thread_position_in_grid]]) { uint m=s.y;out[i]=m==0?0xffffffffu:m==1?0u:m==2?0xaa55aa55u:m==3?0x55aa55aau:i^s.x^0xa5a5a5a5u;}\n";
        id<MTLLibrary> lib=[dev newLibraryWithSource:src options:nil error:&err];if(!lib){NSLog(@"SHADER_ERROR=%@",err);return 3;}
        id<MTLFunction> fn=[lib newFunctionWithName:@"fill"];if(!fn)return 3;
        id<MTLComputePipelineState> pipe=[dev newComputePipelineStateWithFunction:fn error:&err];
        id<MTLCommandQueue> q=[dev newCommandQueue];if(!pipe||!q||!pipe.maxTotalThreadsPerThreadgroup)return 3;
        NSMutableArray<id<MTLBuffer>> *buffers=[NSMutableArray array];
        for(NSUInteger i=0;i<count;i++){id<MTLBuffer> b=[dev newBufferWithLength:size options:MTLResourceStorageModePrivate];if(!b)return 3;[buffers addObject:b];}
        BOOL unified=dev.hasUnifiedMemory;
        MTLResourceOptions mode=unified?MTLResourceStorageModeShared:MTLResourceStorageModeManaged;
        id<MTLBuffer> readback=[dev newBufferWithLength:size options:mode];if(!readback||!readback.contents)return 3;
        NSUInteger words=size/4,group=MIN((NSUInteger)256,pipe.maxTotalThreadsPerThreadgroup);
        for(uint32_t pass=0;pass<8;pass++){
            for(NSUInteger i=0;i<count;i++){
                uint32_t param[2]={0x13579bdfu^pass*0x01020304u^(uint32_t)i*0x9e3779b9u,pass};
                id<MTLCommandBuffer> cb=[q commandBuffer];if(!cb)return 3;
                id<MTLComputeCommandEncoder> ce=[cb computeCommandEncoder];if(!ce)return 3;
                [ce setComputePipelineState:pipe];[ce setBuffer:buffers[i] offset:0 atIndex:0];[ce setBytes:param length:sizeof(param) atIndex:1];
                [ce dispatchThreads:MTLSizeMake(words,1,1) threadsPerThreadgroup:MTLSizeMake(group,1,1)];[ce endEncoding];[cb commit];[cb waitUntilCompleted];
                if(cb.status!=MTLCommandBufferStatusCompleted){NSLog(@"GPU_COMMAND_ERROR=%@",cb.error);return 2;}
            }
            sleep(1);
            for(NSUInteger i=0;i<count;i++){
                // GPU overwrites the complete readback; no CPU dirty managed range.
                id<MTLCommandBuffer> cb=[q commandBuffer];if(!cb)return 3;
                id<MTLBlitCommandEncoder> be=[cb blitCommandEncoder];if(!be)return 3;
                [be copyFromBuffer:buffers[i] sourceOffset:0 toBuffer:readback destinationOffset:0 size:size];if(!unified)[be synchronizeResource:readback];[be endEncoding];[cb commit];[cb waitUntilCompleted];
                if(cb.status!=MTLCommandBufferStatusCompleted){NSLog(@"GPU_READBACK_ERROR=%@",cb.error);return 2;}
                uint32_t seed=0x13579bdfu^pass*0x01020304u^(uint32_t)i*0x9e3779b9u;
                const uint32_t *p=readback.contents;
                for(NSUInteger k=0;k<words;k++){uint32_t e=reference((uint32_t)k,seed,pass);if(p[k]!=e){NSLog(@"GPU_DATA_MISMATCH pass=%u chunk=%lu word=%lu expected=%08X actual=%08X attribution=UNCONFIRMED",pass,(unsigned long)i,(unsigned long)k,e,p[k]);return 2;}}
            }
            NSLog(@"GPU_PATTERN_PASS=%u",pass);
        }
        NSLog(@"GPU_DEVICE_PASS=%@ private_mib=%lu",dev.name,(unsigned long)requested);return 0;
    }
}
int main(int argc,const char **argv){
    @autoreleasepool{
        unsigned long mib=256;
        if(argc>2)return 3;
        if(argc==2){char *end=NULL;mib=strtoul(argv[1],&end,10);if(!*argv[1]||*end||mib<64||mib>2048||mib%64)return 3;}
        alarm(1800);
        NSArray<id<MTLDevice>> *devices=MTLCopyAllDevices();if(!devices.count)return 3;
        int incomplete=0;
        for(id<MTLDevice> dev in devices){int rc=testDevice(dev,(NSUInteger)mib);if(rc==2)return 2;if(rc)incomplete=1;}
        alarm(0);if(incomplete)return 3;
        puts("ENGINE_COMPLETE=GPU_PASS");return 0;
    }
}
