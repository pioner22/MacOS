/* SPDX-License-Identifier: GPL-3.0-or-later
 * Non-destructive file write/read verifier. Never opens a raw/block device.
 * storage: bounded buffer. bridge: retains and locks the entire source in RAM.
 */
#define _DEFAULT_SOURCE 1
#define _DARWIN_C_SOURCE 1
#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <sys/statvfs.h>
#include <time.h>
#include <unistd.h>
#ifndef MAP_ANONYMOUS
#define MAP_ANONYMOUS MAP_ANON
#endif
static volatile sig_atomic_t stopped,timedout;
static void stop(int sig){stopped=1;if(sig==SIGALRM)timedout=1;}
static uint64_t pattern(uint64_t i,unsigned pass){
    uint64_t x=i^UINT64_C(0x73746f7261676532)^((uint64_t)pass<<48);
    x^=x>>30;x*=UINT64_C(0xbf58476d1ce4e5b9);x^=x>>27;x*=UINT64_C(0x94d049bb133111eb);return x^(x>>31);
}
static int number(const char *s,uint64_t lo,uint64_t hi,uint64_t *out){
    if(!s||!*s)return 0;
    for(const char *p=s;*p;p++)if(*p<'0'||*p>'9')return 0;
    char *end;errno=0;uint64_t x=strtoull(s,&end,10);
    if(errno||*end||x<lo||x>hi)return 0;
    *out=x;return 1;
}
static int io_code(const char *op){
    int e=errno;printf("IO_ERROR operation=%s errno=%d\n",op,e);
    return (e==EIO
#ifdef EDEVERR
            ||e==EDEVERR
#endif
           )?2:3; /* ENOSPC, permissions, resources are not media diagnoses. */
}
static int transfer(int fd,void *buf,size_t n,int writing){
    size_t p=0;
    while(p<n&&!stopped){
        ssize_t z=writing?write(fd,(char *)buf+p,n-p):read(fd,(char *)buf+p,n-p);
        if(z<0){if(errno==EINTR)continue;return io_code(writing?"write":"read");}
        if(!z){puts("IO_ERROR=UNEXPECTED_EOF_OR_ZERO_WRITE");return 2;}p+=(size_t)z;
    }
    return stopped?(timedout?3:130):0;
}
static void fill(volatile uint64_t *p,size_t n,uint64_t offset,unsigned pass){
    for(size_t i=0;i<n&&!stopped;i++)p[i]=pattern(offset+i,pass);
}
static int verify(volatile uint64_t *p,size_t n,uint64_t offset,unsigned pass,const char *scope){
    for(size_t i=0;i<n&&!stopped;i++){
        uint64_t e=pattern(offset+i,pass),a=p[i];
        if(e!=a){printf("DATA_MISMATCH scope=%s byte=%" PRIu64 " expected=%016" PRIx64 " actual=%016" PRIx64 "\n",scope,(offset+i)*8,e,a);return 2;}
    }
    return stopped?(timedout?3:130):0;
}
static int nocache(int fd){
#ifdef __APPLE__
    if(fcntl(fd,F_NOCACHE,1)){perror("F_NOCACHE");return 0;}
    puts("CACHE_POLICY=F_NOCACHE");return 1;
#else
    (void)fd;puts("CACHE_POLICY=LINUX_QA_NOT_MACOS_MEDIA_PROOF");return 0;
#endif
}
int main(int argc,char **argv){
    uint64_t mib,rounds,budget;int bridge;
    if(argc!=6 || (strcmp(argv[1],"storage")&&strcmp(argv[1],"bridge")) ||
       !number(argv[2],1,49152,&mib)||!number(argv[3],1,4,&rounds)||!number(argv[5],1,43200,&budget))return 3;
    bridge=!strcmp(argv[1],"bridge");
    char *path=realpath(argv[4],NULL);
    if(!path)return io_code("realpath");
    if(!strcmp(path,"/")||!strcmp(path,"/dev")||!strncmp(path,"/dev/",5)){free(path);puts("REFUSED=DEVICE_OR_ROOT_PATH");return 3;}
    int dir=open(path,O_RDONLY|O_DIRECTORY|O_NOFOLLOW);if(dir<0){free(path);return io_code("open_directory");}
    struct statvfs fs;uint64_t bytes=mib*1048576u;
    if(fstatvfs(dir,&fs)||fs.f_frsize==0){close(dir);free(path);return 3;}
    uint64_t avail=(uint64_t)fs.f_bavail*fs.f_frsize,reserve=avail/10;
    if(reserve<1073741824u)reserve=1073741824u;
    if(avail<reserve || bytes>avail-reserve){puts("LIMIT=INSUFFICIENT_FREE_SPACE");close(dir);free(path);return 3;}
    if(bytes>SIZE_MAX){close(dir);free(path);return 3;}
    setvbuf(stdout,NULL,_IOLBF,0);signal(SIGINT,stop);signal(SIGTERM,stop);signal(SIGALRM,stop);alarm((unsigned)budget);
    size_t cb=8u*1048576u,alloc=bridge?(size_t)bytes:cb;
    volatile uint64_t *source=mmap(NULL,alloc,PROT_READ|PROT_WRITE,MAP_PRIVATE|MAP_ANONYMOUS,-1,0);
    if(source==MAP_FAILED){close(dir);free(path);return 3;}
    int locked=0;
    if(bridge && !(locked=mlock((void *)source,alloc)==0)){
        perror("BRIDGE_MLOCK");munmap((void *)source,alloc);close(dir);free(path);return 3;
    }
    uint64_t *readbuf=malloc(cb);if(!readbuf){if(locked)munlock((void *)source,alloc);munmap((void *)source,alloc);close(dir);free(path);return 3;}
    char name[128];int fd=-1;
    for(unsigned n=0;n<100;n++){
        snprintf(name,sizeof name,".macdiag-test-%ld-%ld-%u.bin",(long)getpid(),(long)time(NULL),n);
        fd=openat(dir,name,O_RDWR|O_CREAT|O_EXCL|O_NOFOLLOW,0600);
        if(fd>=0||errno!=EEXIST)break;
    }
    int rc=0,cache_ok=1;struct stat original={0};
    if(fd<0){rc=io_code("create_exclusive_file");goto cleanup;}
    if(fstat(fd,&original)||!S_ISREG(original.st_mode)){rc=3;goto cleanup;}
    printf("TEST_FILE=%s/%s\nTEST_BYTES=%" PRIu64 " MODE=%s\n",path,name,bytes,argv[1]);
    cache_ok=nocache(fd);
    for(unsigned pass=0;pass<rounds&&!stopped;pass++){
        if(bridge){
            fill(source,(size_t)bytes/8,0,pass);
            if((rc=verify(source,(size_t)bytes/8,0,pass,"RAM_PREWRITE")))goto cleanup;
            puts("BRIDGE_RAM_PREVERIFY=PASS");
        }
        if(lseek(fd,0,SEEK_SET)<0){rc=io_code("seek");goto cleanup;}
        for(uint64_t off=0;off<bytes&&!stopped;off+=cb){
            size_t len=(size_t)((bytes-off)<cb?bytes-off:cb);
            void *chunk;
            if(bridge)chunk=(char *)(void *)source+(size_t)off;
            else{fill(source,len/8,off/8,pass);chunk=(void *)source;}
            if((rc=transfer(fd,chunk,len,1)))goto cleanup;
            if(off%(256u*1048576u)==0)printf("FILE_WRITE pass=%u bytes_done=%" PRIu64 "\n",pass+1,off+len);
        }
        if(stopped){rc=timedout?3:130;goto cleanup;}
        if(fsync(fd)){rc=io_code("fsync");goto cleanup;}
#ifdef __APPLE__
        if(fcntl(fd,F_FULLFSYNC,0)){perror("F_FULLFSYNC");cache_ok=0;}
#else
        cache_ok=0;
#endif
        if(bridge){if((rc=verify(source,(size_t)bytes/8,0,pass,"RAM_POSTWRITE")))goto cleanup;puts("BRIDGE_RAM_POSTVERIFY=PASS");}
#ifdef DIAG_TESTING
        if(getenv("MACDIAG_TEST_FILE_INJECT")&&pass==0){unsigned char bad=0;if(pread(fd,&bad,1,13)!=1){rc=3;goto cleanup;}bad^=1;if(pwrite(fd,&bad,1,13)!=1||fsync(fd)){rc=3;goto cleanup;}puts("TEST_ONLY_FILE_FAULT=1");}
#endif
        if(close(fd)){fd=-1;rc=io_code("close_writer");goto cleanup;}fd=-1;
        for(unsigned reread=0;reread<2;reread++){
            fd=openat(dir,name,O_RDONLY|O_NOFOLLOW);if(fd<0){rc=io_code("reopen");goto cleanup;}
            struct stat st;
            if(fstat(fd,&st)||st.st_ino!=original.st_ino||st.st_dev!=original.st_dev||!S_ISREG(st.st_mode)){rc=3;goto cleanup;}
            if((uint64_t)st.st_size!=bytes){puts("DATA_MISMATCH=FILE_SIZE");rc=2;goto cleanup;}
            if(!nocache(fd))cache_ok=0;
            for(uint64_t off=0;off<bytes&&!stopped;off+=cb){
                size_t len=(size_t)((bytes-off)<cb?bytes-off:cb);
                if((rc=transfer(fd,readbuf,len,0)))goto cleanup;
                if((rc=verify(readbuf,len/8,off/8,pass,"FILE_READBACK")))goto cleanup;
            }
            if(stopped){rc=timedout?3:130;goto cleanup;}
            printf("FILE_READBACK_PASS pass=%u reread=%u\n",pass+1,reread+1);
            if(close(fd)){fd=-1;rc=io_code("close_reader");goto cleanup;}fd=-1;
        }
        if(pass+1<rounds){
            fd=openat(dir,name,O_RDWR|O_NOFOLLOW);if(fd<0){rc=io_code("reopen_writer");goto cleanup;}
            struct stat st;if(fstat(fd,&st)||st.st_ino!=original.st_ino||st.st_dev!=original.st_dev){rc=3;goto cleanup;}
            if(!nocache(fd))cache_ok=0;
        }
    }
cleanup:
    alarm(0);if(fd>=0&&close(fd)&&!rc)rc=3;
    if(locked)munlock((void *)source,alloc);
    munmap((void *)source,alloc);free(readbuf);
    /* Preserve only a failed test file; never remove anything we did not create. */
    if(fd>=0 || original.st_ino){
        struct stat s;
        if(fstatat(dir,name,&s,AT_SYMLINK_NOFOLLOW)==0 && s.st_ino==original.st_ino && s.st_dev==original.st_dev){
            if(rc==2)printf("FAILED_TEST_FILE_PRESERVED=%s/%s\n",path,name);
            else if(unlinkat(dir,name,0)&&!rc)rc=3;
        } else if(!rc){puts("TEST_FILE_IDENTITY_CHANGED=1");rc=3;}
    }
    close(dir);free(path);
    if(stopped&&!rc)rc=timedout?3:130;
    if(!rc){puts("ENGINE_COMPLETE=FILE_BYTES_VERIFIED");if(cache_ok)puts("MEDIA_CACHE_CONTROLS=APPLIED");else{puts("MEDIA_CACHE_CONTROLS=UNAVAILABLE");rc=3;}}
    if(rc==2)puts("ENGINE_COMPLETE=IO_DATA_FAILURE component_attribution=UNCONFIRMED");
    return rc;
}
