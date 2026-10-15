/* QA ONLY: Linux dynamic interposition, never a production dependency. */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/types.h>
#include <unistd.h>
static int is_test(int fd) {
 char link[64],path[4096];
 snprintf(link,sizeof(link),"/proc/self/fd/%d",fd);
 ssize_t n=readlink(link,path,sizeof(path)-1);if(n<0)return 0;
 path[n]=0;return strstr(path,"/.macdiag-test-")!=NULL;
}
static ssize_t transfer(int fd,void *buf,size_t n,int writing) {
 static ssize_t (*r)(int,void*,size_t);
 static ssize_t (*w)(int,const void*,size_t);
 static int interrupted_read,interrupted_write;
 if(!r){r=dlsym(RTLD_NEXT,"read");}
 if(!w){w=dlsym(RTLD_NEXT,"write");}
 const char *mode=getenv("QA_IO_FAULT");
 if(mode&&is_test(fd)) {
  if(!strcmp(mode,"EIO")){errno=EIO;return -1;}
  if(!strcmp(mode,"ENOSPC")){errno=ENOSPC;return -1;}
  if(!strcmp(mode,"EACCES")){errno=EACCES;return -1;}
  if(!strcmp(mode,"short")){if(n>4093)n=4093;}
  if(!strcmp(mode,"EINTR")) {
   int *seen=writing?&interrupted_write:&interrupted_read;
   if(!*seen){*seen=1;errno=EINTR;return -1;}
  }
 }
 return writing?w(fd,buf,n):r(fd,buf,n);
}
ssize_t write(int fd,const void *p,size_t n){return transfer(fd,(void*)p,n,1);}
ssize_t read(int fd,void *p,size_t n){return transfer(fd,p,n,0);}
