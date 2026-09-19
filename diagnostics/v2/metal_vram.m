/* SPDX-License-Identifier: GPL-3.0-or-later
 * Experimental Metal/private-buffer test. Includes CPU/RAM/driver readback path.
 */
#import <Foundation/Foundation.h>
#import <Metal/Metal.h>
#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
static int deviceTest(id<MTLDevice> dev,NSUInteger requested){
 @autoreleasepool {
  const NSUInteger chunk=64u*1024u*1024u;
  NSUInteger target=MIN(requested*1024u*1024u,(NSUInteger)(dev.recommendedMaxWorkingSetSize/2));
  if(dev.maxBufferLength<chunk||target<chunk*2)return 3;
  NSUInteger chunks=target/chunk;
  if(chunks>32)chunks=32;
  NSLog(@"GPU=%@ private_mib=%lu lowPower=%d",dev.name,(unsigned long)(chunks*64),dev.isLowPower);
  NSError *error=nil;
  NSString *src=@"#include <metal_stdlib>\nusing namespace metal;\n"
    "kernel void fill(device uint *p [[buffer(0)]], constant uint &seed [[buffer(1)]], constant uint &mode [[buffer(2)]], uint i [[thread_position_in_grid]]) { uint v = i ^ seed ^ 0xA5A5A5A5u; if(mode==0) v=0xffffffffu; else if(mode==1) v=0; else if(mode==2) v=0xaa55aa55u; else if(mode==3) v=0x55aa55aau; p[i]=v; }\n";
  id<MTLLibrary> lib=[dev newLibraryWithSource:src options:nil error:&error];
  if(!lib){NSLog(@"SHADER_COMPILE_ERROR=%@",error);return 3;}
  id<MTLFunction> fn=[lib newFunctionWithName:@"fill"]; if(!fn)return 3;
  id<MTLComputePipelineState> pipe=[dev newComputePipelineStateWithFunction:fn error:&error];
  id<MTLCommandQueue> q=[dev newCommandQueue];
  if(!pipe||!q||!pipe.maxTotalThreadsPerThreadgroup)return 3;
  // Managed buffers with explicit GPU->CPU synchronization on discrete Intel Macs.
  BOOL unified=dev.hasUnifiedMemory;
  MTLResourceOptions option=unified?MTLResourceStorageModeShared:MTLResourceStorageModeManaged;
  id<MTLBuffer> rb=[dev newBufferWithLength:chunk options:option];
  if(!rb||!rb.contents)return 3;
  NSMutableArray<id<MTLBuffer>> *buffers=[NSMutableArray array];
  for(NSUInteger i=0;i<chunks;i++){
   id<MTLBuffer> b=[dev newBufferWithLength:chunk options:MTLResourceStorageModePrivate];
   if(!b)return 3;[buffers addObject:b];
  }
  NSUInteger words=chunk/4,group=MIN((NSUInteger)256,pipe.maxTotalThreadsPerThreadgroup);
  for(uint32_t pass=0;pass<6;pass++){
   for(NSUInteger i=0;i<chunks;i++){
    uint32_t seed=0x13579BDFu^pass*0x01020304u^(uint32_t)i*0x9e3779b9u;
    id<MTLCommandBuffer> cb=[q commandBuffer];if(!cb)return 3;
    id<MTLComputeCommandEncoder> ce=[cb computeCommandEncoder];if(!ce)return 3;
    [ce setComputePipelineState:pipe];[ce setBuffer:buffers[i] offset:0 atIndex:0];
    [ce setBytes:&seed length:4 atIndex:1];[ce setBytes:&pass length:4 atIndex:2];
    [ce dispatchThreads:MTLSizeMake(words,1,1) threadsPerThreadgroup:MTLSizeMake(group,1,1)];
    [ce endEncoding];[cb commit];[cb waitUntilCompleted];
    if(cb.status!=MTLCommandBufferStatusCompleted){NSLog(@"GPU_COMMAND_ERROR=%@",cb.error);return 3;}
   }
   sleep(2);
   for(NSUInteger i=0;i<chunks;i++){
    id<MTLCommandBuffer> cb=[q commandBuffer];if(!cb)return 3;
    id<MTLBlitCommandEncoder> be=[cb blitCommandEncoder];if(!be)return 3;
    [be copyFromBuffer:buffers[i] sourceOffset:0 toBuffer:rb destinationOffset:0 size:chunk];
    if(!unified)[be synchronizeResource:rb];
    [be endEncoding];[cb commit];[cb waitUntilCompleted];
    if(cb.status!=MTLCommandBufferStatusCompleted){NSLog(@"GPU_READBACK_ERROR=%@",cb.error);return 3;}
    const uint32_t *p=rb.contents;
    uint32_t seed=0x13579BDFu^pass*0x01020304u^(uint32_t)i*0x9e3779b9u;
    for(NSUInteger k=0;k<words;k++){
     uint32_t e=(uint32_t)k^seed^0xA5A5A5A5u;
     if(pass==0)e=0xffffffffu;else if(pass==1)e=0;else if(pass==2)e=0xaa55aa55u;else if(pass==3)e=0x55aa55aau;
     if(p[k]!=e){NSLog(@"GPU_MISMATCH pass=%u chunk=%lu word=%lu expected=%08X actual=%08X attribution=UNCONFIRMED",pass,(unsigned long)i,(unsigned long)k,e,p[k]);return 2;}
    }
   }
   NSLog(@"GPU_PATTERN_PASS=%u",pass);
  }
  NSLog(@"GPU_DEVICE_PASS=%@ private_mib=%lu",dev.name,(unsigned long)(chunks*64));return 0;
 }
}
int main(int argc,char **argv){
 @autoreleasepool {
  if(argc!=2||!*argv[1])return 3;
  for(char *p=argv[1];*p;p++)if(*p<'0'||*p>'9')return 3;
  errno=0;char *end;unsigned long n=strtoul(argv[1],&end,10);
  if(errno||*end||n<128||n>2048)return 3;
  NSArray<id<MTLDevice>> *devices=MTLCopyAllDevices();if(!devices.count)return 3;
  int worst=0;
  for(id<MTLDevice> dev in devices){int r=deviceTest(dev,(NSUInteger)n);if(r==2)return 2;if(r)worst=3;}
  if(!worst)puts("ENGINE_COMPLETE=GPU_PASS");return worst;
 }
}
