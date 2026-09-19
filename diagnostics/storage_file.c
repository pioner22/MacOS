/* SPDX-License-Identifier: GPL-3.0-or-later
 * Non-destructive allocated-file test; NEVER opens a block/character device.
 * New private directory and exclusive file, no overwrite, no automatic remount.
 */
#define _DEFAULT_SOURCE 1
#define _DARWIN_C_SOURCE 1
#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <limits.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/statvfs.h>
#include <unistd.h>
static volatile sig_atomic_t stop;
static void stopped(int sig) { (void)sig; stop=1; }
static uint64_t expected(uint64_t i) {
    i+=UINT64_C(0x9e3779b97f4a7c15);
    i=(i^(i>>30))*UINT64_C(0xbf58476d1ce4e5b9);
    i=(i^(i>>27))*UINT64_C(0x94d049bb133111eb);
    return i^(i>>31);
}
static int transfer(int fd,unsigned char *b,size_t len,off_t pos,int writing) {
    size_t done=0;
    while(done<len && !stop) {
        ssize_t n=writing?pwrite(fd,b+done,len-done,pos+(off_t)done):pread(fd,b+done,len-done,pos+(off_t)done);
        if(n<0 && errno==EINTR) continue;
        if(n<=0) { perror(writing?"WRITE_ERROR":"READ_ERROR_OR_EOF"); return 2; }
        done+=(size_t)n;
    }
    return stop?130:0;
}
int main(int argc,char **argv) {
    if(argc!=3) { fprintf(stderr,"usage: storage_file EXISTING_DIRECTORY MiB\n"); return 3; }
    for(char *p=argv[2];*p;p++) if(*p<'0'||*p>'9') return 3;
    errno=0; char *end; unsigned long long mib=strtoull(argv[2],&end,10);
    if(errno||*end||!mib||mib>8192) return 3;
    char parent[PATH_MAX], work[PATH_MAX], path[PATH_MAX];
    if(!realpath(argv[1],parent)) { perror("DIRECTORY"); return 3; }
    if(!strcmp(parent,"/dev") || !strncmp(parent,"/dev/",5)) return 3;
    struct stat st;
    if(stat(parent,&st)||!S_ISDIR(st.st_mode)) return 3;
    size_t len=1024*1024;
    uint64_t bytes=mib*len;
    struct statvfs fs;
    if(statvfs(parent,&fs) || !fs.f_frsize ||
       (uint64_t)fs.f_bavail < (bytes+268435456u)/fs.f_frsize+1) {
        puts("INSUFFICIENT_FREE_SPACE=1"); return 3;
    }
    if(snprintf(work,sizeof(work),"%s/macdiag-file.XXXXXX",parent)>=(int)sizeof(work)) return 3;
    if(!mkdtemp(work)) { perror("MKDTEMP"); return 3; }
    if(snprintf(path,sizeof(path),"%s/payload.bin",work)>=(int)sizeof(path)) {rmdir(work);return 3;}
    int fd=open(path,O_CREAT|O_EXCL|O_RDWR|O_NOFOLLOW,0600);
    if(fd<0) {perror("OPEN");rmdir(work);return 3;}
    if(fstat(fd,&st)||!S_ISREG(st.st_mode)||st.st_nlink!=1) {close(fd);return 3;}
    int nocache=0;
#ifdef __APPLE__
    nocache=fcntl(fd,F_NOCACHE,1)==0;
#endif
    setvbuf(stdout,NULL,_IOLBF,0);
    printf("STORAGE_SCOPE=ALLOCATED_FILE bytes=%" PRIu64 " cache_bypass=%d path=%s\n",bytes,nocache,path);
    puts("RAW_DEVICE_WRITE=DISABLED FULL_DISK_COVERAGE=NO");
    uint64_t *buf=malloc(len); int result=0;
    if(!buf) {close(fd);unlink(path);rmdir(work);return 3;}
    signal(SIGINT,stopped); signal(SIGTERM,stopped);
    for(uint64_t off=0;off<bytes;off+=len) {
        for(size_t i=0;i<len/8;i++) buf[i]=expected(off/8+i);
        result=transfer(fd,(unsigned char *)buf,len,(off_t)off,1);
        if(result) goto done;
    }
    if(fsync(fd)) {perror("FSYNC_ERROR");result=2;goto done;}
#ifdef __APPLE__
    if(fcntl(fd,F_FULLFSYNC)==0) puts("FLUSH=F_FULLFSYNC");
    else puts("FLUSH=FSYNC_ONLY power_loss_durability=UNPROVEN");
#else
    puts("FLUSH=FSYNC power_loss_durability=UNPROVEN");
#endif
#ifdef DIAG_TESTING
    if(getenv("MACDIAG_TEST_INJECT")) {
        uint64_t x=expected(0)^1;
        if(pwrite(fd,&x,sizeof(x),0)!=(ssize_t)sizeof(x)) {result=3;goto done;}
        puts("TEST_ONLY_INJECTED_FAULT=1");
    }
#endif
    for(unsigned pass=0;pass<2;pass++) {
        for(uint64_t off=0;off<bytes;off+=len) {
            memset(buf,0,len);
            result=transfer(fd,(unsigned char *)buf,len,(off_t)off,0);
            if(result) goto done;
            for(size_t i=0;i<len/8;i++) {
                uint64_t e=expected(off/8+i);
                if(buf[i]!=e) {
                    printf("STORAGE_MISMATCH byte=%" PRIu64 " expected=%016" PRIx64 " actual=%016" PRIx64 "\n",off+i*8,e,buf[i]);
                    result=2;goto done;
                }
            }
        }
        printf("STORAGE_READBACK_PASS=%u\n",pass+1);
    }
    puts("ENGINE_COMPLETE=STORAGE_FILE_PASS");
done:
    free(buf);
    if(close(fd) && !result) result=2;
    if(!result) {
        if(unlink(path)||rmdir(work)) {puts("CLEANUP_INCOMPLETE=1");result=3;}
    } else printf("EVIDENCE_FILE_RETAINED=%s\n",path);
    return result;
}
