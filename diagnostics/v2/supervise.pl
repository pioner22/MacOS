#!/usr/bin/perl
# SPDX-License-Identifier: GPL-3.0-or-later
# Core Perl supervisor; no non-core modules. Logs directly, bounded runtime.
use strict;
use warnings;
use POSIX qw(WNOHANG);
use IO::Select;
$|=1;
my ($seconds,$log,@cmd)=@ARGV;
die "usage: supervise seconds logfile command ...\n" unless defined($log) && @cmd && $seconds =~ /^\d+$/ && $seconds>=1 && $seconds<=86400;
open my $out,'>',$log or die "log open: $!";
$out->autoflush(1);
pipe(my $r,my $w) or die "pipe: $!";
my $pid=fork(); die "fork: $!" unless defined $pid;
if(!$pid){
  close $r; close $out;
  setpgrp(0,0) or die "setpgrp: $!";
  open STDOUT,'>&',$w or die $!; open STDERR,'>&',$w or die $!;
  close $w;
  exec {$cmd[0]} @cmd; die "exec: $!";
}
close $w;
# Parent also attempts setpgid to narrow the fork/setpgrp signal race.
eval { POSIX::setpgid($pid,$pid); };
my $signal=0;
$SIG{INT}=sub{$signal=1}; $SIG{TERM}=sub{$signal=1}; $SIG{HUP}=sub{$signal=1};
$SIG{PIPE}='IGNORE';
my $sel=IO::Select->new($r); my $start=time; my $term=0; my $timeout=0;
my ($ended,$status,$badlog)=(0,0,0);
while(!$ended || $sel->count){
  if(!$term && ($signal || time-$start >= $seconds)){
    $timeout=!$signal; kill 'TERM',-$pid; kill 'TERM',$pid; $term=time;
  }
  if($term && time-$term>=2){kill 'KILL',-$pid; kill 'KILL',$pid unless $ended;}
  for my $fh($sel->can_read(0.1)){
    my $buf=''; my $n=sysread($fh,$buf,65536);
    if(defined($n) && $n>0){
      print STDOUT $buf;
      unless(print $out $buf){$badlog=1; $signal=1;}
    } elsif(defined($n)){ $sel->remove($fh); close $fh; }
    elsif(!$!{EINTR}){$sel->remove($fh); close $fh; $badlog=1; $signal=1;}
  }
  if(!$ended){my $wret=waitpid($pid,WNOHANG); if($wret==$pid){$status=$?; $ended=1;}}
  # A child left background descendants holding stdout: stop the process group.
  if($ended && $sel->count && !$term){kill 'TERM',-$pid; $term=time;}
  if($term && time-$term>4 && $ended){last;}
}
kill 'TERM',-$pid; # no descendants may outlive a diagnostic stage
my $rc=$badlog?3:$signal?130:$timeout?124:($status&127)?128+($status&127):($status>>8);
my $msg="SUPERVISOR_EXIT=$rc timeout=$timeout interrupted=$signal log_error=$badlog\n";
print STDOUT $msg; print $out $msg or $rc=3;
# sync is best effort; no assertion that the log survives hard power loss.
eval { $out->sync; };
close $out or $rc=3;
exit $rc;
