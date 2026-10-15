#import <Foundation/Foundation.h>
#import <Metal/Metal.h>

static int testDevice(id<MTLDevice> dev, NSUInteger requestedMiB) {
    @autoreleasepool {
        NSLog(@"GPU_DEVICE name=%@ lowPower=%d removable=%d headless=%d registryID=%llu",
              dev.name, dev.isLowPower, dev.isRemovable, dev.isHeadless, dev.registryID);

        NSUInteger targetMiB = requestedMiB;
        if ([dev respondsToSelector:@selector(recommendedMaxWorkingSetSize)]) {
            uint64_t rec = dev.recommendedMaxWorkingSetSize;
            NSLog(@"GPU_RECOMMENDED_WORKING_SET=%llu", rec);
            NSUInteger halfMiB = (NSUInteger)(rec / 2 / 1024 / 1024);
            if (halfMiB >= 256 && targetMiB > halfMiB) targetMiB = halfMiB;
        }
        if (dev.isLowPower && targetMiB > 1024) targetMiB = 1024;
        if (targetMiB < 256) targetMiB = 256;

        NSError *error = nil;
        NSString *src = @"#include <metal_stdlib>\n"
                         "using namespace metal;\n"
                         "kernel void fill(device uint *out [[buffer(0)]], constant uint &seed [[buffer(1)]], uint gid [[thread_position_in_grid]]) { out[gid] = gid ^ seed ^ 0xA5A5A5A5u; }\n";
        id<MTLLibrary> lib = [dev newLibraryWithSource:src options:nil error:&error];
        if (!lib) { NSLog(@"GPU_SHADER_COMPILE_FAIL %@", error); return 3; }
        id<MTLFunction> fn = [lib newFunctionWithName:@"fill"];
        id<MTLComputePipelineState> pipe = [dev newComputePipelineStateWithFunction:fn error:&error];
        if (!pipe) { NSLog(@"GPU_PIPELINE_FAIL %@", error); return 3; }
        id<MTLCommandQueue> q = [dev newCommandQueue];
        if (!q) { NSLog(@"GPU_QUEUE_FAIL"); return 3; }

        const NSUInteger chunkMiB = 64;
        const NSUInteger chunkBytes = chunkMiB * 1024 * 1024;
        NSUInteger chunks = targetMiB / chunkMiB;
        if (chunks < 1) chunks = 1;
        NSMutableArray<id<MTLBuffer>> *priv = [NSMutableArray arrayWithCapacity:chunks];
        for (NSUInteger i=0; i<chunks; i++) {
            id<MTLBuffer> b = [dev newBufferWithLength:chunkBytes options:MTLResourceStorageModePrivate];
            if (!b) { NSLog(@"GPU_ALLOC_FAIL chunk=%lu requested_mib=%lu", (unsigned long)i, (unsigned long)targetMiB); return 4; }
            [priv addObject:b];
        }
        id<MTLBuffer> seedBuf = [dev newBufferWithLength:sizeof(uint32_t) options:MTLResourceStorageModeShared];
        id<MTLBuffer> readback = [dev newBufferWithLength:chunkBytes options:MTLResourceStorageModeShared];
        if (!seedBuf || !readback) { NSLog(@"GPU_SHARED_ALLOC_FAIL"); return 4; }

        NSUInteger nUint = chunkBytes / sizeof(uint32_t);
        NSUInteger tg = MIN((NSUInteger)256, pipe.maxTotalThreadsPerThreadgroup);
        MTLSize grid = MTLSizeMake(nUint,1,1);
        MTLSize group = MTLSizeMake(tg,1,1);
        int totalErrors = 0;

        for (NSUInteger pass=0; pass<4; pass++) {
            NSLog(@"GPU_PASS_START pass=%lu target_mib=%lu chunks=%lu", (unsigned long)pass, (unsigned long)(chunks*chunkMiB), (unsigned long)chunks);
            for (NSUInteger i=0; i<chunks; i++) {
                uint32_t seed = (uint32_t)(0x13579BDFu ^ (uint32_t)(pass*0x1020304u) ^ (uint32_t)(i*0x9E3779B9u));
                memcpy(seedBuf.contents, &seed, sizeof(seed));
                id<MTLCommandBuffer> cb = [q commandBuffer];
                id<MTLComputeCommandEncoder> ce = [cb computeCommandEncoder];
                [ce setComputePipelineState:pipe];
                [ce setBuffer:priv[i] offset:0 atIndex:0];
                [ce setBuffer:seedBuf offset:0 atIndex:1];
                [ce dispatchThreads:grid threadsPerThreadgroup:group];
                [ce endEncoding];
                [cb commit];
                [cb waitUntilCompleted];
                if (cb.status == MTLCommandBufferStatusError) { NSLog(@"GPU_COMMAND_ERROR pass=%lu chunk=%lu error=%@",(unsigned long)pass,(unsigned long)i,cb.error); return 5; }
            }

            [NSThread sleepForTimeInterval:5.0];

            for (NSUInteger i=0; i<chunks; i++) {
                memset(readback.contents, 0, chunkBytes);
                id<MTLCommandBuffer> cb = [q commandBuffer];
                id<MTLBlitCommandEncoder> be = [cb blitCommandEncoder];
                [be copyFromBuffer:priv[i] sourceOffset:0 toBuffer:readback destinationOffset:0 size:chunkBytes];
                [be endEncoding];
                [cb commit];
                [cb waitUntilCompleted];
                if (cb.status == MTLCommandBufferStatusError) { NSLog(@"GPU_READBACK_ERROR pass=%lu chunk=%lu error=%@",(unsigned long)pass,(unsigned long)i,cb.error); return 5; }

                uint32_t seed = (uint32_t)(0x13579BDFu ^ (uint32_t)(pass*0x1020304u) ^ (uint32_t)(i*0x9E3779B9u));
                uint32_t *p = (uint32_t *)readback.contents;
                int chunkErrors=0;
                for (NSUInteger k=0; k<nUint; k++) {
                    uint32_t expected = (uint32_t)k ^ seed ^ 0xA5A5A5A5u;
                    if (p[k] != expected) {
                        if (chunkErrors < 16) NSLog(@"GPU_VRAM_MISMATCH pass=%lu chunk=%lu word=%lu expected=%08X actual=%08X xor=%08X",
                            (unsigned long)pass,(unsigned long)i,(unsigned long)k,expected,p[k],expected^p[k]);
                        chunkErrors++; totalErrors++;
                    }
                }
                if (chunkErrors) NSLog(@"GPU_CHUNK_FAIL pass=%lu chunk=%lu errors=%d",(unsigned long)pass,(unsigned long)i,chunkErrors);
                else if ((i % 4)==0) NSLog(@"GPU_VERIFY_PROGRESS pass=%lu chunk=%lu/%lu",(unsigned long)pass,(unsigned long)i,(unsigned long)chunks);
            }
            NSLog(@"GPU_PASS_END pass=%lu cumulative_errors=%d",(unsigned long)pass,totalErrors);
            if (totalErrors) return 2;
        }
        NSLog(@"GPU_DEVICE_PASS name=%@ tested_mib=%lu passes=4",dev.name,(unsigned long)(chunks*chunkMiB));
        return 0;
    }
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        NSUInteger requestedMiB = 1024;
        if (argc > 1) requestedMiB = (NSUInteger)strtoull(argv[1], NULL, 10);
        NSArray<id<MTLDevice>> *devices = MTLCopyAllDevices();
        if (devices.count == 0) { NSLog(@"GPU_NO_METAL_DEVICES"); return 3; }
        int worst=0;
        for (id<MTLDevice> dev in devices) {
            int rc=testDevice(dev,requestedMiB);
            if (rc==2 || rc==5) return rc;
            if (rc>worst) worst=rc;
        }
        return worst;
    }
}
