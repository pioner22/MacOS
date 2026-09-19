/* SPDX-License-Identifier: GPL-3.0-or-later
 * Allocated-file I/O verifier. Never opens a raw disk; never overwrites user files.
 * Directory descriptors anchor all file operations; a private test directory is retained on failure.
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
static void stopped(int s){(void)s;stop=1;}
static uint64_t expected(uint64_t i){
    i+=UINT64_C(0x9e3779b97f4a7c15);i=(i^(i>>30))*UINT64_C(0xbf58476d1ce4e5b9);
    i=(i^(i>>27))*UINT64_C(0x94d049bb133111eb);return i^(i>>31);
}
static int io(int fd,unsigned char *buf,size_t len,off_t pos,int write_mode){
    size_t done=0;
    while(done<len&&!stop){
        ssize_t n=write_mode?pwrite(fd,buf+done,len-done,pos+(off_t)done):pread(fd,buf+done,len-done,pos+(off_t)done);
        if(n<0&&errno==EINTR)continue;
        if(n<=0){perror(write_mode?"WRITE_ERROR":"READ_ERROR_OR_EOF");return 2;}
        done+=(size_t)n;
    }
    return stop?130:0;
}
int main(int argc,char **argv){
    if(argc!=3||!*argv[2])return 3;
    for(char *p=argv[2];*p;p++)if(*p<'0'||*p>'9')return 3;
    errno=0;char *end;uint64_t mib=strtoull(argv[2],&end,10);
    if(errno||*end||!mib||mib>65536)return 3;
    char parent[PATH_MAX];
    if(!realpath(argv[1],parent)){perror("DIRECTORY");return 3;}
    if(!strcmp(parent,"/dev")||!strncmp(parent,"/dev/",5))return 3;
    int parentfd=open(parent,O_RDONLY|O_DIRECTORY|O_NOFOLLOW);
    if(parentfd<0){perror("DIRECTORY_OPEN");return 3;}
    const size_t len=1048576;
    const uint64_t bytes=mib*len;
    struct statvfs fs;
    if(fstatvfs(parentfd,&fs)||!fs.f_frsize){close(parentfd);return 3;}
    uint64_t reserve=UINT64_C(4294967296),available=(uint64_t)fs.f_bavail*fs.f_frsize;
#ifdef DIAG_TESTING
    reserve=UINT64_C(268435456);
#endif
    if(available<bytes+reserve||bytes>available/2){puts("INSUFFICIENT_FREE_SPACE=1");close(parentfd);return 3;}
    char name[96];int created=0;
    for(unsigned n=0;n<100;n++){
        snprintf(name,sizeof(name),"macdiag-file-%ld-%u",(long)getpid(),n);
        if(!mkdirat(parentfd,name,0700)){created=1;break;}
        if(errno!=EEXIST)break;
    }
    if(!created){perror("MKDIRAT");close(parentfd);return 3;}
    int dirfd=openat(parentfd,name,O_RDONLY|O_DIRECTORY|O_NOFOLLOW);
    if(dirfd<0){perror("TEST_DIRECTORY");close(parentfd);return 3;}
    int fd=openat(dirfd,"payload.bin",O_CREAT|O_EXCL|O_RDWR|O_NOFOLLOW,0600);
    if(fd<0){perror("FILE_OPEN");close(dirfd);close(parentfd);return 3;}
    struct stat original,check;
    if(fstat(fd,&original)||!S_ISREG(original.st_mode)||original.st_nlink!=1){close(fd);close(dirfd);close(parentfd);return 3;}
    int nocache=0,fullflush=0,result=0;
#ifdef __APPLE__
    nocache=fcntl(fd,F_NOCACHE,1)==0;
#endif
    setvbuf(stdout,NULL,_IOLBF,0);
    printf("STORAGE_SCOPE=ALLOCATED_FILE bytes=%" PRIu64 " path=%s/%s/payload.bin cache_bypass=%d\n",bytes,parent,name,nocache);
    puts("RAW_DEVICE_WRITE=DISABLED FULL_DISK_COVERAGE=NO");
    signal(SIGINT,stopped);signal(SIGTERM,stopped);
    uint64_t *buf=malloc(len);
    if(!buf){result=3;goto done;}
    for(uint64_t off=0;off<bytes;off+=len){
        for(size_t i=0;i<len/8;i++)buf[i]=expected(off/8+i);
        result=io(fd,(unsigned char *)buf,len,(off_t)off,1);if(result)goto done;
        if(!(off%(UINT64_C(256)*1048576)))printf("STORAGE_WRITE bytes=%" PRIu64 "/%" PRIu64 "\n",off+len,bytes);
    }
    if(fsync(fd)){perror("FSYNC_ERROR");result=2;goto done;}
#ifdef __APPLE__
    fullflush=fcntl(fd,F_FULLFSYNC)==0;
#endif
    printf("STORAGE_FLUSH fsync=1 fullfsync=%d power_loss_durability=UNPROVEN\n",fullflush);
#ifdef DIAG_TESTING
    if(getenv("MACDIAG_TEST_INJECT")){uint64_t x=expected(0)^1;if(pwrite(fd,&x,8,0)!=8){result=3;goto done;}puts("TEST_ONLY_INJECTED_FAULT=1");}
    if(getenv("MACDIAG_TEST_TRUNCATE")){if(ftruncate(fd,(off_t)bytes-1)){result=3;goto done;}}
#endif
    if(close(fd)){fd=-1;result=2;goto done;}fd=-1;
    for(unsigned pass=0;pass<2;pass++){
        fd=openat(dirfd,"payload.bin",O_RDONLY|O_NOFOLLOW);
        if(fd<0||fstat(fd,&check)||check.st_dev!=original.st_dev||check.st_ino!=original.st_ino||
           !S_ISREG(check.st_mode)||check.st_nlink!=1){puts("FILE_IDENTITY_CHANGED=1");result=3;goto done;}
        if((uint64_t)check.st_size!=bytes){puts("FILE_SIZE_MISMATCH=1");result=2;goto done;}
#ifdef __APPLE__
        if(fcntl(fd,F_NOCACHE,1))nocache=0;
#endif
        for(uint64_t off=0;off<bytes;off+=len){
            memset(buf,0,len);result=io(fd,(unsigned char *)buf,len,(off_t)off,0);if(result)goto done;
            for(size_t i=0;i<len/8;i++){
                uint64_t e=expected(off/8+i);
                if(buf[i]!=e){printf("STORAGE_MISMATCH byte=%" PRIu64 " expected=%016" PRIx64 " actual=%016" PRIx64 "\n",off+i*8,e,buf[i]);result=2;goto done;}
            }
        }
        if(close(fd)){fd=-1;result=2;goto done;}fd=-1;
        printf("STORAGE_READBACK_PASS=%u bytes=%" PRIu64 "\n",pass+1,bytes);
    }
done:
    if(stop&&!result)result=130;
    free(buf);if(fd>=0&&close(fd)&&!result)result=2;
    if(!result){
        if(fstatat(dirfd,"payload.bin",&check,AT_SYMLINK_NOFOLLOW)||check.st_ino!=original.st_ino||check.st_dev!=original.st_dev){result=3;}
        else if(unlinkat(dirfd,"payload.bin",0)||unlinkat(parentfd,name,AT_REMOVEDIR)){puts("CLEANUP_INCOMPLETE=1");result=3;}
    }
    if(result)printf("EVIDENCE_DIRECTORY_RETAINED=%s/%s\n",parent,name);
    if(close(dirfd)&&!result)result=3;
    if(close(parentfd)&&!result)result=3;
    if(!result){printf("CACHE_BYPASS=%d\n",nocache);puts("ENGINE_COMPLETE=STORAGE_FILE_PASS");}
    return result;
}
