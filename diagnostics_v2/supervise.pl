#!/usr/bin/perl
# SPDX-License-Identifier: GPL-3.0-or-later
# A bounded process group, direct logging, signal forwarding; no shell eval.
use strict;
use warnings;
use POSIX qw(WNOHANG);
use IO::Select;
use IO::Handle;
$|=1;
my ($seconds,$log,@cmd)=@ARGV;
exit 3 unless defined $log && @cmd && $seconds =~ /^\d+$/ && $seconds>=1 && $seconds<=86400;
open my $out,'>',$log or do {print STDERR "SUPERVISOR_LOG_OPEN_FAILED=$!\n";exit 3;};
$out->autoflush(1);
my $hires=eval {require Time::HiRes; Time::HiRes::clock_gettime(Time::HiRes::CLOCK_MONOTONIC());1};
sub clocknow {return $hires ? Time::HiRes::clock_gettime(Time::HiRes::CLOCK_MONOTONIC()) : time;}
my ($cancel,$badlog,$timeout)=(0,0,0);
my $grace=$ENV{MACDIAG_STOP_GRACE}//2;
exit 3 unless $grace =~ /^\d+$/ && $grace>=1 && $grace<=30;
$SIG{INT}=sub{$cancel=130};$SIG{TERM}=sub{$cancel=143};$SIG{HUP}=sub{$cancel=129};$SIG{PIPE}='IGNORE';
pipe(my $r,my $w) or exit 3;
my $pid=fork();exit 3 unless defined $pid;
if(!$pid){
 close $r;close $out;
 $SIG{INT}='DEFAULT';$SIG{TERM}='DEFAULT';$SIG{HUP}='DEFAULT';$SIG{PIPE}='DEFAULT';
 setpgrp(0,0) or POSIX::_exit(125);
 open STDOUT,'>&',$w or POSIX::_exit(125);open STDERR,'>&',$w or POSIX::_exit(125);close $w;
 exec {$cmd[0]} @cmd or POSIX::_exit(127);
}
close $w;eval {POSIX::setpgid($pid,$pid);};
my $sel=IO::Select->new($r);
my ($ended,$status,$term,$leftover)=(0,0,undef,0);
my $start=clocknow();my $next=$start+15;
while(!$ended || $sel->count){
 my $now=clocknow();
 if(!defined($term) && ($cancel || $badlog || $now-$start >= $seconds)){
  $timeout=1 if !$cancel && !$badlog;
  kill 'TERM',-$pid;kill 'TERM',$pid unless $ended;$term=$now;
 }
 if(defined($term) && $now-$term >= $grace){kill 'KILL',-$pid;kill 'KILL',$pid unless $ended;}
 for my $fh($sel->can_read(0.1)){
  my $buf='';my $n=sysread($fh,$buf,65536);
  if(defined($n) && $n>0){
   $badlog=1 unless print $out $buf;
   $badlog=1 unless print STDOUT $buf;
  }elsif(defined($n)){ $sel->remove($fh);close $fh; }
  elsif(!$!{EINTR}){ $badlog=1;$sel->remove($fh);close $fh; }
 }
 if(!$ended){my $p=waitpid($pid,WNOHANG);if($p==$pid){$status=$?;$ended=1;}elsif($p<0){$badlog=1;$ended=1;}}
 if($ended && $sel->count && !defined $term){$leftover=1;kill 'TERM',-$pid;$term=clocknow();}
 if($now >= $next && !$ended){
  my $msg='HEARTBEAT elapsed_seconds='.int($now-$start)." process_running=1\n";
  $badlog=1 unless print $out $msg;$badlog=1 unless print STDOUT $msg;
  eval {$out->sync;};$next=$now+15;
 }
 if(defined($term) && clocknow()-$term>$grace+4){
  if(!$ended){$leftover=1;print $out "CHILD_STILL_RUNNING=$pid\n";print STDOUT "CHILD_STILL_RUNNING=$pid\n";}
  last;
 }
}
# Any still-running descendants share this stage's group, not the user's shell.
kill 'TERM',-$pid;
if(kill 0,-$pid){select undef,undef,undef,0.2;kill 'KILL',-$pid;}
my $rc=$badlog?3:$cancel?$cancel:$timeout?124:$leftover?3:($status&127)?128+($status&127):($status>>8);
my $msg="SUPERVISOR_EXIT=$rc timeout=$timeout interrupted=$cancel log_error=$badlog leftover=$leftover\n";
print STDOUT $msg;print $out $msg or $rc=3;eval {$out->sync;};close $out or $rc=3;
exit $rc;
