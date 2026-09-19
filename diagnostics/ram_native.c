/* SPDX-License-Identifier: GPL-3.0-or-later
 * Independent userspace RAM verifier. No disk writes, no physical-address claims.
 * Compile: cc -std=c11 -O2 -Wall -Wextra -Werror ram_native.c -o ram_native
 */
#define _DEFAULT_SOURCE 1
#define _DARWIN_C_SOURCE 1
#include <errno.h>
#include <inttypes.h>
#include <limits.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <time.h>
#include <unistd.h>
#ifndef MAP_ANONYMOUS
#define MAP_ANONYMOUS MAP_ANON
#endif
static volatile sig_atomic_t stopped, timed_out;
static void stop_handler(int sig) { if(sig==SIGALRM) timed_out=1; stopped = 1; }
static uint64_t mix64(uint64_t x) {
    x ^= x >> 30; x *= UINT64_C(0xbf58476d1ce4e5b9);
    x ^= x >> 27; x *= UINT64_C(0x94d049bb133111eb);
    return x ^ (x >> 31);
}
static uint64_t pattern(unsigned pat, size_t word, unsigned round) {
    switch (pat) {
    case 0: return UINT64_MAX;
    case 1: return 0;
    case 2: return UINT64_C(0xaa55aa55aa55aa55);
    case 3: return UINT64_C(0x55aa55aa55aa55aa);
    case 4: return mix64((uint64_t)word ^ ((uint64_t)round << 40) ^ UINT64_C(0x72616d7465737431));
    case 5: return ~mix64((uint64_t)word ^ ((uint64_t)round << 40) ^ UINT64_C(0x72616d7465737431));
    default:
        if (pat < 70) return UINT64_C(1) << (pat - 6);
        return ~(UINT64_C(1) << (pat - 70));
    }
}
static int number(const char *s, uint64_t low, uint64_t high, uint64_t *v) {
    if (!s || !*s || *s == '-' || *s == '+') return 0;
    for (const char *p=s; *p; ++p) if (*p<'0' || *p>'9') return 0;
    char *end; errno=0;
    uint64_t n=strtoull(s,&end,10);
    if (errno || *end || n<low || n>high) return 0;
    *v=n; return 1;
}
static int selftest(void) {
    if (pattern(0,0,0)!=UINT64_MAX || pattern(1,0,0)!=0 ||
        pattern(2,0,0)!=UINT64_C(0xaa55aa55aa55aa55) ||
        pattern(3,0,0)!=UINT64_C(0x55aa55aa55aa55aa) ||
        (pattern(4,31,1)^pattern(5,31,1))!=UINT64_MAX) return 3;
    for(unsigned p=6;p<70;p++)
        if(pattern(p,0,0)!=(UINT64_C(1)<<(p-6)) ||
           (pattern(p,0,0)^pattern(p+64,0,0))!=UINT64_MAX) return 3;
    puts("NATIVE_SELFTEST=PASS"); return 0;
}
int main(int argc, char **argv) {
    if(argc==2 && !strcmp(argv[1],"--selftest")) return selftest();
    if(argc!=5) { fprintf(stderr,"usage: ram_native MiB rounds quick|full|map hold_seconds\n"); return 3; }
    uint64_t mib, rounds, hold;
    if(!number(argv[1],1,49152,&mib) || !number(argv[2],1,16,&rounds) ||
       !number(argv[4],0,60,&hold) ||
       (strcmp(argv[3],"quick") && strcmp(argv[3],"full") && strcmp(argv[3],"map"))) return 3;
    if(selftest()!=0) return 3;
    long pz=sysconf(_SC_PAGESIZE);
    if(pz<=0 || mib>SIZE_MAX/1048576u) return 3;
    size_t page=(size_t)pz, bytes=(size_t)mib*1048576u;
    if(bytes%page || bytes>SIZE_MAX-2*page) return 3;
    size_t mapping=bytes+2*page, words=bytes/sizeof(uint64_t);
    unsigned char *base=mmap(NULL,mapping,PROT_NONE,MAP_PRIVATE|MAP_ANONYMOUS,-1,0);
    if(base==MAP_FAILED) { perror("MMAP"); return 3; }
    unsigned char *data=base+page;
    if(mprotect(data,bytes,PROT_READ|PROT_WRITE)) { perror("MPROTECT"); munmap(base,mapping); return 3; }
    int locked=mlock(data,bytes)==0;
    int lock_errno=locked?0:errno;
    volatile uint64_t *mem=(volatile uint64_t *)(void *)data;
    signal(SIGINT,stop_handler); signal(SIGTERM,stop_handler);
    signal(SIGALRM,stop_handler); alarm(1800);
    setvbuf(stdout,NULL,_IOLBF,0);
    printf("RAM_ENGINE=NATIVE_C tested_bytes=%zu page_size=%zu mlock=%d lock_errno=%d\n",bytes,page,locked,lock_errno);
    puts("RAM_SCOPE=USERSPACE_VIRTUAL_ALLOCATION physical_chip=UNKNOWN cache_bypass=NOT_GUARANTEED");
    if(!locked) puts("RAM_COVERAGE_WARNING=UNLOCKED_PAGES_CAN_BE_PAGED_OR_COMPRESSED");
    unsigned count=!strcmp(argv[3],"full")?134:6;
    int map_mode=!strcmp(argv[3],"map"), result=0;
    uint64_t events=0, comparisons=0;
    for(unsigned r=0;r<rounds && !stopped;r++) {
        for(unsigned p=0;p<count && !stopped;p++) {
            printf("RAM_FILL round=%u pattern=%u\n",r+1,p);
            for(size_t i=0;i<words;i++) {
                if((i & 131071u)==0 && stopped) break;
                mem[i]=pattern(p,i,r);
            }
            if(stopped) break;
#ifdef DIAG_TESTING
            /* Fault injection is excluded from production builds. */
            if(getenv("MACDIAG_TEST_INJECT") && r==0 && p==0) {
                mem[words/2]^=UINT64_C(1);
                puts("TEST_ONLY_INJECTED_FAULT=1");
            }
#endif
            for(unsigned s=0;s<hold && !stopped;s++) sleep(1);
            if(stopped) break;
            uint64_t before=events;
            for(size_t step=0;step<words;step++) {
                if((step & 131071u)==0 && stopped) break;
                size_t i=(r & 1u)?words-1-step:step;
                uint64_t expected=pattern(p,i,r), actual=mem[i];
                comparisons++;
                if(actual!=expected) {
                    events++;
                    if(events<=64)
                        printf("RAM_MISMATCH round=%u pattern=%u allocation_byte=%zu expected=%016" PRIx64 " actual=%016" PRIx64 " xor=%016" PRIx64 "\n",r+1,p,i*8,expected,actual,expected^actual);
                    /* Recheck the original allocation, not a copied page. */
                    if(events<=64) for(unsigned n=0;n<3;n++)
                        printf("RAM_REREAD allocation_byte=%zu n=%u actual=%016" PRIx64 "\n",i*8,n+1,mem[i]);
                    result=2;
                    if(!map_mode || events>=1024) goto finish;
                }
            }
            if(!stopped) printf("RAM_PATTERN_COMPLETE round=%u pattern=%u mismatch_words=%" PRIu64 "\n",r+1,p,events-before);
        }
    }
finish:
    if(stopped && !result) result=timed_out?3:130;
    alarm(0);
    if(timed_out) puts("ENGINE_TIMEOUT=1");
    if(locked) munlock(data,bytes);
    if(munmap(base,mapping)!=0 && !result) result=3;
    printf("RAM_SUMMARY mismatch_words=%" PRIu64 " comparisons=%" PRIu64 " completed=%d\n",events,comparisons,result==0);
    if(result==0) puts("ENGINE_COMPLETE=RAM_PASS");
    else if(result==2) puts("ENGINE_COMPLETE=RAM_DATA_MISMATCH component_attribution=UNCONFIRMED");
    return result;
}
