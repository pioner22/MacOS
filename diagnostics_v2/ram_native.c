/* SPDX-License-Identifier: GPL-3.0-or-later
 * Independent userspace RAM verifier: fixed allocation, volatile loads/stores.
 * PASS is conditional on mlock and completion. No physical-chip attribution.
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
static volatile sig_atomic_t stopped, timeout_seen;
static void stop(int sig) { stopped=1; if(sig==SIGALRM) timeout_seen=1; }
static uint64_t mix(uint64_t x) {
    x^=x>>30; x*=UINT64_C(0xbf58476d1ce4e5b9);
    x^=x>>27; x*=UINT64_C(0x94d049bb133111eb); return x^(x>>31);
}
static uint64_t value(unsigned pat,size_t word,unsigned round) {
    switch(pat) {
    case 0:return UINT64_MAX;
    case 1:return 0;
    case 2:return UINT64_C(0xaa55aa55aa55aa55);
    case 3:return UINT64_C(0x55aa55aa55aa55aa);
    case 4:return mix(word^((uint64_t)round<<40)^UINT64_C(0x72616d7465737431));
    case 5:return ~mix(word^((uint64_t)round<<40)^UINT64_C(0x72616d7465737431));
    default: return pat<70?(UINT64_C(1)<<(pat-6)):~(UINT64_C(1)<<(pat-70));
    }
}
static int number(const char *s,uint64_t lo,uint64_t hi,uint64_t *out) {
    if(!s || !*s) return 0;
    for(const char *p=s;*p;p++) if(*p<'0'||*p>'9') return 0;
    char *end; errno=0; uint64_t n=strtoull(s,&end,10);
    if(errno||*end||n<lo||n>hi) return 0;
    *out=n; return 1;
}
static int selftest(void) {
    if(mix(0)!=0 || mix(1)!=UINT64_C(0x5692161d100b05e5)) return 3;
    if(value(0,0,0)!=UINT64_MAX || value(1,0,0)!=0) return 3;
    for(unsigned p=6;p<70;p++) if((value(p,0,0)^value(p+64,0,0))!=UINT64_MAX) return 3;
    puts("NATIVE_SELFTEST=PASS"); return 0;
}
int main(int argc,char **argv) {
    if(argc==2&&!strcmp(argv[1],"--selftest")) return selftest();
    uint64_t mib,rounds,hold,seconds;
    if(argc!=6 || !number(argv[1],1,49152,&mib)||!number(argv[2],1,16,&rounds)||
       !number(argv[4],0,60,&hold)||!number(argv[5],1,43200,&seconds)||
       (strcmp(argv[3],"quick")&&strcmp(argv[3],"full")&&strcmp(argv[3],"map"))) return 3;
    if(selftest()) return 3;
    setvbuf(stdout,NULL,_IOLBF,0);
    signal(SIGINT,stop);signal(SIGTERM,stop);signal(SIGALRM,stop);alarm((unsigned)seconds);
    long pz=sysconf(_SC_PAGESIZE);
    if(pz<=0 || mib>SIZE_MAX/1048576u) return 3;
    size_t page=(size_t)pz,bytes=(size_t)mib*1048576u,words=bytes/8;
    if(bytes%page || bytes>SIZE_MAX-2*page) return 3;
    void *base=mmap(NULL,bytes+2*page,PROT_NONE,MAP_PRIVATE|MAP_ANONYMOUS,-1,0);
    if(base==MAP_FAILED) {perror("MMAP");return 3;}
    void *data=(char *)base+page;
    if(mprotect(data,bytes,PROT_READ|PROT_WRITE)) {perror("MPROTECT");munmap(base,bytes+2*page);return 3;}
    int locked=mlock(data,bytes)==0;
    printf("RAM_ENGINE=NATIVE_C bytes=%zu page_size=%zu locked=%d errno=%d\n",bytes,page,locked,locked?0:errno);
    puts("RAM_SCOPE=USERSPACE_ALLOCATION physical_addresses=UNKNOWN cache_bypass=NOT_GUARANTEED");
    if(!locked) {puts("RAM_LIMIT=MLock_FAILED no_stress_started=1");munmap(base,bytes+2*page);return 3;}
    volatile uint64_t *mem=(volatile uint64_t *)data;
    unsigned pats=!strcmp(argv[3],"full")?134:6;
    uint64_t events=0,checks=0;int rc=0,mapmode=!strcmp(argv[3],"map");
    for(unsigned r=0;r<rounds&&!stopped;r++) for(unsigned p=0;p<pats&&!stopped;p++) {
        printf("RAM_FILL round=%u pattern=%u\n",r+1,p);
        for(size_t i=0;i<words;i++) {if(!(i&131071u)&&stopped) break;mem[i]=value(p,i,r);}
        if(stopped) break;
#ifdef DIAG_TESTING
        if(getenv("MACDIAG_TEST_INJECT")&&r==0&&p==0) {mem[words/2]^=1;puts("TEST_ONLY_INJECTED_FAULT=1");}
#endif
        for(unsigned s=0;s<hold&&!stopped;s++) sleep(1);
        for(size_t step=0;step<words&&!stopped;step++) {
            size_t i=(r&1u)?words-1-step:step;
            uint64_t actual=mem[i],expected=value(p,i,r);checks++;
            if(actual!=expected) {
                events++;rc=2;
                if(events<=64) {
                    printf("RAM_MISMATCH round=%u pattern=%u allocation_byte=%zu expected=%016" PRIx64 " actual=%016" PRIx64 " xor=%016" PRIx64 "\n",r+1,p,i*8,expected,actual,actual^expected);
                    for(unsigned k=0;k<3;k++) printf("RAM_REREAD byte=%zu repeat=%u actual=%016" PRIx64 "\n",i*8,k+1,mem[i]);
                }
                if(!mapmode||events>=1024) goto finish;
            }
        }
        if(!stopped) printf("RAM_PATTERN_COMPLETE round=%u pattern=%u cumulative_errors=%" PRIu64 "\n",r+1,p,events);
    }
finish:
    if(stopped&&!rc) rc=timeout_seen?3:130;
    alarm(0);munlock(data,bytes);
    if(munmap(base,bytes+2*page)&&!rc) rc=3;
    if(timeout_seen) puts("ENGINE_TIMEOUT=1");
    printf("RAM_SUMMARY mismatch_words=%" PRIu64 " comparisons=%" PRIu64 " completed=%d\n",events,checks,rc==0);
    if(rc==0) puts("ENGINE_COMPLETE=RAM_PASS");
    if(rc==2) puts("ENGINE_COMPLETE=RAM_DATA_MISMATCH component_attribution=UNCONFIRMED");
    return rc;
}
