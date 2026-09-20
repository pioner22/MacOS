#!/usr/bin/perl
# SPDX-License-Identifier: GPL-3.0-or-later
# READ ONLY. No file creation, write, repair, or remapping on the target.
# scan_handle is separable for small regular-file / injected-I/O software tests.
use strict;
use warnings;
use Fcntl qw(O_RDONLY O_NOFOLLOW S_ISCHR);
use Config;
use Errno qw(EINTR EIO ENXIO ENODEV);
my $deverr = eval { Errno::EDEVERR() };
my $monotonic = eval { require Time::HiRes; Time::HiRes::clock_gettime(Time::HiRes::CLOCK_MONOTONIC()); 1 };
our $cancel = 0;
sub ro_now { return $monotonic ? Time::HiRes::clock_gettime(Time::HiRes::CLOCK_MONOTONIC()) : time; }
sub ro_read { return sysread($_[0], $_[1], $_[2]); }
sub ro_say { print STDOUT $_[0], "\n" or die "READONLY_LOG_WRITE_FAILED\n"; }
sub ro_number {
    my ($s, $lo, $hi) = @_;
    return defined($s) && $s =~ /\A(?:0|[1-9][0-9]*)\z/ && length($s) <= 16 && $s >= $lo && $s <= $hi;
}
sub scan_handle {
    my ($fh, $total, $sector, $seconds) = @_;
    my %r = (planned_bytes=>$total, read_bytes=>0, read_calls=>0, slow_calls=>0,
             max_read_seconds=>0, first_error_offset=>-1, error_errno=>0,
             completed=>0, code=>3, reason=>'STORAGE_RO_INCOMPLETE');
    return \%r unless ro_number($total, 1, 1125899906842624) &&
        ro_number($sector, 512, 65536) && !($sector & ($sector-1)) &&
        $total % $sector == 0 && ro_number($seconds, 1, 86400);
    my $start = ro_now(); my $next = $start + 5; my $nextbytes = 64*1048576;
    my $chunk = 4*1048576; my $buffer = '';
    ro_say("RO_BEGIN planned_bytes=$total sector_bytes=$sector buffer_bytes=$chunk open_mode=O_RDONLY");
    ro_say('RO_SCOPE=LOGICAL_READABILITY_ONLY content_integrity=NOT_TESTED write_retention=NOT_TESTED');
    while ($r{read_bytes} < $total) {
        if ($cancel) { $r{code}=$cancel; $r{reason}='STORAGE_RO_INTERRUPTED'; last; }
        if (ro_now()-$start >= $seconds) { $r{reason}='STORAGE_RO_TIMEOUT'; last; }
        my $want = $total-$r{read_bytes}; $want=$chunk if $want>$chunk;
        my $t = ro_now();
        my $n = ro_read($fh, $buffer, $want); my $e=0+$!;
        my $dt=ro_now()-$t; $dt=0 if $dt<0;
        $r{read_calls}++; $r{max_read_seconds}=$dt if $dt>$r{max_read_seconds};
        if ($dt>=2) {
            $r{slow_calls}++;
            ro_say(sprintf('RO_SLOW offset=%d seconds=%.3f classification=OBSERVATION_NOT_BAD_SECTOR', $r{read_bytes},$dt)) if $r{slow_calls}<=50;
        }
        if (!defined $n) {
            next if $e==EINTR;
            $r{first_error_offset}=$r{read_bytes}; $r{error_errno}=$e;
            $r{reason}='STORAGE_RO_READ_ERROR';
            $r{code}=($e==EIO || $e==ENXIO || $e==ENODEV || (defined($deverr) && $e==$deverr))?2:3;
            ro_say("RO_READ_ERROR offset=$r{read_bytes} lba=".int($r{read_bytes}/$sector)." request_bytes=$want errno=$e sector_attribution=UNCONFIRMED");
            last; # Do not hammer a deteriorating disk with retries.
        }
        if (!$n) { $r{first_error_offset}=$r{read_bytes}; $r{code}=2; $r{reason}='STORAGE_RO_UNEXPECTED_EOF'; last; }
        if ($n>$want) { $r{reason}='STORAGE_RO_INVALID_READ_COUNT'; last; }
        $r{read_bytes}+=$n;
        if ($n % $sector) { $r{reason}='STORAGE_RO_UNALIGNED_SHORT_READ'; last; }
        if (ro_now()>=$next || $r{read_bytes}>=$nextbytes || $r{read_bytes}==$total) {
            ro_say(sprintf('RO_PROGRESS read_bytes=%d planned_bytes=%d percent=%.3f', $r{read_bytes},$total,100*$r{read_bytes}/$total));
            $next=ro_now()+5; $nextbytes=$r{read_bytes}+64*1048576;
        }
    }
    $r{elapsed_seconds}=ro_now()-$start;
    if ($cancel && $r{code}!=2) { $r{code}=$cancel; $r{reason}='STORAGE_RO_INTERRUPTED'; }
    elsif ($r{elapsed_seconds}>=$seconds && $r{code}!=2) { $r{reason}='STORAGE_RO_TIMEOUT'; }
    elsif ($r{read_bytes}==$total && $r{code}!=2 && $r{reason} ne 'STORAGE_RO_UNALIGNED_SHORT_READ') {
        $r{completed}=1; $r{code}=0; $r{reason}='STORAGE_RO_ALL_BYTES_READ';
    }
    return \%r;
}
sub readonly_main {
    my ($path,$total,$sector,$seconds)=@_;
    $|=1; $SIG{PIPE}='IGNORE';
    $SIG{INT}=sub{$cancel=130}; $SIG{TERM}=sub{$cancel=143}; $SIG{HUP}=sub{$cancel=129};
    if (@_!=4 || $^O ne 'darwin' || !defined($path) || $path !~ m{\A/dev/rdisk(?:0|[1-9][0-9]*)\z} ||
        ($Config{ivsize}||0)<8 || ($Config{lseeksize}||0)<8 ||
        !ro_number($total,1,1125899906842624) || !ro_number($sector,512,65536) ||
        ($sector & ($sector-1)) || $total % $sector || !ro_number($seconds,1,86400)) {
        ro_say('RO_REFUSED=PLATFORM_PATH_OR_GEOMETRY'); return 3;
    }
    my @before=lstat($path);
    if (!@before || !S_ISCHR($before[2])) { ro_say('RO_REFUSED=NOT_RAW_CHARACTER_DEVICE'); return 3; }
    my $fh;
    if (!sysopen($fh,$path,O_RDONLY|O_NOFOLLOW)) { ro_say('RO_OPEN_FAILED errno='.(0+$!).' mode=O_RDONLY'); return 3; }
    my @opened=stat($fh);
    if (!@opened || !S_ISCHR($opened[2]) || $before[0]!=$opened[0] || $before[1]!=$opened[1] || $before[6]!=$opened[6]) {
        close($fh); ro_say('RO_REFUSED=DEVICE_IDENTITY_CHANGED'); return 3;
    }
    ro_say("READONLY_DEVICE=$path rdev=$opened[6] clock=".($monotonic?'MONOTONIC':'WALL_UNVERIFIED'));
    my $r=scan_handle($fh,$total,$sector,$seconds);
    if (!close($fh) && $r->{code}==0) { $r->{code}=3; $r->{completed}=0; $r->{reason}='STORAGE_RO_CLOSE_FAILED'; }
    for my $k (qw(planned_bytes read_bytes read_calls slow_calls max_read_seconds first_error_offset error_errno completed elapsed_seconds reason)) {
        ro_say("RO_SUMMARY_$k=".($r->{$k}//'unknown'));
    }
    ro_say('ENGINE_COMPLETE=STORAGE_READONLY_PASS') if $r->{code}==0 && $r->{completed};
    return $r->{code};
}
unless (caller) { exit readonly_main(@ARGV); }
1;
