/* SPDX-License-Identifier: GPL-3.0-or-later
 * Native userspace RAM verifier: fixed mmap, guard pages, volatile access.
 * No DRAM-chip address inference. A failed mlock limits coverage, not correctness.
 */
#define _DEFAULT_SOURCE 1
#define _DARWIN_C_SOURCE 1
#include <errno.h>
#include <inttypes.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <unistd.h>
#ifndef MAP_ANONYMOUS
#define MAP_ANONYMOUS MAP_ANON
#endif
static volatile sig_atomic_t stop;
static void stopped(int sig){(void)sig; stop=1;}
static uint64_t mix(uint64_t x){
    x^=x>>30; x*=UINT64_C(0xbf58476d1ce4e5b9);
    x^=x>>27; x*=UINT64_C(0x94d049bb133111eb); return x^(x>>31);
}
static uint64_t pat(unsigned p,size_t word,unsigned round){
    switch(p){
    case 0:return UINT64_MAX;
    case 1:return 0;
    case 2:return UINT64_C(0xaa55aa55aa55aa55);
    case 3:return UINT64_C(0x55aa55aa55aa55aa);
    case 4:return mix((uint64_t)word^((uint64_t)round<<40)^UINT64_C(0x72616d7465737431));
    case 5:return ~mix((uint64_t)word^((uint64_t)round<<40)^UINT64_C(0x72616d7465737431));
    default:return p<70?UINT64_C(1)<<(p-6):~(UINT64_C(1)<<(p-70));
    }
}
static int number(const char *s,uint64_t low,uint64_t high,uint64_t *out){
    if(!s||!*s)return 0;
    for(const char *p=s;*p;p++)if(*p<'0'||*p>'9')return 0;
    errno=0;char *end;uint64_t n=strtoull(s,&end,10);
    if(errno||*end||n<low||n>high)return 0;
    *out=n;return 1;
}
static int selftest(void){
    if(pat(0,0,0)!=UINT64_MAX||pat(1,0,0)!=0||
       pat(2,0,0)!=UINT64_C(0xaa55aa55aa55aa55)||
       (pat(2,0,0)^pat(3,0,0))!=UINT64_MAX||
       (pat(4,31,1)^pat(5,31,1))!=UINT64_MAX)return 3;
    for(unsigned p=6;p<70;p++)
        if(pat(p,0,0)!=(UINT64_C(1)<<(p-6))||
           (pat(p,0,0)^pat(p+64,0,0))!=UINT64_MAX)return 3;
    puts("NATIVE_SELFTEST=PASS");return 0;
}
int main(int argc,char **argv){
    if(argc==2&&!strcmp(argv[1],"--selftest"))return selftest();
    uint64_t mib,rounds,hold;
    if(argc!=5||!number(argv[1],1,49152,&mib)||!number(argv[2],1,8,&rounds)||
       !number(argv[4],0,60,&hold)||
       (strcmp(argv[3],"quick")&&strcmp(argv[3],"full")&&strcmp(argv[3],"map")))return 3;
    if(selftest())return 3;
    signal(SIGINT,stopped);signal(SIGTERM,stopped);
    long pg=sysconf(_SC_PAGESIZE);if(pg<=0||mib>SIZE_MAX/1048576u)return 3;
    size_t page=(size_t)pg,bytes=(size_t)mib*1048576u;
    if(bytes%page||bytes>SIZE_MAX-2*page)return 3;
    unsigned char *base=mmap(NULL,bytes+2*page,PROT_NONE,MAP_PRIVATE|MAP_ANONYMOUS,-1,0);
    if(base==MAP_FAILED){perror("MMAP");return 3;}
    unsigned char *data=base+page;
    if(mprotect(data,bytes,PROT_READ|PROT_WRITE)){perror("MPROTECT");munmap(base,bytes+2*page);return 3;}
    int locked=mlock(data,bytes)==0,lock_errno=locked?0:errno;
    volatile uint64_t *mem=(volatile uint64_t *)(void *)data;
    size_t words=bytes/8;
    setvbuf(stdout,NULL,_IOLBF,0);
    printf("RAM_ENGINE=NATIVE_C tested_bytes=%zu page_size=%zu mlock=%d lock_errno=%d\n",bytes,page,locked,lock_errno);
    puts("RAM_SCOPE=USERSPACE_ALLOCATION physical_chip=UNKNOWN cache_bypass=NOT_GUARANTEED");
    if(!locked)puts("RAM_COVERAGE_WARNING=UNLOCKED_PAGES_CAN_BE_PAGED_OR_COMPRESSED");
    int map_mode=!strcmp(argv[3],"map"),result=0;
    unsigned count=!strcmp(argv[3],"full")?134:6,completed=0;
    uint64_t errors=0,comparisons=0;
    for(unsigned r=0;r<rounds&&!stop;r++)for(unsigned p=0;p<count&&!stop;p++){
        printf("RAM_FILL round=%u pattern=%u\n",r+1,p);
        for(size_t i=0;i<words;i++){
            if((i&131071u)==0&&stop)break;
            mem[i]=pat(p,i,r);
        }
        if(stop)break;
#ifdef DIAG_TESTING
        if(getenv("MACDIAG_TEST_INJECT")&&r==0&&p==0){mem[words/2]^=1;puts("TEST_ONLY_INJECTED_FAULT=1");}
#endif
        for(unsigned s=0;s<hold&&!stop;s++)sleep(1);
        if(stop)break;
        uint64_t before=errors;
        for(size_t step=0;step<words;step++){
            if((step&131071u)==0&&stop)break;
            size_t i=(r&1u)?words-1-step:step;
            uint64_t e=pat(p,i,r),a=mem[i];comparisons++;
            if(a!=e){
                errors++;result=2;
                if(errors<=64){
                    printf("RAM_MISMATCH round=%u pattern=%u allocation_byte=%zu expected=%016" PRIx64 " actual=%016" PRIx64 " xor=%016" PRIx64 "\n",r+1,p,i*8,e,a,e^a);
                    for(unsigned n=0;n<3;n++)printf("RAM_REREAD allocation_byte=%zu n=%u actual=%016" PRIx64 "\n",i*8,n+1,mem[i]);
                }
                if(!map_mode||errors>=1024)goto done;
            }
        }
        if(!stop){completed++;printf("RAM_PATTERN_COMPLETE round=%u pattern=%u mismatch_words=%" PRIu64 "\n",r+1,p,errors-before);}
    }
done:
    if(stop&&!result)result=130;
    if(locked&&munlock(data,bytes)&&!result)result=3;
    if(munmap(base,bytes+2*page)&&!result)result=3;
    printf("RAM_SUMMARY mismatch_words=%" PRIu64 " comparisons=%" PRIu64 " patterns_completed=%u planned=%" PRIu64 "\n",errors,comparisons,completed,(uint64_t)count*rounds);
    if(!result&&completed!=(unsigned)(count*rounds))result=3;
    if(!result)puts("ENGINE_COMPLETE=RAM_PASS");
    else if(result==2)puts("ENGINE_COMPLETE=RAM_DATA_MISMATCH attribution=UNCONFIRMED");
    return result;
}
