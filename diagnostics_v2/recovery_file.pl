#!/usr/bin/perl
# SPDX-License-Identifier: GPL-3.0-or-later
# Existing selected volume only; new exclusive temporary file; no raw device I/O.
use strict;use warnings;
use Fcntl qw(:DEFAULT :mode SEEK_SET);use File::Temp qw(tempfile);use Cwd qw(abs_path);use IO::Handle;
$|=1;
my($dir,$mib)=@ARGV;
exit 3 unless defined $mib && $mib=~/^\d+$/ && $mib>=1 && $mib<=256;
$dir=abs_path($dir);exit 3 unless defined $dir && -d $dir && -w $dir && $dir ne '/' && $dir !~ m{^/dev(?:/|$)};
# File::Temp uses exclusive creation. This process never selects or formats disks.
my($fh,$name)=tempfile('macdiag-screen-XXXXXX',DIR=>$dir,UNLINK=>0);
binmode $fh;my @identity=stat($fh);my $rc=0;my $complete=0;
$SIG{INT}=sub{die "CANCEL_130\n"};$SIG{TERM}=sub{die "CANCEL_143\n"};$SIG{HUP}=sub{die "CANCEL_129\n"};$SIG{ALRM}=sub{die "TIMEOUT\n"};alarm 900;
sub block {
 my($i)=@_;my $b='';for my $p(0..255){my $n=$i*256+$p;$b.=pack('V4',$n,0xffffffff-$n,0x73534c46,0x19a21410)x256}return $b;
}
print "FILE_ENGINE=RECOVERY_PERL bytes=".($mib*1048576)." cache_bypass=UNAVAILABLE\nTEST_FILE=$name\n";
eval {
 for my $i(0..$mib-1){
  my $b=block($i);my $pos=0;
  while($pos<length $b){my $n=syswrite($fh,$b,length($b)-$pos,$pos);if(!defined $n){next if $!{EINTR};die "WRITE_$!\n"}die "WRITE_ZERO\n" unless $n;$pos+=$n}
 }
 $fh->sync or die "SYNC_UNAVAILABLE\n";
 close($fh) or die "CLOSE_WRITE\n";
 for my $pass(1..2){
  sysopen($fh,$name,O_RDONLY|O_NOFOLLOW) or die "REOPEN\n";binmode $fh;
  my @st=stat($fh);die "IDENTITY_CHANGED\n" unless $st[0]==$identity[0] && $st[1]==$identity[1] && S_ISREG($st[2]);
  if($st[7]!=$mib*1048576){$rc=2;die "DATA_SIZE_MISMATCH\n"}
  for my $i(0..$mib-1){
   my $b='';while(length($b)<1048576){my $n=sysread($fh,my $piece,1048576-length($b));if(!defined $n){next if $!{EINTR};die "READ_$!\n"}if(!$n){$rc=2;die "DATA_SHORT_READ\n"}$b.=$piece}
   if($b ne block($i)){$rc=2;die "DATA_MISMATCH block=$i pass=$pass\n"}
  }
  close($fh) or die "CLOSE_READ\n";print "FILE_SCREEN_READBACK=$pass\n";
 }
 $complete=1;
};
if($@){print "FILE_SCREEN_ERROR=$@";if($@=~/CANCEL_(\d+)/){$rc=$1}else{$rc=3 unless $rc}}
alarm 0;eval {close($fh)};
my @now=lstat $name;
if(@now && S_ISREG($now[2]) && $now[0]==$identity[0] && $now[1]==$identity[1]){
 if($rc==2){print "EVIDENCE_FILE_RETAINED=$name\n"}
 else{unlink $name or $rc=3}
}else{$rc=3 unless $rc}
print "ENGINE_COMPLETE=FILE_SCREEN_CLEAN\n" if $complete && !$rc;
print "FULL_SSD_ACCEPTANCE=NOT_ESTABLISHED\n";
exit $rc;
